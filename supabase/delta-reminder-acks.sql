-- DocMaker Calendar — delta: a reminder is answered once, not once per device.
-- Safe to run repeatedly.

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
