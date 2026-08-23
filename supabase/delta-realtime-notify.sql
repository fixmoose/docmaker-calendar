-- DocMaker Calendar — delta: live notifications + per-event delivery choice.
-- Safe to run repeatedly.

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
