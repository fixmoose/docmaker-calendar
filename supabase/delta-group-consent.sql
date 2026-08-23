-- DocMaker Calendar — delta: everybody in a group agrees before somebody joins.
-- Safe to run repeatedly.

-- Joining a group is not a neutral act: from that moment the newcomer sees a
-- busy block for every event of every member, and the whole of any calendar
-- the group owns. The people whose calendars those are should get a say, so
-- adding somebody is now a proposal the others answer rather than something
-- one person does to everyone.

create table if not exists cc_group_join_requests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references cc_groups (id) on delete cascade,
  -- One of these two: somebody who already has an account, or an address
  -- that will be invited once the group agrees.
  invitee_id   uuid references cc_profiles (id) on delete cascade,
  email        text,
  proposed_by  uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  -- Filled once an approved request has actually gone out, so a second run
  -- cannot invite the same person twice.
  invitation_id uuid references cc_invitations (id) on delete set null,
  settled_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint cc_join_request_who check (invitee_id is not null or email is not null)
);

create index if not exists cc_group_join_requests_group_idx
  on cc_group_join_requests (group_id, status);

create table if not exists cc_group_join_votes (
  request_id uuid not null references cc_group_join_requests (id) on delete cascade,
  user_id    uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  approve    boolean not null,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table cc_group_join_requests enable row level security;
alter table cc_group_join_votes enable row level security;

drop policy if exists cc_group_join_requests_read on cc_group_join_requests;
-- The group can see what is being asked of it; so can the person proposed,
-- since it is about them.
create policy cc_group_join_requests_read on cc_group_join_requests for select
  using (
    cc_is_group_member(group_id, auth.uid())
    or invitee_id = auth.uid()
  );

-- Written only by the functions below, which check membership themselves.
-- There is deliberately no insert or update policy: a proposal that could be
-- written directly could also be marked approved directly.

drop policy if exists cc_group_join_votes_read on cc_group_join_votes;
create policy cc_group_join_votes_read on cc_group_join_votes for select
  using (
    exists (
      select 1 from cc_group_join_requests r
      where r.id = request_id and cc_is_group_member(r.group_id, auth.uid())
    )
  );

-- ------------------------------------------------------------------ --
-- Proposing
-- ------------------------------------------------------------------ --

/**
 * Asks the group to let somebody in.
 *
 * The proposer's own agreement is implied, so a group of one — a group you
 * have just made — approves immediately and nothing feels bureaucratic. Every
 * other member has to say yes.
 */
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

  if p_invitee is not null and cc_is_group_member(p_group, p_invitee) then
    raise exception 'They are already in this group.';
  end if;

  -- Do not ask the group the same question twice.
  select id into request_id
  from cc_group_join_requests
  where group_id = p_group
    and status = 'pending'
    and (
      (p_invitee is not null and invitee_id = p_invitee)
      or (p_invitee is null and lower(email) = lower(p_email))
    )
  limit 1;
  if request_id is not null then
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

-- ------------------------------------------------------------------ --
-- Answering
-- ------------------------------------------------------------------ --

/**
 * Decides a request once the answers are in: one refusal is enough to stop it,
 * and everybody has to have said yes for it to pass. Silence is not consent —
 * a member who has not answered keeps it waiting.
 */
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

  -- The group has agreed; now the person does. Joining exposes their busy
  -- times to everyone here too, so nobody is put into a group unasked. An
  -- address with no account behind it is invited by email instead — see
  -- cc_pending_group_invites below.
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

/** One member's answer. */
create or replace function cc_vote_join_request(p_request uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null then
    raise exception 'That request is gone.';
  end if;
  if not cc_is_group_member(request.group_id, auth.uid()) then
    raise exception 'Only the group decides this.';
  end if;

  insert into cc_group_join_votes (request_id, user_id, approve)
  values (p_request, auth.uid(), p_approve)
  on conflict (request_id, user_id)
    do update set approve = excluded.approve, created_at = now();

  return cc_settle_join_request(p_request);
end;
$$;

/** The proposer changing their mind. */
create or replace function cc_withdraw_join_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update cc_group_join_requests
     set status = 'withdrawn', settled_at = now()
   where id = p_request
     and status = 'pending'
     and (proposed_by = auth.uid()
          or exists (select 1 from cc_groups g
                     where g.id = group_id and g.owner_id = auth.uid()));
end;
$$;

/**
 * The newcomer accepting. Nobody else can call this on their behalf, which is
 * the point: the group agreeing is only half of it.
 */
create or replace function cc_join_from_request(p_request uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
  joiner  text;
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

  select display_name into joiner from cc_profiles where id = auth.uid();

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

-- The newcomer needs to see the request in order to answer it, and to add
-- themselves once it has been approved. Both are checked in the function
-- above; this is the row-level half.
drop policy if exists cc_group_members_insert on cc_group_members;
create policy cc_group_members_insert on cc_group_members for insert
  with check (
    user_id = auth.uid()
    and (
      exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid())
      or exists (
        select 1 from cc_group_join_requests r
        where r.group_id = cc_group_members.group_id
          and r.invitee_id = auth.uid()
          and r.status = 'approved'
      )
    )
  );

-- ------------------------------------------------------------------ --
-- Sending what was agreed
-- ------------------------------------------------------------------ --

/**
 * Approved requests for people who have no account yet, waiting for their
 * invitation to be sent. Read by the app, which does the mail; the invitation
 * itself is created by cc_record_group_invitation so that no client can mint
 * one carrying a group.
 */
create or replace function cc_pending_group_invites()
returns table (request_id uuid, group_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.group_id, r.email
  from cc_group_join_requests r
  where r.status = 'approved'
    and r.invitation_id is null
    and r.email is not null
    and cc_is_group_member(r.group_id, auth.uid());
$$;

/** Turns an approved request into a real invitation, once. */
create or replace function cc_record_group_invitation(p_request uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request cc_group_join_requests%rowtype;
  new_id  uuid;
begin
  select * into request from cc_group_join_requests where id = p_request;
  if request.id is null or request.status <> 'approved' or request.invitation_id is not null then
    return null;
  end if;
  if not cc_is_group_member(request.group_id, auth.uid()) then
    raise exception 'Only the group can send this.';
  end if;

  insert into cc_invitations (email, token, invited_by, group_id)
  values (request.email, p_token, request.proposed_by, request.group_id)
  returning id into new_id;

  update cc_group_join_requests set invitation_id = new_id where id = p_request;
  return new_id;
end;
$$;

-- ------------------------------------------------------------------ --
-- Closing the side doors
-- ------------------------------------------------------------------ --

-- An invitation that carries a group is how somebody gets into it, so it may
-- no longer be written directly — only by cc_record_group_invitation, after
-- the group has agreed. Invitations to a single event are unaffected: sharing
-- one event exposes nobody else's calendar.
drop policy if exists cc_invitations_write on cc_invitations;
create policy cc_invitations_write on cc_invitations for all
  using (invited_by = auth.uid())
  with check (invited_by = auth.uid() and group_id is null);

-- Likewise membership itself: the owner may still remove people, but adding
-- goes through the vote. Everyone can show themselves out.
drop policy if exists cc_group_members_write on cc_group_members;
drop policy if exists cc_group_members_update on cc_group_members;
create policy cc_group_members_update on cc_group_members for update
  using (exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid()))
  with check (exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid()));

drop policy if exists cc_group_members_delete on cc_group_members;
create policy cc_group_members_delete on cc_group_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from cc_groups g where g.id = group_id and g.owner_id = auth.uid())
  );

-- Making a group with yourself in it is still one step; anybody else named at
-- that moment becomes a proposal, which a group of one approves at once, and
-- which they then accept for themselves.

-- Realtime, so an answer on a phone updates the laptop.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_group_join_requests'
  ) then
    alter publication supabase_realtime add table cc_group_join_requests;
  end if;
end;
$$;
