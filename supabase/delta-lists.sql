-- DocMaker Calendar — delta: a list attached to an event. Safe to run repeatedly.

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

-- The feed view gains list_kind.
drop view if exists cc_calendar_feed;
drop view if exists cc_event_guests;

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
  (acc.level = 'busy')                                             as masked
from cc_events e
join cc_calendars c on c.id = e.calendar_id
cross join lateral (select cc_event_access(e.id, auth.uid()) as level) acc
where acc.level in ('full', 'busy');

grant select on cc_calendar_feed to authenticated;

-- Guests are only ever listed for events the viewer can see in full.
create view cc_event_guests
with (security_invoker = false)
as
select s.event_id, s.user_id, s.shared_by
from cc_event_shares s
where cc_event_access(s.event_id, auth.uid()) = 'full';

grant select on cc_event_guests to authenticated;
