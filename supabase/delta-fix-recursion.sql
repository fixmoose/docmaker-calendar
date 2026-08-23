-- DocMaker Calendar — FIX for 42P17, infinite recursion on cc_events.
-- Safe to run repeatedly. Run this whole file.
--
-- The read policy on cc_events asked cc_event_shares whether the event was
-- shared with you. The read policy on cc_event_shares asks cc_events whether
-- you may see the event. Each waits on the other, and Postgres stops it.
--
-- The lookups a policy needs across tables now go through security definer
-- functions, which run as the owner and so are not filtered by the policies
-- that call them. Neither function reads cc_events, which is what kept the
-- earlier version from returning a row it had just inserted.

create or replace function cc_is_shared_with(p_event uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from cc_event_shares s
    where s.event_id = p_event and s.user_id = p_user
  );
$$;

-- Two people are connected when they sit in at least one group together.
create or replace function cc_users_share_group(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from cc_group_members mine
    join cc_group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = p_a and theirs.user_id = p_b
  );
$$;

drop policy if exists cc_events_read on cc_events;
create policy cc_events_read on cc_events for select using (
  -- Full access only. Busy blocks come from cc_calendar_feed, never from here.
  exists (
    select 1
    from cc_calendars c
    where c.id = cc_events.calendar_id
      and (
        c.owner_id = auth.uid()
        or (c.kind = 'shared' and cc_is_group_member(c.group_id, auth.uid()))
        or (
          coalesce(cc_events.privacy, c.privacy) = 'details'
          and cc_users_share_group(auth.uid(), c.owner_id)
        )
      )
  )
  or cc_is_shared_with(cc_events.id, auth.uid())
);
