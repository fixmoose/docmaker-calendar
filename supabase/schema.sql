-- DocMaker Calendar — database schema (Supabase / Postgres)
--
-- Every object uses the CC_ prefix. Postgres folds unquoted identifiers to
-- lower case, so these are created as cc_* and you can still write CC_events
-- in a query — it resolves to the same table.
--
-- The project (mxxabikquupnwvlspzyz) is shared with other apps and already
-- holds ~176 tables under other prefixes, so EVERY object here is CC_ prefixed
-- and nothing outside that prefix is touched. The whole file is idempotent:
-- paste it into the Supabase SQL editor and run it as many times as you like.
--
-- The app runs on this schema: src/lib/db.ts holds every query, and reads of
-- events go through the cc_calendar_feed view so busy masking happens in the
-- database rather than the client.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Migration from earlier runs of this file
-- ---------------------------------------------------------------------------

-- An earlier version put a trigger on auth.users. That table is shared with
-- every other app on this project, so a signup for any of them would create
-- DocMaker Calendar rows. cc_bootstrap_me() replaced it; remove the trigger.
drop trigger if exists cc_on_auth_user_created on auth.users;
drop function if exists cc_handle_new_user();

-- Columns added after the tables were first created.
alter table if exists cc_calendars
  add column if not exists privacy text not null default 'busy';
alter table if exists cc_events
  add column if not exists privacy text;
alter table if exists cc_events
  add column if not exists importance text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cc_calendars_privacy_check') then
    alter table cc_calendars add constraint cc_calendars_privacy_check
      check (privacy in ('details', 'busy', 'hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cc_events_privacy_check') then
    alter table cc_events add constraint cc_events_privacy_check
      check (privacy in ('details', 'busy', 'hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cc_events_importance_check') then
    alter table cc_events add constraint cc_events_importance_check
      check (importance in ('normal', 'urgent'));
  end if;
end $$;

-- CREATE OR REPLACE VIEW cannot insert columns in the middle of an existing
-- view, so the feed is dropped and rebuilt rather than replaced.
drop view if exists cc_calendar_feed;
drop view if exists cc_event_guests;

-- Ownership columns are filled by the database from the session, so a client
-- can never disagree with the policy about who it is. Every "owner" policy
-- below compares against auth.uid(), and these defaults guarantee the match.
alter table if exists cc_events      alter column created_by  set default auth.uid();
alter table if exists cc_calendars   alter column owner_id    set default auth.uid();
alter table if exists cc_groups      alter column owner_id    set default auth.uid();
alter table if exists cc_invitations alter column invited_by  set default auth.uid();
alter table if exists cc_attachments alter column uploaded_by set default auth.uid();
alter table if exists cc_event_shares alter column shared_by  set default auth.uid();

-- An invitation can be about one event: "Ana invited you to Dinner". Accepting
-- it grants the share, so people can be invited before they have an account.
alter table if exists cc_invitations
  add column if not exists event_id uuid references cc_events (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists cc_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null,
  avatar_color text not null default 'orange',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table cc_profiles add column if not exists avatar_url text;
alter table cc_profiles
  add column if not exists shared_busy boolean not null default true;

create table if not exists cc_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists cc_group_members (
  group_id  uuid not null references cc_groups (id) on delete cascade,
  user_id   uuid not null references cc_profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists cc_calendars (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'personal' check (kind in ('personal', 'shared')),
  color      text not null default 'orange',
  owner_id   uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  group_id   uuid references cc_groups (id) on delete set null,
  -- What people who share a group with the owner may see:
  --   details = the whole event, busy = an anonymous block, hidden = nothing.
  privacy    text not null default 'busy'
             check (privacy in ('details', 'busy', 'hidden')),
  created_at timestamptz not null default now(),
  constraint cc_calendars_shared_needs_group
    check ((kind = 'shared') = (group_id is not null))
);

-- Which calendars a given user currently shows (the sidebar checkboxes).
create table if not exists cc_calendar_visibility (
  user_id     uuid not null references cc_profiles (id) on delete cascade,
  calendar_id uuid not null references cc_calendars (id) on delete cascade,
  visible     boolean not null default true,
  primary key (user_id, calendar_id)
);

create table if not exists cc_events (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references cc_calendars (id) on delete cascade,
  title       text not null,
  notes       text,
  location    text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  all_day     boolean not null default false,
  color       text,
  -- Overrides the calendar's privacy for this one event; null = inherit.
  privacy     text check (privacy in ('details', 'busy', 'hidden')),
  -- Flagged as needing attention; shown to everyone who can see the event.
  importance  text not null default 'normal'
              check (importance in ('normal', 'urgent')),
  created_by  uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Deleting sets this rather than removing the row, so it can be restored.
  deleted_at  timestamptz,
  constraint cc_events_time_order check (ends_at >= starts_at)
);

-- Files dropped onto a time slot: prescriptions, tickets, invoices, photos.
-- Bytes live in the `cc_attachments` storage bucket; this table is metadata.
create table if not exists cc_attachments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references cc_events (id) on delete cascade,
  name        text not null,
  size_bytes  bigint not null,
  mime_type   text not null,
  storage_path text not null unique,
  uploaded_by uuid not null references cc_profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Emailed invitations (sent through UniOne). The token is what the /join link
-- carries; it is single use and consumed on sign-up.
create table if not exists cc_invitations (
  id         uuid primary key default gen_random_uuid(),
  email      citext not null,
  token      text not null unique,
  invited_by uuid not null references cc_profiles (id) on delete cascade,
  group_id   uuid references cc_groups (id) on delete set null,
  event_id   uuid references cc_events (id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'sent', 'failed', 'accepted')),
  error      text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references cc_profiles (id) on delete set null
);

-- The right-click → "add to their calendar" action: one row per person the
-- event was pushed to. Distinct from sharing a whole calendar with a group.
create table if not exists cc_event_shares (
  event_id   uuid not null references cc_events (id) on delete cascade,
  user_id    uuid not null references cc_profiles (id) on delete cascade,
  shared_by  uuid not null references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists cc_events_calendar_time_idx
  on cc_events (calendar_id, starts_at);
create index if not exists cc_event_shares_user_idx
  on cc_event_shares (user_id);
create index if not exists cc_group_members_user_idx
  on cc_group_members (user_id);
create index if not exists cc_calendars_group_idx
  on cc_calendars (group_id);
create index if not exists cc_attachments_event_idx
  on cc_attachments (event_id);
create index if not exists cc_invitations_email_idx
  on cc_invitations (email);

-- ---------------------------------------------------------------------------
-- Helpers (security definer: they must not be filtered by the policies that
-- call them, otherwise membership checks recurse)
-- ---------------------------------------------------------------------------

create or replace function cc_is_group_member(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from cc_group_members
    where group_id = p_group and user_id = p_user
  );
$$;

-- A calendar is readable when you own it or you are in its group.
create or replace function cc_can_read_calendar(p_calendar uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from cc_calendars c
    where c.id = p_calendar
      and (c.owner_id = p_user or cc_is_group_member(c.group_id, p_user))
  );
$$;

-- What the viewer may see of one event: 'full', 'busy' or 'none'. Mirrors
-- accessFor() in src/lib/access.ts — keep the two in step.
create or replace function cc_event_access(p_event uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.owner_id = p_user then 'full'
    when c.kind = 'shared' and cc_is_group_member(c.group_id, p_user) then 'full'
    when exists (
      select 1 from cc_event_shares s
      where s.event_id = e.id and s.user_id = p_user
    ) then 'full'
    when not exists (
      select 1
      from cc_group_members mine
      join cc_group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = p_user and theirs.user_id = c.owner_id
    ) then 'none'
    when coalesce(e.privacy, c.privacy) = 'details' then 'full'
    when coalesce(e.privacy, c.privacy) = 'busy' then 'busy'
    else 'none'
  end
  from cc_events e
  join cc_calendars c on c.id = e.calendar_id
  where e.id = p_event;
$$;

create or replace function cc_is_shared_with(p_event uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from cc_event_shares s
    where s.event_id = p_event and s.user_id = p_user
  );
$$;

-- Two people are connected when they sit in at least one group together.
create or replace function cc_users_share_group(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from cc_group_members mine
    join cc_group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = p_a and theirs.user_id = p_b
  );
$$;

-- Shared calendars are read/write for the whole group; personal ones only for
-- their owner. Tighten later if we add read-only members.
create or replace function cc_can_write_calendar(p_calendar uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select cc_can_read_calendar(p_calendar, p_user);
$$;

create or replace function cc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cc_events_touch on cc_events;
create trigger cc_events_touch
  before update on cc_events
  for each row execute function cc_touch_updated_at();

-- Sets this app up for whoever is signed in: a profile and a calendar to write
-- in. Called by the client on first load.
--
-- Deliberately NOT a trigger on auth.users: this Supabase project is shared
-- with several other apps, and auth.users is common to all of them. A trigger
-- there would create DocMaker Calendar rows for people signing up to a different
-- app entirely. Doing it on demand keeps this app's footprint inside CC_.
create or replace function cc_bootstrap_me()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  claims   jsonb;
  palette  text[] := array['orange','teal','violet','rose','blue','green','amber'];
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;

  select raw_user_meta_data into claims from auth.users where id = me;

  insert into cc_profiles (id, email, display_name, avatar_url, avatar_color)
  select
    me,
    u.email,
    coalesce(
      nullif(claims ->> 'full_name', ''),
      nullif(claims ->> 'name', ''),
      split_part(u.email, '@', 1)
    ),
    coalesce(claims ->> 'avatar_url', claims ->> 'picture'),
    palette[1 + (abs(hashtext(me::text)) % array_length(palette, 1))]
  from auth.users u
  where u.id = me
  on conflict (id) do update
    set avatar_url = coalesce(cc_profiles.avatar_url, excluded.avatar_url);

  -- Nobody should land on a calendar they cannot write to.
  if not exists (
    select 1 from cc_calendars where owner_id = me and kind = 'personal'
  ) then
    insert into cc_calendars (name, kind, color, owner_id, privacy)
    values ('My calendar', 'personal', 'orange', me, 'busy');
  end if;
end;
$$;

-- The earlier version returned a table; a return type cannot be changed in
-- place, so the old signature is dropped first.
drop function if exists cc_accept_invitation(text);

-- Redeems an invitation: makes sure the invitee exists in this app, joins the
-- group it was sent for, grants the event it was about, and marks it used.
-- Security definer, because the invitee can see none of those things yet.
create or replace function cc_accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite cc_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept an invitation.';
  end if;

  -- They may never have opened the calendar, so they may have no profile yet
  -- and the foreign keys below would fail.
  perform cc_bootstrap_me();

  select * into invite
  from cc_invitations
  where token = p_token and status <> 'accepted'
  limit 1;

  if invite.id is null then
    raise exception 'This invitation is no longer valid.';
  end if;

  if invite.group_id is not null then
    insert into cc_group_members (group_id, user_id, role)
    values (invite.group_id, auth.uid(), 'member')
    on conflict do nothing;
  end if;

  -- Invited to one specific event: hand over that share now.
  if invite.event_id is not null then
    insert into cc_event_shares (event_id, user_id, shared_by)
    values (invite.event_id, auth.uid(), invite.invited_by)
    on conflict do nothing;
  end if;

  update cc_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = invite.id;

  return jsonb_build_object(
    'group_id', invite.group_id,
    'event_id', invite.event_id,
    'invited_by', invite.invited_by
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Diagnostics
-- ---------------------------------------------------------------------------

-- 1. A read-only report of what row level security actually looks like, so the
--    policies can be inspected from outside the SQL editor. Service role only:
--    policy expressions describe the locks, so they are not for the public.
create or replace function cc_policy_report()
returns table (
  table_name text,
  policy_name text,
  command text,
  roles text,
  using_expression text,
  check_expression text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tablename::text,
    policyname::text,
    cmd::text,
    array_to_string(roles, ',')::text,
    coalesce(qual, '')::text,
    coalesce(with_check, '')::text
  from pg_policies
  where schemaname = 'public' and tablename like 'cc\_%'
  order by tablename, cmd, policyname;
$$;

revoke all on function cc_policy_report() from public, anon, authenticated;
grant execute on function cc_policy_report() to service_role;

-- Which tables have row level security switched on at all.
create or replace function cc_rls_report()
returns table (table_name text, rls_enabled boolean, policy_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*) from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'cc\_%'
  order by c.relname;
$$;

revoke all on function cc_rls_report() from public, anon, authenticated;
grant execute on function cc_rls_report() to service_role;


-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table cc_profiles            enable row level security;
alter table cc_groups              enable row level security;
alter table cc_group_members       enable row level security;
alter table cc_calendars           enable row level security;
alter table cc_calendar_visibility enable row level security;
alter table cc_events              enable row level security;
alter table cc_event_shares        enable row level security;
alter table cc_attachments         enable row level security;
alter table cc_invitations         enable row level security;

-- Profiles: yourself, plus anyone you share a group with.
drop policy if exists cc_profiles_read on cc_profiles;
create policy cc_profiles_read on cc_profiles for select using (
  id = auth.uid()
  or exists (
    select 1
    from cc_group_members mine
    join cc_group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and theirs.user_id = cc_profiles.id
  )
);
drop policy if exists cc_profiles_write on cc_profiles;
create policy cc_profiles_write on cc_profiles for update using (id = auth.uid());

-- Groups.
drop policy if exists cc_groups_read on cc_groups;
create policy cc_groups_read on cc_groups for select using (
  owner_id = auth.uid() or cc_is_group_member(id, auth.uid())
);
drop policy if exists cc_groups_insert on cc_groups;
create policy cc_groups_insert on cc_groups for insert with check (owner_id = auth.uid());
drop policy if exists cc_groups_update on cc_groups;
create policy cc_groups_update on cc_groups for update using (owner_id = auth.uid());
drop policy if exists cc_groups_delete on cc_groups;
create policy cc_groups_delete on cc_groups for delete using (owner_id = auth.uid());

-- Membership: members see the roster, the owner edits it.
drop policy if exists cc_group_members_read on cc_group_members;
create policy cc_group_members_read on cc_group_members for select using (
  user_id = auth.uid() or cc_is_group_member(group_id, auth.uid())
);
drop policy if exists cc_group_members_write on cc_group_members;
create policy cc_group_members_write on cc_group_members for all using (
  exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid())
) with check (
  exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid())
);

-- Calendars.
drop policy if exists cc_calendars_read on cc_calendars;
create policy cc_calendars_read on cc_calendars for select using (
  owner_id = auth.uid() or cc_is_group_member(group_id, auth.uid())
);
drop policy if exists cc_calendars_insert on cc_calendars;
create policy cc_calendars_insert on cc_calendars for insert with check (owner_id = auth.uid());
drop policy if exists cc_calendars_update on cc_calendars;
create policy cc_calendars_update on cc_calendars for update using (owner_id = auth.uid());
drop policy if exists cc_calendars_delete on cc_calendars;
create policy cc_calendars_delete on cc_calendars for delete using (owner_id = auth.uid());

-- Per-user view state.
drop policy if exists cc_visibility_all on cc_calendar_visibility;
create policy cc_visibility_all on cc_calendar_visibility for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Events: the base table only ever hands over rows the viewer may see in FULL.
-- Busy blocks come from the cc_calendar_feed view below, which is the only way
-- to learn that someone else's time is taken — the details never leave the row.
-- Reading an event: decided from the row's own columns, never by looking the
-- row up again. A STABLE function that selects from cc_events cannot see a row
-- that is still being inserted, which refuses INSERT ... RETURNING.
-- Reading an event: from the row's own columns, and through functions that
-- run as the owner. A policy that queries another table whose policy queries
-- this one recurses; a security definer function is not filtered, so it stops.
drop policy if exists cc_events_read on cc_events;
create policy cc_events_read on cc_events for select using (
  -- Full access only. Busy blocks come from cc_calendar_feed, never from here.
  exists (
    select 1
    from cc_calendars c
    where c.id = cc_events.calendar_id
      and (
        c.owner_id = auth.uid()
        or (c.kind = 'shared' and cc_is_group_member(c.group_id, auth.uid()))
        or (
          coalesce(cc_events.privacy, c.privacy) = 'details'
          and cc_users_share_group(auth.uid(), c.owner_id)
        )
      )
  )
  or cc_is_shared_with(cc_events.id, auth.uid())
);

drop policy if exists cc_events_insert on cc_events;
create policy cc_events_insert on cc_events for insert with check (
  created_by = auth.uid() and cc_can_write_calendar(calendar_id, auth.uid())
);
drop policy if exists cc_events_update on cc_events;
create policy cc_events_update on cc_events for update using (
  cc_can_write_calendar(calendar_id, auth.uid())
) with check (
  cc_can_write_calendar(calendar_id, auth.uid())
);
drop policy if exists cc_events_delete on cc_events;
create policy cc_events_delete on cc_events for delete using (
  cc_can_write_calendar(calendar_id, auth.uid())
);

-- Per-event sharing.
drop policy if exists cc_event_shares_read on cc_event_shares;
create policy cc_event_shares_read on cc_event_shares for select using (
  user_id = auth.uid()
  or exists (
    select 1 from cc_events e
    where e.id = event_id and cc_can_read_calendar(e.calendar_id, auth.uid())
  )
);
drop policy if exists cc_event_shares_write on cc_event_shares;
-- Whoever may change the event may change who is on it — including a guest,
-- since a share is editable. Leaving a share you are on is always yours.
create policy cc_event_shares_write on cc_event_shares for all using (
  shared_by = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1 from cc_events e
    where e.id = event_id
      and (cc_can_write_calendar(e.calendar_id, auth.uid())
           or cc_is_shared_with(e.id, auth.uid()))
  )
) with check (
  shared_by = auth.uid()
);

-- Attachments follow their event exactly: full access to the event means the
-- files, busy access means you never learn they exist.
drop policy if exists cc_attachments_read on cc_attachments;
create policy cc_attachments_read on cc_attachments for select using (
  cc_event_access(event_id, auth.uid()) = 'full'
);
drop policy if exists cc_attachments_write on cc_attachments;
create policy cc_attachments_write on cc_attachments for all using (
  exists (
    select 1 from cc_events e
    where e.id = event_id and cc_can_write_calendar(e.calendar_id, auth.uid())
  )
) with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from cc_events e
    where e.id = event_id and cc_can_write_calendar(e.calendar_id, auth.uid())
  )
);

-- Invitations: the sender manages them; the invitee finds theirs by token.
drop policy if exists cc_invitations_read on cc_invitations;
create policy cc_invitations_read on cc_invitations for select using (
  invited_by = auth.uid()
  or email = (select email from cc_profiles where id = auth.uid())
);
drop policy if exists cc_invitations_write on cc_invitations;
create policy cc_invitations_write on cc_invitations for all
  using (invited_by = auth.uid()) with check (invited_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Subscribed calendars (Google / Outlook iCal feeds)
-- ---------------------------------------------------------------------------
-- A subscribed feed: the secret iCal URL a provider gives you, plus how often
-- we should re-read it. mode 'once' imports and stops; 'auto' keeps polling.
create table if not exists cc_calendar_feeds (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  calendar_id    uuid not null references cc_calendars (id) on delete cascade,
  name           text not null,
  url            text not null,
  provider       text not null default 'ics'
                 check (provider in ('ics', 'google', 'outlook')),
  mode           text not null default 'auto' check (mode in ('once', 'auto')),
  interval_minutes integer not null default 360,
  last_synced_at timestamptz,
  last_status    text,
  last_error     text,
  event_count    integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists cc_calendar_feeds_owner_idx on cc_calendar_feeds (owner_id);
create index if not exists cc_calendar_feeds_due_idx on cc_calendar_feeds (mode, last_synced_at);

-- Imported events are matched back to their source so a re-sync updates rather
-- than duplicates, and so removals upstream can be cleared.
alter table if exists cc_events
  add column if not exists feed_id uuid references cc_calendar_feeds (id) on delete cascade;
alter table if exists cc_events
  add column if not exists external_uid text;
alter table if exists cc_events
  add column if not exists deleted_at timestamptz;

create unique index if not exists cc_events_feed_uid_idx
  on cc_events (feed_id, external_uid)
  where feed_id is not null;

alter table cc_calendar_feeds enable row level security;

drop policy if exists cc_calendar_feeds_all on cc_calendar_feeds;
create policy cc_calendar_feeds_all on cc_calendar_feeds for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Imported events are read-only in the app: the calendar upstream owns them.
-- The feed writer runs with the service role, which bypasses these policies.
drop policy if exists cc_events_update on cc_events;
create policy cc_events_update on cc_events for update using (
  feed_id is null and cc_can_write_calendar(calendar_id, auth.uid())
) with check (
  feed_id is null and cc_can_write_calendar(calendar_id, auth.uid())
);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
-- Reminders belong to the event, not to the person reading it: whoever creates
-- the event decides, and everyone the event reaches is reminded the same way.
-- A recipient cannot switch them off, and the creator cannot switch them off
-- for one particular recipient either.
create table if not exists cc_event_reminders (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references cc_events (id) on delete cascade,
  minutes_before integer not null check (minutes_before between 0 and 43200),
  channel       text not null default 'browser' check (channel in ('browser', 'email')),
  created_by    uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (event_id, minutes_before, channel)
);

create index if not exists cc_event_reminders_event_idx
  on cc_event_reminders (event_id);

-- One row per person per reminder per occurrence, so nothing is sent twice.
create table if not exists cc_reminder_deliveries (
  reminder_id uuid not null references cc_event_reminders (id) on delete cascade,
  user_id     uuid not null references cc_profiles (id) on delete cascade,
  due_at      timestamptz not null,
  sent_at     timestamptz not null default now(),
  primary key (reminder_id, user_id, due_at)
);

alter table cc_event_reminders    enable row level security;
alter table cc_reminder_deliveries enable row level security;

-- Visible to everyone who can see the event in full; editable only by whoever
-- can edit the event itself.
drop policy if exists cc_event_reminders_read on cc_event_reminders;
create policy cc_event_reminders_read on cc_event_reminders for select using (
  cc_event_access(event_id, auth.uid()) = 'full'
);

drop policy if exists cc_event_reminders_write on cc_event_reminders;
create policy cc_event_reminders_write on cc_event_reminders for all using (
  exists (
    select 1 from cc_events e
    where e.id = event_id
      and e.feed_id is null
      and cc_can_write_calendar(e.calendar_id, auth.uid())
  )
) with check (
  exists (
    select 1 from cc_events e
    where e.id = event_id
      and e.feed_id is null
      and cc_can_write_calendar(e.calendar_id, auth.uid())
  )
);

-- Deliveries are bookkeeping for the sender; you may only see your own.
drop policy if exists cc_reminder_deliveries_read on cc_reminder_deliveries;
create policy cc_reminder_deliveries_read on cc_reminder_deliveries for select
  using (user_id = auth.uid());


-- A reminder now belongs either to one person or to everybody:
--   user_id = <someone>  →  only they are reminded, and only they can change it
--   user_id = null       →  everyone who can see the event is reminded
-- New events default to the creator's own, so nobody is signed up to somebody
-- else's alarms without asking.
alter table if exists cc_event_reminders
  add column if not exists user_id uuid references cc_profiles (id) on delete cascade;

-- The old uniqueness rule ignored who a reminder is for.
alter table if exists cc_event_reminders
  drop constraint if exists cc_event_reminders_event_id_minutes_before_channel_key;

create unique index if not exists cc_event_reminders_unique_idx
  on cc_event_reminders (event_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), minutes_before, channel);

-- Read your own and the event-wide ones; never anyone else's private alarms.
drop policy if exists cc_event_reminders_read on cc_event_reminders;
create policy cc_event_reminders_read on cc_event_reminders for select using (
  cc_event_access(event_id, auth.uid()) = 'full'
  and (user_id is null or user_id = auth.uid())
);

-- Anyone who can see the event may set reminders for themselves. Only someone
-- who can edit the event may set one for everybody.
drop policy if exists cc_event_reminders_write on cc_event_reminders;
create policy cc_event_reminders_write on cc_event_reminders for all using (
  (user_id = auth.uid() and cc_event_access(event_id, auth.uid()) = 'full')
  or (
    user_id is null
    and exists (
      select 1 from cc_events e
      where e.id = event_id
        and e.feed_id is null
        and cc_can_write_calendar(e.calendar_id, auth.uid())
    )
  )
) with check (
  (user_id = auth.uid() and cc_event_access(event_id, auth.uid()) = 'full')
  or (
    user_id is null
    and exists (
      select 1 from cc_events e
      where e.id = event_id
        and e.feed_id is null
        and cc_can_write_calendar(e.calendar_id, auth.uid())
    )
  )
);

-- ---------------------------------------------------------------------------
-- Notifications
--
-- "Ana shared Dinner with you." Kept as rows rather than fired and forgotten,
-- so they survive a refresh, a new login and a closed laptop.
-- ---------------------------------------------------------------------------

create table if not exists cc_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references cc_profiles (id) on delete cascade,
  actor_id   uuid references cc_profiles (id) on delete set null,
  event_id   uuid references cc_events (id) on delete cascade,
  kind       text not null check (kind in ('share', 'update', 'cancel', 'invite', 'note')),
  title      text not null,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cc_notifications_user_idx
  on cc_notifications (user_id, read_at, created_at desc);

alter table cc_notifications enable row level security;

drop policy if exists cc_notifications_read on cc_notifications;
create policy cc_notifications_read on cc_notifications for select
  using (user_id = auth.uid());

-- You may only ever mark your own as read; they are written by the trigger.
drop policy if exists cc_notifications_update on cc_notifications;
create policy cc_notifications_update on cc_notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cc_notifications_delete on cc_notifications;
create policy cc_notifications_delete on cc_notifications for delete
  using (user_id = auth.uid());

-- Sharing an event tells the person it was shared with. A trigger rather than
-- client code, so it happens however the share was made.
create or replace function cc_notify_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_title text;
  actor_name  text;
begin
  if new.user_id = new.shared_by then
    return new;
  end if;

  select title into event_title from cc_events where id = new.event_id;
  select display_name into actor_name from cc_profiles where id = new.shared_by;

  insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
  values (
    new.user_id,
    new.shared_by,
    new.event_id,
    'share',
    coalesce(actor_name, 'Someone') || ' shared an event with you',
    event_title
  );

  return new;
end;
$$;

drop trigger if exists cc_on_event_shared on cc_event_shares;
create trigger cc_on_event_shared
  after insert on cc_event_shares
  for each row execute function cc_notify_share();


-- How each person wants to hear about one event. In-app is always on; email is
-- opt-in per event; mobile is reserved for when the app exists.
create table if not exists cc_event_subscriptions (
  event_id uuid not null references cc_events (id) on delete cascade,
  user_id  uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  email    boolean not null default false,
  mobile   boolean not null default false,
  primary key (event_id, user_id)
);

alter table cc_event_subscriptions enable row level security;

-- Your own choice, for an event you can actually see.
drop policy if exists cc_event_subscriptions_all on cc_event_subscriptions;
create policy cc_event_subscriptions_all on cc_event_subscriptions for all using (
  user_id = auth.uid() and cc_event_access(event_id, auth.uid()) = 'full'
) with check (
  user_id = auth.uid() and cc_event_access(event_id, auth.uid()) = 'full'
);

-- Notifications remember whether they have been emailed on, so the cron can
-- pick up whatever is outstanding without sending anything twice.
alter table if exists cc_notifications
  add column if not exists emailed_at timestamptz;

create index if not exists cc_notifications_unemailed_idx
  on cc_notifications (emailed_at, created_at)
  where emailed_at is null;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Supabase applies row level security to realtime as well, so a client is only
-- ever sent changes to rows it could have selected. Events the viewer may only
-- see as busy are therefore not broadcast — they arrive masked on the next
-- read of cc_calendar_feed, which is the behaviour we want.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_notifications'
  ) then
    alter publication supabase_realtime add table cc_notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_events'
  ) then
    alter publication supabase_realtime add table cc_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_event_shares'
  ) then
    alter publication supabase_realtime add table cc_event_shares;
  end if;
end $$;

-- What kind of list this event carries, which decides the icon and the wording
-- ("3 still to buy" reads better than "3 still to do" for a shopping trip).
alter table if exists cc_events
  add column if not exists list_kind text not null default 'todo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cc_events_list_kind_check') then
    alter table cc_events add constraint cc_events_list_kind_check
      check (list_kind in ('todo', 'shopping', 'packing'));
  end if;
end $$;

create table if not exists cc_event_items (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references cc_events (id) on delete cascade,
  text        text not null,
  -- Free text rather than a number: "2 ×", "500g" and "a case of" all happen.
  quantity    text,
  assigned_to uuid references cc_profiles (id) on delete set null,
  done        boolean not null default false,
  done_by     uuid references cc_profiles (id) on delete set null,
  done_at     timestamptz,
  position    integer not null default 0,
  created_by  uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists cc_event_items_event_idx
  on cc_event_items (event_id, position);

alter table cc_event_items enable row level security;

-- Anyone who can see the event in full can work the list: whoever is at the
-- shop ticks it off, which is the whole point of sharing one.
drop policy if exists cc_event_items_all on cc_event_items;
create policy cc_event_items_all on cc_event_items for all
  using (cc_event_access(event_id, auth.uid()) = 'full')
  with check (cc_event_access(event_id, auth.uid()) = 'full');

-- Ticking should show up on the other person's screen straight away.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_event_items'
  ) then
    alter publication supabase_realtime add table cc_event_items;
  end if;
end $$;


-- Acknowledging a reminder is recorded centrally, so confirming it on a phone
-- takes it off the laptop too. One row per person per occurrence: a repeating
-- reminder is answered separately each time it comes round.
create table if not exists cc_reminder_acks (
  reminder_id     uuid not null references cc_event_reminders (id) on delete cascade,
  user_id         uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  due_at          timestamptz not null,
  acknowledged_at timestamptz not null default now(),
  primary key (reminder_id, user_id, due_at)
);

create index if not exists cc_reminder_acks_user_idx
  on cc_reminder_acks (user_id, due_at desc);

alter table cc_reminder_acks enable row level security;

drop policy if exists cc_reminder_acks_all on cc_reminder_acks;
create policy cc_reminder_acks_all on cc_reminder_acks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The other device needs to hear about it the moment it happens.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_reminder_acks'
  ) then
    alter publication supabase_realtime add table cc_reminder_acks;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

-- reads and writes it. Notes are kept as a stream — who wrote what, when —
-- rather than one document people overwrite.

create table if not exists cc_notes (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references cc_groups (id) on delete cascade,
  body       text not null,
  color      text not null default 'amber',
  pinned     boolean not null default false,
  created_by uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists cc_notes
  add column if not exists event_id uuid references cc_events (id) on delete set null;

create index if not exists cc_notes_group_idx on cc_notes (group_id, created_at desc);
create index if not exists cc_notes_event_idx on cc_notes (event_id);
create index if not exists cc_notes_author_idx on cc_notes (created_by, created_at desc);

drop trigger if exists cc_notes_touch on cc_notes;
create trigger cc_notes_touch
  before update on cc_notes
  for each row execute function cc_touch_updated_at();

alter table cc_notes enable row level security;

-- Yours, or your group's.
drop policy if exists cc_notes_read on cc_notes;
create policy cc_notes_read on cc_notes for select using (
  created_by = auth.uid()
  or (group_id is not null and cc_is_group_member(group_id, auth.uid()))
);

-- Anyone in the group may add to it; only the author may change or remove
-- what they wrote, the way you cannot unsay somebody else's message.
drop policy if exists cc_notes_insert on cc_notes;
create policy cc_notes_insert on cc_notes for insert with check (
  created_by = auth.uid()
  and (group_id is null or cc_is_group_member(group_id, auth.uid()))
);

drop policy if exists cc_notes_update on cc_notes;
create policy cc_notes_update on cc_notes for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists cc_notes_delete on cc_notes;
create policy cc_notes_delete on cc_notes for delete using (created_by = auth.uid());

-- A note should land on the other screen as it is written.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_notes'
  ) then
    alter publication supabase_realtime add table cc_notes;
  end if;
end $$;

create table if not exists cc_note_events (
  note_id  uuid not null references cc_notes (id) on delete cascade,
  event_id uuid not null references cc_events (id) on delete cascade,
  pinned_by uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (note_id, event_id)
);

create index if not exists cc_note_events_event_idx on cc_note_events (event_id);

alter table cc_note_events enable row level security;

-- You may link a note you can read to an event you can see in full, and unlink
-- the same. Neither table's policy refers back here, so nothing recurses.
drop policy if exists cc_note_events_all on cc_note_events;
create policy cc_note_events_all on cc_note_events for all
  using (
    exists (
      select 1 from cc_notes n
      where n.id = note_id
        and (
          n.created_by = auth.uid()
          or (n.group_id is not null and cc_is_group_member(n.group_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from cc_notes n
      where n.id = note_id
        and (
          n.created_by = auth.uid()
          or (n.group_id is not null and cc_is_group_member(n.group_id, auth.uid()))
        )
    )
    and cc_event_access(event_id, auth.uid()) = 'full'
  );

-- Carry across anything pinned while a note could hold only one event. That
-- column only exists if the earlier single-event delta was ever run, so this
-- checks before reaching for it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cc_notes'
      and column_name = 'event_id'
  ) then
    execute $migrate$
      insert into cc_note_events (note_id, event_id, pinned_by)
      select n.id, n.event_id, n.created_by
      from cc_notes n
      where n.event_id is not null
      on conflict do nothing
    $migrate$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_note_events'
  ) then
    alter publication supabase_realtime add table cc_note_events;
  end if;
end $$;

-- 'note' joins the kinds a notification can be.
do $$
begin
  alter table cc_notifications drop constraint if exists cc_notifications_kind_check;
  alter table cc_notifications add constraint cc_notifications_kind_check
    check (kind in ('share', 'update', 'cancel', 'invite', 'note'));
end $$;

create or replace function cc_notify_note_pinned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  note        cc_notes%rowtype;
  event_title text;
  actor_name  text;
begin
  select * into note from cc_notes where id = new.note_id;
  if note.id is null then
    return new;
  end if;

  select title into event_title from cc_events where id = new.event_id;
  select display_name into actor_name from cc_profiles where id = new.pinned_by;

  -- Only people who can read the note AND see the event: a personal note has
  -- an audience of one, so pinning it tells nobody.
  insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
  select
    m.user_id,
    new.pinned_by,
    new.event_id,
    'note',
    coalesce(actor_name, 'Someone') || ' pinned a note to ' || coalesce(event_title, 'an event'),
    left(note.body, 240)
  from cc_group_members m
  where note.group_id is not null
    and m.group_id = note.group_id
    and m.user_id <> new.pinned_by
    and cc_event_access(new.event_id, m.user_id) = 'full';

  return new;
end;
$$;

drop trigger if exists cc_on_note_pinned on cc_note_events;
create trigger cc_on_note_pinned
  after insert on cc_note_events
  for each row execute function cc_notify_note_pinned();

-- ---------------------------------------------------------------------------
-- Reading feed
--
-- Row level security can hide rows but not columns, so "busy" access is served
-- by this view: it is the only object the client selects events from. Rows the
-- viewer may only see as busy come back stripped to their times, with a
-- masked = true flag; everything else is refused outright.
-- ---------------------------------------------------------------------------

create view cc_calendar_feed
with (security_invoker = false)
as
-- What you can see in your own right: your calendars, your groups' calendars,
-- events shared with you, and busy blocks from people you share a group with.
select
  e.id,
  e.calendar_id,
  c.owner_id,
  case when acc.level = 'full' then e.title else 'Busy' end        as title,
  case when acc.level = 'full' then e.notes end                    as notes,
  case when acc.level = 'full' then e.location end                 as location,
  e.starts_at,
  e.ends_at,
  e.all_day,
  case when acc.level = 'full' then e.color else 'slate' end       as color,
  case when acc.level = 'full' then e.privacy end                  as privacy,
  case when acc.level = 'full' then e.importance else 'normal' end as importance,
  case when acc.level = 'full' then e.created_by else c.owner_id end as created_by,
  case when acc.level = 'full' then e.feed_id end                  as feed_id,
  case when acc.level = 'full' then e.list_kind else 'todo' end    as list_kind,
  (acc.level = 'busy')                                             as masked
from cc_events e
join cc_calendars c on c.id = e.calendar_id
cross join lateral (select cc_event_access(e.id, auth.uid()) as level) acc
where acc.level in ('full', 'busy')
  and e.deleted_at is null

union all

-- Somebody you share a group with is a guest on an event: their time is taken,
-- whoever owns the event. A synthetic id keeps these distinct from the event
-- itself, and from each other when several guests are involved.
select
  md5(e.id::text || s.user_id::text)::uuid as id,
  e.calendar_id,
  s.user_id                                as owner_id,
  'Busy'                                   as title,
  null                                     as notes,
  null                                     as location,
  e.starts_at,
  e.ends_at,
  e.all_day,
  'slate'                                  as color,
  null                                     as privacy,
  'normal'                                 as importance,
  s.user_id                                as created_by,
  null                                     as feed_id,
  'todo'                                   as list_kind,
  true                                     as masked
from cc_events e
join cc_event_shares s on s.event_id = e.id
join cc_profiles p on p.id = s.user_id
where e.deleted_at is null
  and s.user_id <> auth.uid()
  and p.shared_busy
  and cc_users_share_group(auth.uid(), s.user_id)
  -- If you can already see the event in full, you do not need a block as well.
  and cc_event_access(e.id, auth.uid()) <> 'full';

grant select on cc_calendar_feed to authenticated;

-- Guests are only ever listed for events the viewer can see in full.
create view cc_event_guests
with (security_invoker = false)
as
select s.event_id, s.user_id, s.shared_by
from cc_event_shares s
where cc_event_access(s.event_id, auth.uid()) = 'full';

grant select on cc_event_guests to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
--
-- One private bucket for event files. Objects are keyed
-- <event_id>/<attachment_id>-<filename>, so the policies below can resolve the
-- owning event from the first path segment and reuse cc_event_access().
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cc_attachments',
  'cc_attachments',
  false,
  26214400, -- 25 MB
  null
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      public = excluded.public;

drop policy if exists cc_attachments_object_read on storage.objects;
create policy cc_attachments_object_read on storage.objects for select using (
  bucket_id = 'cc_attachments'
  and (
    owner = auth.uid()
    or exists (
      select 1 from cc_attachments a
      where a.storage_path = storage.objects.name
        and cc_event_access(a.event_id, auth.uid()) = 'full'
    )
  )
);

-- Uploads land under <user id>/…, which is all we can check before the file is
-- attached to an event.
drop policy if exists cc_attachments_object_write on storage.objects;
create policy cc_attachments_object_write on storage.objects for insert with check (
  bucket_id = 'cc_attachments'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists cc_attachments_object_delete on storage.objects;
create policy cc_attachments_object_delete on storage.objects for delete using (
  bucket_id = 'cc_attachments'
  and (
    owner = auth.uid()
    or exists (
      select 1 from cc_attachments a
      join cc_events e on e.id = a.event_id
      where a.storage_path = storage.objects.name
        and cc_can_write_calendar(e.calendar_id, auth.uid())
    )
  )
);


-- ==================================================================== --
-- Always share with, editable shares, and a record of who changed what
-- ==================================================================== --
-- ------------------------------------------------------------------ --
-- 1. Always share with
-- ------------------------------------------------------------------ --

-- People every new event of mine goes to, so a couple who plan everything
-- together do not have to say so on each event. It is a rule about future
-- events, not access to the calendar: removing somebody here leaves the events
-- already shared alone, which is why turning it on offers to catch up the past
-- and turning it off does not silently take things back.
create table if not exists cc_auto_share (
  owner_id   uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  user_id    uuid not null references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  constraint cc_auto_share_not_self check (owner_id <> user_id)
);

alter table cc_auto_share enable row level security;

drop policy if exists cc_auto_share_read on cc_auto_share;
-- Both ends may read it: you need to know who you are sharing with, and being
-- told "Dejan shares everything with you" is honest rather than a surprise.
create policy cc_auto_share_read on cc_auto_share for select
  using (owner_id = auth.uid() or user_id = auth.uid());

drop policy if exists cc_auto_share_write on cc_auto_share;
create policy cc_auto_share_write on cc_auto_share for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- An automatic share is not an announcement. Sharing something deliberately
-- should still reach the other person, so the two are told apart here rather
-- than by guessing in the trigger.
alter table if exists cc_event_shares
  add column if not exists automatic boolean not null default false;

create or replace function cc_notify_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_title text;
  actor_name  text;
begin
  if new.user_id = new.shared_by then
    return new;
  end if;

  -- Everything is shared with this person by standing arrangement; telling
  -- them about each one is noise they did not ask for.
  if new.automatic then
    return new;
  end if;

  select title into event_title from cc_events where id = new.event_id;
  select display_name into actor_name from cc_profiles where id = new.shared_by;

  insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
  values (
    new.user_id,
    new.shared_by,
    new.event_id,
    'share',
    coalesce(actor_name, 'Someone') || ' shared an event with you',
    event_title
  );

  return new;
end;
$$;

-- ------------------------------------------------------------------ --
-- 2. A share you can act on
-- ------------------------------------------------------------------ --

-- Sharing an event now means the other person can change it, not only look at
-- it — a couple moving each other's appointments is the ordinary case. Who did
-- what is recorded below, so "editable" does not mean "untraceable".
drop policy if exists cc_events_update on cc_events;
create policy cc_events_update on cc_events for update using (
  cc_can_write_calendar(calendar_id, auth.uid())
  or cc_is_shared_with(id, auth.uid())
) with check (
  cc_can_write_calendar(calendar_id, auth.uid())
  or cc_is_shared_with(id, auth.uid())
);

-- Deleting stays with the owner. Removing something from somebody else's
-- calendar is a different act from correcting the time on it.

-- ------------------------------------------------------------------ --
-- 3. Who changed what
-- ------------------------------------------------------------------ --

create table if not exists cc_event_changes (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references cc_events (id) on delete cascade,
  actor_id   uuid references cc_profiles (id) on delete set null,
  summary    text not null,
  created_at timestamptz not null default now()
);

create index if not exists cc_event_changes_event_idx
  on cc_event_changes (event_id, created_at desc);

alter table cc_event_changes enable row level security;

drop policy if exists cc_event_changes_read on cc_event_changes;
-- Anyone who can see the event can see how it got that way.
create policy cc_event_changes_read on cc_event_changes for select
  using (cc_event_access(event_id, auth.uid()) = 'full');

-- Written by the trigger below, which runs as the owner; nobody writes these
-- by hand, so there is no insert policy.

/**
 * Records an edit and tells the other people on the event.
 *
 * Only the fields somebody would want to hear about: what it is called, when
 * it is, and where. A silent reschedule is the thing that makes a shared
 * calendar untrustworthy.
 */
create or replace function cc_note_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor        uuid := auth.uid();
  actor_name   text;
  parts        text[] := '{}';
  summary      text;
  recipient    uuid;
  calendar_row cc_calendars%rowtype;
begin
  -- Deleting and restoring are their own actions, handled elsewhere.
  if new.deleted_at is distinct from old.deleted_at then
    return new;
  end if;

  if new.title is distinct from old.title then
    parts := parts || format('renamed it to "%s"', new.title);
  end if;

  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    parts := parts || format(
      'moved it to %s',
      to_char(new.starts_at at time zone 'UTC', 'FMDay FMDD FMMon, HH24:MI')
    );
  end if;

  if new.location is distinct from old.location then
    parts := parts || case
      when new.location is null or new.location = '' then 'removed the place'
      else format('changed the place to %s', new.location)
    end;
  end if;

  if array_length(parts, 1) is null then
    return new;
  end if;

  select display_name into actor_name from cc_profiles where id = actor;
  summary := coalesce(actor_name, 'Someone') || ' ' || array_to_string(parts, ', ');

  insert into cc_event_changes (event_id, actor_id, summary)
  values (new.id, actor, summary);

  -- Everybody the event reaches, except whoever just did it.
  select * into calendar_row from cc_calendars where id = new.calendar_id;

  for recipient in
    select user_id from cc_event_shares where event_id = new.id
    union
    select calendar_row.owner_id
    union
    select gm.user_id from cc_group_members gm
    where gm.group_id = calendar_row.group_id
  loop
    if recipient is null or recipient = actor then
      continue;
    end if;

    insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
    values (recipient, actor, new.id, 'update', summary, new.title);
  end loop;

  return new;
end;
$$;

drop trigger if exists cc_events_changed on cc_events;
create trigger cc_events_changed
  after update on cc_events
  for each row execute function cc_note_event_change();

-- Realtime, so an edit made on a phone lands on the laptop without a refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_event_changes'
  ) then
    alter publication supabase_realtime add table cc_event_changes;
  end if;
end;
$$;


-- ==================================================================== --
-- Everybody in a group agrees before somebody joins
-- ==================================================================== --

-- Joining a group is not a neutral act: from that moment the newcomer sees a
-- busy block for every event of every member, and the whole of any calendar
-- the group owns. The people whose calendars those are should get a say, so
-- adding somebody is now a proposal the others answer rather than something
-- one person does to everyone.

create table if not exists cc_group_join_requests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references cc_groups (id) on delete cascade,
  -- One of these two: somebody who already has an account, or an address
  -- that will be invited once the group agrees.
  invitee_id   uuid references cc_profiles (id) on delete cascade,
  email        text,
  proposed_by  uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  -- Filled once an approved request has actually gone out, so a second run
  -- cannot invite the same person twice.
  invitation_id uuid references cc_invitations (id) on delete set null,
  settled_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint cc_join_request_who check (invitee_id is not null or email is not null)
);

create index if not exists cc_group_join_requests_group_idx
  on cc_group_join_requests (group_id, status);

create table if not exists cc_group_join_votes (
  request_id uuid not null references cc_group_join_requests (id) on delete cascade,
  user_id    uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  approve    boolean not null,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table cc_group_join_requests enable row level security;
alter table cc_group_join_votes enable row level security;

drop policy if exists cc_group_join_requests_read on cc_group_join_requests;
-- The group can see what is being asked of it; so can the person proposed,
-- since it is about them.
create policy cc_group_join_requests_read on cc_group_join_requests for select
  using (
    cc_is_group_member(group_id, auth.uid())
    or invitee_id = auth.uid()
  );

-- Written only by the functions below, which check membership themselves.
-- There is deliberately no insert or update policy: a proposal that could be
-- written directly could also be marked approved directly.

drop policy if exists cc_group_join_votes_read on cc_group_join_votes;
create policy cc_group_join_votes_read on cc_group_join_votes for select
  using (
    exists (
      select 1 from cc_group_join_requests r
      where r.id = request_id and cc_is_group_member(r.group_id, auth.uid())
    )
  );

-- ------------------------------------------------------------------ --
-- Proposing
-- ------------------------------------------------------------------ --

/**
 * Asks the group to let somebody in.
 *
 * The proposer's own agreement is implied, so a group of one — a group you
 * have just made — approves immediately and nothing feels bureaucratic. Every
 * other member has to say yes.
 */
create or replace function cc_propose_member(
  p_group uuid,
  p_email text default null,
  p_invitee uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_id uuid;
  actor      uuid := auth.uid();
  actor_name text;
  group_name text;
  who        text;
  member     uuid;
begin
  if not cc_is_group_member(p_group, actor) then
    raise exception 'Only somebody already in the group can propose a member.';
  end if;

  if p_invitee is null and (p_email is null or p_email = '') then
    raise exception 'Say who should join.';
  end if;

  if p_invitee is not null and cc_is_group_member(p_group, p_invitee) then
    raise exception 'They are already in this group.';
  end if;

  -- Do not ask the group the same question twice.
  select id into request_id
  from cc_group_join_requests
  where group_id = p_group
    and status = 'pending'
    and (
      (p_invitee is not null and invitee_id = p_invitee)
      or (p_invitee is null and lower(email) = lower(p_email))
    )
  limit 1;
  if request_id is not null then
    return request_id;
  end if;

  insert into cc_group_join_requests (group_id, invitee_id, email, proposed_by)
  values (p_group, p_invitee, lower(nullif(p_email, '')), actor)
  returning id into request_id;

  -- Proposing is agreeing.
  insert into cc_group_join_votes (request_id, user_id, approve)
  values (request_id, actor, true);

  select display_name into actor_name from cc_profiles where id = actor;
  select name into group_name from cc_groups where id = p_group;
  select coalesce(
      (select display_name from cc_profiles where id = p_invitee),
      p_email
    ) into who;

  for member in
    select user_id from cc_group_members
    where group_id = p_group and user_id <> actor
  loop
    insert into cc_notifications (user_id, actor_id, kind, title, body)
    values (
      member,
      actor,
      'invite',
      coalesce(actor_name, 'Someone') || ' wants to add ' || who || ' to ' || coalesce(group_name, 'a group'),
      'They will see everybody''s busy times, and anything the group shares. Say yes or no in the sidebar.'
    );
  end loop;

  -- A group of one needs nobody else's permission.
  perform cc_settle_join_request(request_id);
  return request_id;
end;
$$;

-- ------------------------------------------------------------------ --
-- Answering
-- ------------------------------------------------------------------ --

/**
 * Decides a request once the answers are in: one refusal is enough to stop it,
 * and everybody has to have said yes for it to pass. Silence is not consent —
 * a member who has not answered keeps it waiting.
 */
create or replace function cc_settle_join_request(p_request uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request   cc_group_join_requests%rowtype;
  members   int;
  approvals int;
  refusals  int;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null or request.status <> 'pending' then
    return request.status;
  end if;

  select count(*) into refusals
  from cc_group_join_votes where request_id = p_request and not approve;

  if refusals > 0 then
    update cc_group_join_requests
       set status = 'denied', settled_at = now()
     where id = p_request;
    insert into cc_notifications (user_id, kind, title, body)
    values (
      request.proposed_by,
      'invite',
      'Not everybody agreed',
      'Somebody in the group would rather not add them, so no invitation was sent.'
    );
    return 'denied';
  end if;

  select count(*) into members
  from cc_group_members where group_id = request.group_id;

  select count(*) into approvals
  from cc_group_join_votes v
  join cc_group_members m
    on m.group_id = request.group_id and m.user_id = v.user_id
  where v.request_id = p_request and v.approve;

  if approvals < members then
    return 'pending';
  end if;

  update cc_group_join_requests
     set status = 'approved', settled_at = now()
   where id = p_request;

  -- The group has agreed; now the person does. Joining exposes their busy
  -- times to everyone here too, so nobody is put into a group unasked. An
  -- address with no account behind it is invited by email instead — see
  -- cc_pending_group_invites below.
  if request.invitee_id is not null then
    insert into cc_notifications (user_id, actor_id, kind, title, body)
    values (
      request.invitee_id,
      request.proposed_by,
      'invite',
      (select name from cc_groups where id = request.group_id) || ' would like you to join',
      'Everyone there will see when you are busy, and you will see the same of them.'
    );
  end if;

  return 'approved';
end;
$$;

/** One member's answer. */
create or replace function cc_vote_join_request(p_request uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null then
    raise exception 'That request is gone.';
  end if;
  if not cc_is_group_member(request.group_id, auth.uid()) then
    raise exception 'Only the group decides this.';
  end if;

  insert into cc_group_join_votes (request_id, user_id, approve)
  values (p_request, auth.uid(), p_approve)
  on conflict (request_id, user_id)
    do update set approve = excluded.approve, created_at = now();

  return cc_settle_join_request(p_request);
end;
$$;

/** The proposer changing their mind. */
create or replace function cc_withdraw_join_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update cc_group_join_requests
     set status = 'withdrawn', settled_at = now()
   where id = p_request
     and status = 'pending'
     and (proposed_by = auth.uid()
          or exists (select 1 from cc_groups g
                     where g.id = group_id and g.owner_id = auth.uid()));
end;
$$;

/**
 * The newcomer accepting. Nobody else can call this on their behalf, which is
 * the point: the group agreeing is only half of it.
 */
create or replace function cc_join_from_request(p_request uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
  joiner  text;
  member  uuid;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null or request.invitee_id <> auth.uid() then
    raise exception 'That invitation is not yours.';
  end if;
  if request.status <> 'approved' then
    raise exception 'That invitation is not open.';
  end if;

  if not p_accept then
    update cc_group_join_requests
       set status = 'denied', settled_at = now()
     where id = p_request;
    return 'denied';
  end if;

  insert into cc_group_members (group_id, user_id, role)
  values (request.group_id, auth.uid(), 'member')
  on conflict do nothing;

  select display_name into joiner from cc_profiles where id = auth.uid();

  for member in
    select user_id from cc_group_members
    where group_id = request.group_id and user_id <> auth.uid()
  loop
    insert into cc_notifications (user_id, actor_id, kind, title, body)
    values (
      member,
      auth.uid(),
      'invite',
      coalesce(joiner, 'Somebody') || ' joined ' ||
        (select name from cc_groups where id = request.group_id),
      null
    );
  end loop;

  return 'joined';
end;
$$;

-- The newcomer needs to see the request in order to answer it, and to add
-- themselves once it has been approved. Both are checked in the function
-- above; this is the row-level half.
drop policy if exists cc_group_members_insert on cc_group_members;
create policy cc_group_members_insert on cc_group_members for insert
  with check (
    user_id = auth.uid()
    and (
      exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid())
      or exists (
        select 1 from cc_group_join_requests r
        where r.group_id = cc_group_members.group_id
          and r.invitee_id = auth.uid()
          and r.status = 'approved'
      )
    )
  );

-- ------------------------------------------------------------------ --
-- Sending what was agreed
-- ------------------------------------------------------------------ --

/**
 * Approved requests for people who have no account yet, waiting for their
 * invitation to be sent. Read by the app, which does the mail; the invitation
 * itself is created by cc_record_group_invitation so that no client can mint
 * one carrying a group.
 */
create or replace function cc_pending_group_invites()
returns table (request_id uuid, group_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.group_id, r.email
  from cc_group_join_requests r
  where r.status = 'approved'
    and r.invitation_id is null
    and r.email is not null
    and cc_is_group_member(r.group_id, auth.uid());
$$;

/** Turns an approved request into a real invitation, once. */
create or replace function cc_record_group_invitation(p_request uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
  new_id  uuid;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null or request.status <> 'approved' or request.invitation_id is not null then
    return null;
  end if;
  if not cc_is_group_member(request.group_id, auth.uid()) then
    raise exception 'Only the group can send this.';
  end if;

  insert into cc_invitations (email, token, invited_by, group_id)
  values (request.email, p_token, request.proposed_by, request.group_id)
  returning id into new_id;

  update cc_group_join_requests set invitation_id = new_id where id = p_request;
  return new_id;
end;
$$;

-- ------------------------------------------------------------------ --
-- Closing the side doors
-- ------------------------------------------------------------------ --

-- An invitation that carries a group is how somebody gets into it, so it may
-- no longer be written directly — only by cc_record_group_invitation, after
-- the group has agreed. Invitations to a single event are unaffected: sharing
-- one event exposes nobody else's calendar.
drop policy if exists cc_invitations_write on cc_invitations;
create policy cc_invitations_write on cc_invitations for all
  using (invited_by = auth.uid())
  with check (invited_by = auth.uid() and group_id is null);

-- Likewise membership itself: the owner may still remove people, but adding
-- goes through the vote. Everyone can show themselves out.
drop policy if exists cc_group_members_write on cc_group_members;
drop policy if exists cc_group_members_update on cc_group_members;
create policy cc_group_members_update on cc_group_members for update
  using (exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid()))
  with check (exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid()));

drop policy if exists cc_group_members_delete on cc_group_members;
create policy cc_group_members_delete on cc_group_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid())
  );

-- Making a group with yourself in it is still one step; anybody else named at
-- that moment becomes a proposal, which a group of one approves at once, and
-- which they then accept for themselves.

-- Realtime, so an answer on a phone updates the laptop.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_group_join_requests'
  ) then
    alter publication supabase_realtime add table cc_group_join_requests;
  end if;
end;
$$;


-- ==================================================================== --
-- Events that repeat
-- ==================================================================== --
-- A repeating event is one row with a rule, not a row per occurrence. The
-- mortgage on the 1st for the next thirty years is one event; changing the
-- amount changes one thing, and the table does not grow by 360 rows.
alter table if exists cc_events
  add column if not exists rrule text;

-- The exceptions to the rule: an occurrence somebody skipped, or one that has
-- been moved and now lives as its own event. Both are needed the first time
-- the bins are not collected on a bank holiday.
create table if not exists cc_event_exceptions (
  event_id         uuid not null references cc_events (id) on delete cascade,
  -- The occurrence this is about, identified by when it would have started.
  occurrence_start timestamptz not null,
  -- The event that replaces it, when it was moved rather than skipped.
  override_id      uuid references cc_events (id) on delete cascade,
  created_by       uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (event_id, occurrence_start)
);

create index if not exists cc_event_exceptions_event_idx
  on cc_event_exceptions (event_id);

alter table cc_event_exceptions enable row level security;

drop policy if exists cc_event_exceptions_read on cc_event_exceptions;
-- Anyone who can see the series can see which occurrences are not happening;
-- without that they would be shown collections that were cancelled.
create policy cc_event_exceptions_read on cc_event_exceptions for select
  using (cc_event_access(event_id, auth.uid()) in ('full', 'busy'));

drop policy if exists cc_event_exceptions_write on cc_event_exceptions;
create policy cc_event_exceptions_write on cc_event_exceptions for all
  using (
    exists (
      select 1 from cc_events e
      where e.id = event_id
        and (cc_can_write_calendar(e.calendar_id, auth.uid())
             or cc_is_shared_with(e.id, auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from cc_events e
      where e.id = event_id
        and (cc_can_write_calendar(e.calendar_id, auth.uid())
             or cc_is_shared_with(e.id, auth.uid()))
    )
  );

-- Moving one collection is not a change to the series, so it should not be
-- announced as one — the override is its own event and speaks for itself.
create or replace function cc_note_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor        uuid := auth.uid();
  actor_name   text;
  parts        text[] := '{}';
  summary      text;
  recipient    uuid;
  calendar_row cc_calendars%rowtype;
begin
  if new.deleted_at is distinct from old.deleted_at then
    return new;
  end if;

  if new.title is distinct from old.title then
    parts := parts || format('renamed it to "%s"', new.title);
  end if;

  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    parts := parts || format(
      'moved it to %s',
      to_char(new.starts_at at time zone 'UTC', 'FMDay FMDD FMMon, HH24:MI')
    );
  end if;

  if new.location is distinct from old.location then
    parts := parts || case
      when new.location is null or new.location = '' then 'removed the place'
      else format('changed the place to %s', new.location)
    end;
  end if;

  if new.rrule is distinct from old.rrule then
    parts := parts || case
      when new.rrule is null then 'stopped it repeating'
      when old.rrule is null then 'made it repeat'
      else 'changed how often it repeats'
    end;
  end if;

  if array_length(parts, 1) is null then
    return new;
  end if;

  select display_name into actor_name from cc_profiles where id = actor;
  summary := coalesce(actor_name, 'Someone') || ' ' || array_to_string(parts, ', ');

  insert into cc_event_changes (event_id, actor_id, summary)
  values (new.id, actor, summary);

  select * into calendar_row from cc_calendars where id = new.calendar_id;

  for recipient in
    select user_id from cc_event_shares where event_id = new.id
    union
    select calendar_row.owner_id
    union
    select gm.user_id from cc_group_members gm
    where gm.group_id = calendar_row.group_id
  loop
    if recipient is null or recipient = actor then
      continue;
    end if;

    insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
    values (recipient, actor, new.id, 'update', summary, new.title);
  end loop;

  return new;
end;
$$;

-- The feed carries the rule so the calendar can work out the occurrences.
-- A masked event exposes its pattern but nothing else: without it somebody
-- else's weekly commitment would show as busy once and then vanish, which is
-- worse than useless for finding a free evening.
drop view if exists cc_calendar_feed;

create view cc_calendar_feed
with (security_invoker = false)
as
select
  e.id,
  e.calendar_id,
  c.owner_id,
  case when acc.level = 'full' then e.title else 'Busy' end        as title,
  case when acc.level = 'full' then e.notes end                    as notes,
  case when acc.level = 'full' then e.location end                 as location,
  e.starts_at,
  e.ends_at,
  e.all_day,
  case when acc.level = 'full' then e.color else 'slate' end       as color,
  case when acc.level = 'full' then e.privacy end                  as privacy,
  case when acc.level = 'full' then e.importance else 'normal' end as importance,
  case when acc.level = 'full' then e.created_by else c.owner_id end as created_by,
  case when acc.level = 'full' then e.feed_id end                  as feed_id,
  case when acc.level = 'full' then e.list_kind else 'todo' end    as list_kind,
  (acc.level = 'busy')                                             as masked,
  e.rrule
from cc_events e
join cc_calendars c on c.id = e.calendar_id
cross join lateral (select cc_event_access(e.id, auth.uid()) as level) acc
where acc.level in ('full', 'busy')
  and e.deleted_at is null

union all

select
  md5(e.id::text || s.user_id::text)::uuid as id,
  e.calendar_id,
  s.user_id                                as owner_id,
  'Busy'                                   as title,
  null                                     as notes,
  null                                     as location,
  e.starts_at,
  e.ends_at,
  e.all_day,
  'slate'                                  as color,
  null                                     as privacy,
  'normal'                                 as importance,
  s.user_id                                as created_by,
  null                                     as feed_id,
  'todo'                                   as list_kind,
  true                                     as masked,
  e.rrule
from cc_events e
join cc_event_shares s on s.event_id = e.id
join cc_profiles p on p.id = s.user_id
where e.deleted_at is null
  and s.user_id <> auth.uid()
  and p.shared_busy
  and cc_users_share_group(auth.uid(), s.user_id)
  and cc_event_access(e.id, auth.uid()) <> 'full';

grant select on cc_calendar_feed to authenticated;


-- ==================================================================== --
-- Your own CalDAV server
-- ==================================================================== --
-- Everybody brings their own server, so the credentials belong to the person
-- rather than to the deployment. The app password is stored encrypted and the
-- column is unreadable to signed-in clients: only the server routines that
-- talk to the far end can decrypt it, and there is no request that returns it.
create table if not exists cc_caldav_links (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  -- What was typed in: https://host/remote.php/dav for Nextcloud.
  base_url       text not null,
  username       text not null,
  -- AES-256-GCM, keyed from the server's environment. Never leaves the server.
  secret         text not null,
  -- The calendar chosen at the far end, and what it is called there.
  calendar_href  text,
  calendar_name  text,
  -- Which calendar here is sent over. Null means everything the owner owns.
  source_calendar_id uuid references cc_calendars (id) on delete set null,
  -- Events other people shared with you appear on your calendar, so they
  -- belong in the copy of it kept elsewhere. Only ones you may see in full.
  include_shared boolean not null default true,
  last_pushed_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);

create index if not exists cc_caldav_links_owner_idx on cc_caldav_links (owner_id);

alter table cc_caldav_links enable row level security;

drop policy if exists cc_caldav_links_own on cc_caldav_links;
create policy cc_caldav_links_own on cc_caldav_links for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Nobody signed in touches these tables at all. Revoking the column alone did
-- nothing — a table-level SELECT privilege reads every column, and column
-- grants only add to a role that lacks it — so a signed-in owner could read
-- their own encrypted password straight back out.
--
-- Only the server routines that talk to the far end use these, and they hold
-- the service role, which these grants do not apply to.
revoke all on cc_caldav_links from anon, authenticated;

-- What has been written to the far end, so a second push replaces an event
-- rather than making another copy of it. The ETag is how the server tells us
-- whether our copy is still the current one.
create table if not exists cc_caldav_objects (
  link_id    uuid not null references cc_caldav_links (id) on delete cascade,
  event_id   uuid not null references cc_events (id) on delete cascade,
  href       text not null,
  etag       text,
  pushed_at  timestamptz not null default now(),
  primary key (link_id, event_id)
);

alter table cc_caldav_objects enable row level security;

revoke all on cc_caldav_objects from anon, authenticated;

drop policy if exists cc_caldav_objects_own on cc_caldav_objects;
create policy cc_caldav_objects_own on cc_caldav_objects for all
  using (
    exists (
      select 1 from cc_caldav_links l
      where l.id = link_id and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from cc_caldav_links l
      where l.id = link_id and l.owner_id = auth.uid()
    )
  );
