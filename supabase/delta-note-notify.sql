-- DocMaker Calendar — delta: pinning a note to an event tells the people on it.
-- Safe to run repeatedly. Run this whole file.
--
-- Same treatment as a shared event: the people who can see both the note and
-- the event hear about it, with the note itself in the message. Written by a
-- trigger so it happens however the pin was made.

-- 'note' joins the kinds a notification can be.
do $$
begin
  alter table cc_notifications drop constraint if exists cc_notifications_kind_check;
  alter table cc_notifications add constraint cc_notifications_kind_check
    check (kind in ('share', 'update', 'cancel', 'invite', 'note'));
end $$;

create or replace function cc_notify_note_pinned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  note        cc_notes%rowtype;
  event_title text;
  actor_name  text;
begin
  select * into note from cc_notes where id = new.note_id;
  if note.id is null then
    return new;
  end if;

  select title into event_title from cc_events where id = new.event_id;
  select display_name into actor_name from cc_profiles where id = new.pinned_by;

  -- Only people who can read the note AND see the event: a personal note has
  -- an audience of one, so pinning it tells nobody.
  insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
  select
    m.user_id,
    new.pinned_by,
    new.event_id,
    'note',
    coalesce(actor_name, 'Someone') || ' pinned a note to ' || coalesce(event_title, 'an event'),
    left(note.body, 240)
  from cc_group_members m
  where note.group_id is not null
    and m.group_id = note.group_id
    and m.user_id <> new.pinned_by
    and cc_event_access(new.event_id, m.user_id) = 'full';

  return new;
end;
$$;

drop trigger if exists cc_on_note_pinned on cc_note_events;
create trigger cc_on_note_pinned
  after insert on cc_note_events
  for each row execute function cc_notify_note_pinned();
