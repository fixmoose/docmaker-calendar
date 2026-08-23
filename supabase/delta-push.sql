-- DocMaker Calendar — delta: browser push subscriptions. Safe to run repeatedly.

-- One row per browser that has agreed to be notified. Deleting a row is how a
-- device unsubscribes, and the sender deletes any endpoint the push service
-- reports as gone.
create table if not exists cc_push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists cc_push_subscriptions_user_idx
  on cc_push_subscriptions (user_id);

alter table cc_push_subscriptions enable row level security;

drop policy if exists cc_push_subscriptions_all on cc_push_subscriptions;
create policy cc_push_subscriptions_all on cc_push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Notifications remember whether a push has gone out, so the backstop cron
-- does not repeat one the sharer's browser already delivered.
alter table if exists cc_notifications
  add column if not exists pushed_at timestamptz;
