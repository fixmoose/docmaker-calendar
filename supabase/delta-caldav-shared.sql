-- DocMaker Calendar — delta: send shared events out too. Safe to run repeatedly.

-- A calendar somebody keeps in two places is one calendar. Events other people
-- have shared with you appear on it here, so leaving them out of what is sent
-- makes the copy on your own server quietly wrong — you check your phone, the
-- evening looks free, and it is not.
--
-- Only events you may see in full: a busy block has no details to send, and
-- would arrive as an hour named "Busy" belonging to nobody.
alter table if exists cc_caldav_links
  add column if not exists include_shared boolean not null default true;
