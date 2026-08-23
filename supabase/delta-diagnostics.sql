-- DocMaker Calendar — delta: policy visibility + rebuild the cc_events policies.
-- Safe to run repeatedly. Run this whole file.

-- 1. A read-only report of what row level security actually looks like, so the
--    policies can be inspected from outside the SQL editor. Service role only:
--    policy expressions describe the locks, so they are not for the public.
create or replace function cc_policy_report()
returns table (
  table_name text,
  policy_name text,
  command text,
  roles text,
  using_expression text,
  check_expression text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tablename::text,
    policyname::text,
    cmd::text,
    array_to_string(roles, ',')::text,
    coalesce(qual, '')::text,
    coalesce(with_check, '')::text
  from pg_policies
  where schemaname = 'public' and tablename like 'cc\_%'
  order by tablename, cmd, policyname;
$$;

revoke all on function cc_policy_report() from public, anon, authenticated;
grant execute on function cc_policy_report() to service_role;

-- Which tables have row level security switched on at all.
create or replace function cc_rls_report()
returns table (table_name text, rls_enabled boolean, policy_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*) from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'cc\_%'
  order by c.relname;
$$;

revoke all on function cc_rls_report() from public, anon, authenticated;
grant execute on function cc_rls_report() to service_role;

-- 2. Rebuild the cc_events policies, in case an aborted run left them dropped.
drop policy if exists cc_events_read on cc_events;
create policy cc_events_read on cc_events for select using (
  cc_event_access(id, auth.uid()) = 'full'
);

drop policy if exists cc_events_insert on cc_events;
create policy cc_events_insert on cc_events for insert with check (
  created_by = auth.uid() and cc_can_write_calendar(calendar_id, auth.uid())
);

drop policy if exists cc_events_update on cc_events;
create policy cc_events_update on cc_events for update using (
  feed_id is null and cc_can_write_calendar(calendar_id, auth.uid())
) with check (
  feed_id is null and cc_can_write_calendar(calendar_id, auth.uid())
);

drop policy if exists cc_events_delete on cc_events;
create policy cc_events_delete on cc_events for delete using (
  cc_can_write_calendar(calendar_id, auth.uid())
);

-- 3. Make sure the ownership defaults are in place, since the client relies on
--    them to satisfy "created_by = auth.uid()".
alter table cc_events      alter column created_by  set default auth.uid();
alter table cc_calendars   alter column owner_id    set default auth.uid();
alter table cc_groups      alter column owner_id    set default auth.uid();
alter table cc_event_shares alter column shared_by  set default auth.uid();
alter table cc_attachments alter column uploaded_by set default auth.uid();
