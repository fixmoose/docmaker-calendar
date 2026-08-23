-- DocMaker Calendar — delta for per-event invitations.
-- Safe to run repeatedly. (Re-running the whole schema.sql works too.)

alter table cc_invitations
  add column if not exists event_id uuid references cc_events (id) on delete cascade;

-- The earlier version returned a table; a return type cannot be changed in
-- place, so the old signature is dropped first.
drop function if exists cc_accept_invitation(text);

-- Redeems an invitation: makes sure the invitee exists in this app, joins the
-- group it was sent for, grants the event it was about, and marks it used.
-- Security definer, because the invitee can see none of those things yet.
create or replace function cc_accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite cc_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept an invitation.';
  end if;

  -- They may never have opened the calendar, so they may have no profile yet
  -- and the foreign keys below would fail.
  perform cc_bootstrap_me();

  select * into invite
  from cc_invitations
  where token = p_token and status <> 'accepted'
  limit 1;

  if invite.id is null then
    raise exception 'This invitation is no longer valid.';
  end if;

  if invite.group_id is not null then
    insert into cc_group_members (group_id, user_id, role)
    values (invite.group_id, auth.uid(), 'member')
    on conflict do nothing;
  end if;

  -- Invited to one specific event: hand over that share now.
  if invite.event_id is not null then
    insert into cc_event_shares (event_id, user_id, shared_by)
    values (invite.event_id, auth.uid(), invite.invited_by)
    on conflict do nothing;
  end if;

  update cc_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = invite.id;

  return jsonb_build_object(
    'group_id', invite.group_id,
    'event_id', invite.event_id,
    'invited_by', invite.invited_by
  );
end;
$$;
