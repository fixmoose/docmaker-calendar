-- DocMaker Calendar — delta: always share with, editable shares, and a record of
-- who changed what. Safe to run repeatedly.

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
