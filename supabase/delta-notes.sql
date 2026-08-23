-- DocMaker Calendar — delta: shared notes. Safe to run repeatedly.
--
-- A note belongs either to one person or to a group, exactly as a calendar
-- does: group_id null means private, group_id set means everyone in that group
-- reads and writes it. Notes are kept as a stream — who wrote what, when —
-- rather than one document people overwrite.

create table if not exists cc_notes (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references cc_groups (id) on delete cascade,
  body       text not null,
  color      text not null default 'amber',
  pinned     boolean not null default false,
  created_by uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cc_notes_group_idx on cc_notes (group_id, created_at desc);
create index if not exists cc_notes_author_idx on cc_notes (created_by, created_at desc);

drop trigger if exists cc_notes_touch on cc_notes;
create trigger cc_notes_touch
  before update on cc_notes
  for each row execute function cc_touch_updated_at();

alter table cc_notes enable row level security;

-- Yours, or your group's.
drop policy if exists cc_notes_read on cc_notes;
create policy cc_notes_read on cc_notes for select using (
  created_by = auth.uid()
  or (group_id is not null and cc_is_group_member(group_id, auth.uid()))
);

-- Anyone in the group may add to it; only the author may change or remove
-- what they wrote, the way you cannot unsay somebody else's message.
drop policy if exists cc_notes_insert on cc_notes;
create policy cc_notes_insert on cc_notes for insert with check (
  created_by = auth.uid()
  and (group_id is null or cc_is_group_member(group_id, auth.uid()))
);

drop policy if exists cc_notes_update on cc_notes;
create policy cc_notes_update on cc_notes for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists cc_notes_delete on cc_notes;
create policy cc_notes_delete on cc_notes for delete using (created_by = auth.uid());

-- A note should land on the other screen as it is written.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_notes'
  ) then
    alter publication supabase_realtime add table cc_notes;
  end if;
end $$;
