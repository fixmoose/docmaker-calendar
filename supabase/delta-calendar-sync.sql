-- DocMaker Calendar — delta: subscribing to Google / Outlook calendars.
-- Safe to run repeatedly.

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

-- The feed view gains feed_id, so the app knows which events are imported
-- and keeps them read-only.
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
