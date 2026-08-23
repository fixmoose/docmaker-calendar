-- DocMaker Calendar — delta: personal reminders + a notification inbox.
-- Safe to run repeatedly.

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
  kind       text not null check (kind in ('share', 'update', 'cancel', 'invite')),
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
