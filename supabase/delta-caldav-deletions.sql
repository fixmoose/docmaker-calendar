-- DocMaker Calendar — delta: a deletion made here reaches the calendar server.
-- Safe to run repeatedly.

-- Deleting an event and finding it still on the phone is the same failure as
-- an edit that comes back: the two ends are meant to be one calendar.
--
-- Emptying the trash removes the event row, and the note of where that event
-- lives on the far server goes with it. The file over there would then answer
-- to nothing here, and the next read would take it for a new event and bring
-- it back — the one thing a deletion must never do. So the address is kept
-- behind, and the sync goes and removes it.
create table if not exists cc_caldav_deletions (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references cc_caldav_links (id) on delete cascade,
  href       text not null,
  created_at timestamptz not null default now()
);

alter table cc_caldav_deletions enable row level security;

-- Nobody signed in reads or writes this. The sync runs as the service role,
-- which these grants do not apply to.
revoke all on cc_caldav_deletions from anon, authenticated;

create or replace function cc_remember_caldav_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cc_caldav_deletions (link_id, href)
  select link_id, href from cc_caldav_objects where event_id = old.id;
  return old;
end;
$$;

drop trigger if exists cc_events_caldav_deletion on cc_events;
create trigger cc_events_caldav_deletion
  before delete on cc_events
  for each row execute function cc_remember_caldav_deletion();
