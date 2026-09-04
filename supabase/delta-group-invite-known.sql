-- DocMaker Calendar — delta: an address that already has an account is that
-- person. Safe to run repeatedly.

-- Somebody was invited, signed up, and was then proposed for a group by the
-- only thing the dialog knew about her: her address. Nothing joined the two
-- up, so the group agreed about an email rather than about a person — and the
-- agreement had nowhere to land. She was sent a second invitation to an
-- account she already had, and it sat unsent; meanwhile she could not accept,
-- because accepting is only offered to the person a request names. Approved,
-- pending, and stuck.
--
-- Four changes: an address is resolved to its account when the group is asked,
-- and again when it agrees (somebody may sign up in between); proposing
-- somebody the group has already agreed to nudges them instead of asking the
-- same question a second time; and joining answers any invitation still out
-- for that group, so nobody stays "pending" after they are through the door.

/* ------------------------------------------------------------------ *
 * Proposing
 * ------------------------------------------------------------------ */

create or replace function cc_propose_member(
  p_group uuid,
  p_email text default null,
  p_invitee uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_id uuid;
  actor      uuid := auth.uid();
  actor_name text;
  group_name text;
  who        text;
  member     uuid;
begin
  if not cc_is_group_member(p_group, actor) then
    raise exception 'Only somebody already in the group can propose a member.';
  end if;

  if p_invitee is null and (p_email is null or p_email = '') then
    raise exception 'Say who should join.';
  end if;

  -- An address with an account behind it is a person, and the dialog cannot
  -- always know that: somebody you have never shared anything with is not in
  -- your list of people, so you type their address and mean them.
  if p_invitee is null then
    select id into p_invitee from cc_profiles where lower(email) = lower(p_email);
  end if;

  if p_invitee is not null and cc_is_group_member(p_group, p_invitee) then
    raise exception 'They are already in this group.';
  end if;

  -- Do not ask the group the same question twice.
  select id into request_id
  from cc_group_join_requests
  where group_id = p_group
    and status = 'pending'
    and (
      (p_invitee is not null and (invitee_id = p_invitee or lower(email) = lower(p_email)))
      or (p_invitee is null and lower(email) = lower(p_email))
    )
  limit 1;
  if request_id is not null then
    return request_id;
  end if;

  -- The group may already have agreed and be waiting on the person. Asking
  -- the same question twice leaves two cards to answer and one of them stale;
  -- what is wanted here is a nudge.
  select id into request_id
  from cc_group_join_requests
  where group_id = p_group
    and status = 'approved'
    and (
      (p_invitee is not null and invitee_id = p_invitee)
      or (p_invitee is null and lower(email) = lower(p_email))
    )
  limit 1;
  if request_id is not null then
    if p_invitee is not null then
      insert into cc_notifications (user_id, actor_id, kind, title, body)
      values (
        p_invitee,
        actor,
        'invite',
        (select name from cc_groups where id = p_group) || ' would like you to join',
        'Everyone there has already agreed — this is waiting on you.'
      );
    end if;
    return request_id;
  end if;

  insert into cc_group_join_requests (group_id, invitee_id, email, proposed_by)
  values (p_group, p_invitee, lower(nullif(p_email, '')), actor)
  returning id into request_id;

  -- Proposing is agreeing.
  insert into cc_group_join_votes (request_id, user_id, approve)
  values (request_id, actor, true);

  select display_name into actor_name from cc_profiles where id = actor;
  select name into group_name from cc_groups where id = p_group;
  select coalesce(
      (select display_name from cc_profiles where id = p_invitee),
      p_email
    ) into who;

  for member in
    select user_id from cc_group_members
    where group_id = p_group and user_id <> actor
  loop
    insert into cc_notifications (user_id, actor_id, kind, title, body)
    values (
      member,
      actor,
      'invite',
      coalesce(actor_name, 'Someone') || ' wants to add ' || who || ' to ' || coalesce(group_name, 'a group'),
      'They will see everybody''s busy times, and anything the group shares. Say yes or no in the sidebar.'
    );
  end loop;

  -- A group of one needs nobody else's permission.
  perform cc_settle_join_request(request_id);
  return request_id;
end;
$$;

/* ------------------------------------------------------------------ *
 * Settling
 * ------------------------------------------------------------------ */

create or replace function cc_settle_join_request(p_request uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request   cc_group_join_requests%rowtype;
  members   int;
  approvals int;
  refusals  int;
  account   uuid;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null or request.status <> 'pending' then
    return request.status;
  end if;

  select count(*) into refusals
  from cc_group_join_votes where request_id = p_request and not approve;

  if refusals > 0 then
    update cc_group_join_requests
       set status = 'denied', settled_at = now()
     where id = p_request;
    insert into cc_notifications (user_id, kind, title, body)
    values (
      request.proposed_by,
      'invite',
      'Not everybody agreed',
      'Somebody in the group would rather not add them, so no invitation was sent.'
    );
    return 'denied';
  end if;

  select count(*) into members
  from cc_group_members where group_id = request.group_id;

  select count(*) into approvals
  from cc_group_join_votes v
  join cc_group_members m
    on m.group_id = request.group_id and m.user_id = v.user_id
  where v.request_id = p_request and v.approve;

  if approvals < members then
    return 'pending';
  end if;

  update cc_group_join_requests
     set status = 'approved', settled_at = now()
   where id = p_request;

  -- Asking the group takes as long as it takes, and somebody can sign up in
  -- the meantime. Ask again who this address belongs to before deciding that
  -- it belongs to nobody.
  if request.invitee_id is null and request.email is not null then
    select id into account from cc_profiles where lower(email) = lower(request.email);
    if account is not null then
      update cc_group_join_requests set invitee_id = account where id = p_request;
      request.invitee_id := account;
    end if;
  end if;

  -- The group has agreed; now the person does. Joining exposes their busy
  -- times to everyone here too, so nobody is put into a group unasked. An
  -- address with no account behind it is invited by email instead — see
  -- cc_pending_group_invites.
  if request.invitee_id is not null then
    insert into cc_notifications (user_id, actor_id, kind, title, body)
    values (
      request.invitee_id,
      request.proposed_by,
      'invite',
      (select name from cc_groups where id = request.group_id) || ' would like you to join',
      'Everyone there will see when you are busy, and you will see the same of them.'
    );
  end if;

  return 'approved';
end;
$$;

/* ------------------------------------------------------------------ *
 * Joining
 * ------------------------------------------------------------------ */

create or replace function cc_join_from_request(p_request uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
  joiner  text;
  address text;
  member  uuid;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null or request.invitee_id <> auth.uid() then
    raise exception 'That invitation is not yours.';
  end if;
  if request.status <> 'approved' then
    raise exception 'That invitation is not open.';
  end if;

  if not p_accept then
    update cc_group_join_requests
       set status = 'denied', settled_at = now()
     where id = p_request;
    return 'denied';
  end if;

  insert into cc_group_members (group_id, user_id, role)
  values (request.group_id, auth.uid(), 'member')
  on conflict do nothing;

  select display_name, email into joiner, address
  from cc_profiles where id = auth.uid();

  -- Being here answers anything still out for this group: somebody through
  -- the door should not go on reading as pending.
  update cc_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where group_id = request.group_id
     and status in ('pending', 'sent')
     and lower(email) = lower(coalesce(address, ''));

  for member in
    select user_id from cc_group_members
    where group_id = request.group_id and user_id <> auth.uid()
  loop
    insert into cc_notifications (user_id, actor_id, kind, title, body)
    values (
      member,
      auth.uid(),
      'invite',
      coalesce(joiner, 'Somebody') || ' joined ' ||
        (select name from cc_groups where id = request.group_id),
      null
    );
  end loop;

  return 'joined';
end;
$$;

/* ------------------------------------------------------------------ *
 * Putting right what is already stuck
 * ------------------------------------------------------------------ */

-- Requests raised against an address that has an account: joined up now, so
-- the people they name can answer them. A second run matches nothing, since
-- only requests still naming nobody are touched.
with matched as (
  update cc_group_join_requests r
     set invitee_id = p.id
    from cc_profiles p
   where r.invitee_id is null
     and r.email is not null
     and lower(p.email) = lower(r.email)
     and r.status in ('pending', 'approved')
  returning r.id, r.group_id, r.invitee_id, r.proposed_by, r.status
)
insert into cc_notifications (user_id, actor_id, kind, title, body)
select
  m.invitee_id,
  m.proposed_by,
  'invite',
  (select name from cc_groups g where g.id = m.group_id) || ' would like you to join',
  'Everyone there will see when you are busy, and you will see the same of them.'
from matched m
where m.status = 'approved';

-- A question asked twice: where the group has already agreed about somebody,
-- an older pending copy is nothing anybody needs to answer.
update cc_group_join_requests r
   set status = 'withdrawn', settled_at = now()
 where r.status = 'pending'
   and exists (
     select 1 from cc_group_join_requests a
     where a.group_id = r.group_id
       and a.status = 'approved'
       and a.id <> r.id
       and (
         (r.invitee_id is not null and a.invitee_id = r.invitee_id)
         or (r.invitee_id is null and r.email is not null
             and lower(a.email) = lower(r.email))
       )
   );
