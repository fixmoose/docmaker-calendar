-- DocMaker Calendar — delta: a note can be pinned to several events.
-- Safe to run repeatedly. Run this whole file.
--
-- One note, many events: "bring the folder" belongs to both appointments.
-- The link is its own table, and who may see a note is still the note's own
-- rule — pinning a private note to a shared event does not hand it to anyone.

create table if not exists cc_note_events (
  note_id  uuid not null references cc_notes (id) on delete cascade,
  event_id uuid not null references cc_events (id) on delete cascade,
  pinned_by uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (note_id, event_id)
);

create index if not exists cc_note_events_event_idx on cc_note_events (event_id);

alter table cc_note_events enable row level security;

-- You may link a note you can read to an event you can see in full, and unlink
-- the same. Neither table's policy refers back here, so nothing recurses.
drop policy if exists cc_note_events_all on cc_note_events;
create policy cc_note_events_all on cc_note_events for all
  using (
    exists (
      select 1 from cc_notes n
      where n.id = note_id
        and (
          n.created_by = auth.uid()
          or (n.group_id is not null and cc_is_group_member(n.group_id, auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from cc_notes n
      where n.id = note_id
        and (
          n.created_by = auth.uid()
          or (n.group_id is not null and cc_is_group_member(n.group_id, auth.uid()))
        )
    )
    and cc_event_access(event_id, auth.uid()) = 'full'
  );

-- Carry across anything pinned while a note could hold only one event. That
-- column only exists if the earlier single-event delta was ever run, so this
-- checks before reaching for it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cc_notes'
      and column_name = 'event_id'
  ) then
    execute $migrate$
      insert into cc_note_events (note_id, event_id, pinned_by)
      select n.id, n.event_id, n.created_by
      from cc_notes n
      where n.event_id is not null
      on conflict do nothing
    $migrate$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_note_events'
  ) then
    alter publication supabase_realtime add table cc_note_events;
  end if;
end $$;
