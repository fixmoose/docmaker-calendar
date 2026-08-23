-- DocMaker Calendar — delta: an event shared with you blocks your time.
-- Safe to run repeatedly. Run this whole file.
--
-- Until now a shared event appeared on your calendar but lived on the other
-- person's, so it never made YOU look busy to your own groups — your family
-- could book over your physiotherapy because it belonged to Ellen. Copying it
-- across fixed that, which is why the app offered to, but nobody should have
-- to know that, let alone do it by hand.
--
-- The feed now emits a busy block for anyone you share a group with who is a
-- guest on an event — the same anonymous grey block used everywhere else. No
-- details cross: only that the time is taken.

alter table if exists cc_profiles
  add column if not exists shared_busy boolean not null default true;

comment on column cc_profiles.shared_busy is
  'Whether events shared with this person mark them busy to their groups.';

drop view if exists cc_calendar_feed;

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
