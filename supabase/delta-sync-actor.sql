-- DocMaker Calendar — delta: name the calendar server in a change notice.
-- Safe to run repeatedly.

-- A change made by a connected calendar server has no signed-in person behind
-- it, so auth.uid() is null and the notice read "Someone moved it to Saturday
-- 29 Aug" — which is alarming precisely because nobody is named. Whoever reads
-- it cannot tell whether their partner moved an appointment or something went
-- wrong.
create or replace function cc_note_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor        uuid := auth.uid();
  actor_name   text;
  parts        text[] := '{}';
  summary      text;
  recipient    uuid;
  calendar_row cc_calendars%rowtype;
begin
  if new.deleted_at is distinct from old.deleted_at then
    return new;
  end if;

  if new.title is distinct from old.title then
    parts := parts || format('renamed it to "%s"', new.title);
  end if;

  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    parts := parts || format(
      'moved it to %s',
      to_char(new.starts_at at time zone 'UTC', 'FMDay FMDD FMMon, HH24:MI')
    );
  end if;

  if new.location is distinct from old.location then
    parts := parts || case
      when new.location is null or new.location = '' then 'removed the place'
      else format('changed the place to %s', new.location)
    end;
  end if;

  if new.rrule is distinct from old.rrule then
    parts := parts || case
      when new.rrule is null then 'stopped it repeating'
      when old.rrule is null then 'made it repeat'
      else 'changed how often it repeats'
    end;
  end if;

  if array_length(parts, 1) is null then
    return new;
  end if;

  select display_name into actor_name from cc_profiles where id = actor;

  -- Nobody signed in means this came from a connected calendar rather than
  -- from a person, and saying so is the difference between an explanation and
  -- a fright.
  summary := coalesce(actor_name, 'A connected calendar')
             || ' ' || array_to_string(parts, ', ');

  insert into cc_event_changes (event_id, actor_id, summary)
  values (new.id, actor, summary);

  select * into calendar_row from cc_calendars where id = new.calendar_id;

  for recipient in
    select user_id from cc_event_shares where event_id = new.id
    union
    select calendar_row.owner_id
    union
    select gm.user_id from cc_group_members gm
    where gm.group_id = calendar_row.group_id
  loop
    if recipient is null or recipient = actor then
      continue;
    end if;

    insert into cc_notifications (user_id, actor_id, event_id, kind, title, body)
    values (recipient, actor, new.id, 'update', summary, new.title);
  end loop;

  return new;
end;
$$;
