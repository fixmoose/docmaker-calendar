-- CouplesCalendar — delta: fix 23505 when somebody saves an event that was
-- shared with them. Safe to run repeatedly.

-- Sharing became editable, but the guest list did not follow. Saving an event
-- rewrites its guests — delete them, insert them again — and the delete was
-- refused for anybody who is not the sharer and cannot write the calendar. RLS
-- refuses silently, removing nothing, so the insert then collided with the
-- rows that were still there:
--
--   duplicate key value violates unique constraint "cc_event_shares_pkey"
--
-- Whoever may change the event may change who is on it. cc_is_shared_with runs
-- as its owner and is therefore not itself filtered by this policy, so naming
-- cc_event_shares inside a policy on cc_event_shares does not recurse.
drop policy if exists cc_event_shares_write on cc_event_shares;
create policy cc_event_shares_write on cc_event_shares for all using (
  shared_by = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1 from cc_events e
    where e.id = event_id
      and (cc_can_write_calendar(e.calendar_id, auth.uid())
           or cc_is_shared_with(e.id, auth.uid()))
  )
) with check (
  shared_by = auth.uid()
);
