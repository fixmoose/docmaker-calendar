-- DocMaker Calendar — delta: a note can be pinned to an event. Safe to re-run.
--
-- The link is one column: a note belongs to at most one event, and the event
-- shows the notes pinned to it. Who may see a note does not change — that is
-- still the note's own rule — so pinning a private note to a shared event does
-- not hand it to the group.

alter table if exists cc_notes
  add column if not exists event_id uuid references cc_events (id) on delete set null;

create index if not exists cc_notes_event_idx on cc_notes (event_id);
