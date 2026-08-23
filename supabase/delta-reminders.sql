-- DocMaker Calendar — delta: reminders. Safe to run repeatedly.

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
