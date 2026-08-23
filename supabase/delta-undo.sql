-- DocMaker Calendar — delta: deleted events are kept, not destroyed.
-- Safe to run repeatedly.
--
-- Deleting now sets deleted_at. The event leaves the calendar immediately but
-- survives, so it can be restored minutes or days later. Anything still in the
-- bin after 30 days is cleared by the cron.

alter table if exists cc_events
  add column if not exists deleted_at timestamptz;

create index if not exists cc_events_deleted_idx
  on cc_events (deleted_at)
  where deleted_at is not null;

-- The feed carries only live events; the bin is read from cc_events directly
-- by whoever can write the calendar.
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
where acc.level in ('full', 'busy')
  and e.deleted_at is null;

grant select on cc_calendar_feed to authenticated;

create view cc_event_guests
with (security_invoker = false)
as
select s.event_id, s.user_id, s.shared_by
from cc_event_shares s
where cc_event_access(s.event_id, auth.uid()) = 'full';

grant select on cc_event_guests to authenticated;
