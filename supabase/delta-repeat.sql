-- DocMaker Calendar — delta: events that repeat. Safe to run repeatedly.

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
