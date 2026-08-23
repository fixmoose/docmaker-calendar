-- DocMaker Calendar — THE FIX for "event could not be created" (42501).
-- Safe to run repeatedly. Run this whole file.
--
-- cc_events_read called cc_event_access(id, auth.uid()), which looks the row up
-- in cc_events. The function is STABLE, so it sees the statement's snapshot —
-- and during INSERT ... RETURNING the new row is not in it yet. The function
-- returned NULL, NULL = 'full' is not true, and the row the client asked for
-- back was refused. Every event creation failed, because the client asks for
-- the new id in order to attach shares, reminders and files to it.
--
-- The policy now decides from the row's own columns, which is both correct
-- during INSERT ... RETURNING and faster: no self-lookup per row.

drop policy if exists cc_events_read on cc_events;
create policy cc_events_read on cc_events for select using (
  -- Full access only. Busy blocks are served by cc_calendar_feed, never from
  -- this table, so nothing here may match an event you may only see as busy.
  exists (
    select 1
    from cc_calendars c
    where c.id = cc_events.calendar_id
      and (
        -- your own calendar
        c.owner_id = auth.uid()
        -- a calendar your group shares
        or (c.kind = 'shared' and cc_is_group_member(c.group_id, auth.uid()))
        -- somebody who publishes details to the groups you share with them
        or (
          coalesce(cc_events.privacy, c.privacy) = 'details'
          and exists (
            select 1
            from cc_group_members mine
            join cc_group_members theirs on theirs.group_id = mine.group_id
            where mine.user_id = auth.uid() and theirs.user_id = c.owner_id
          )
        )
      )
  )
  -- or it was shared with you directly
  or exists (
    select 1 from cc_event_shares s
    where s.event_id = cc_events.id and s.user_id = auth.uid()
  )
);
