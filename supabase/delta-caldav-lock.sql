-- DocMaker Calendar — delta: actually stop clients reading stored credentials.
-- Safe to run repeatedly.

-- The previous version revoked SELECT on the secret column alone, which does
-- nothing: in Postgres a table-level SELECT privilege lets you read every
-- column, and column-level grants only add to a role that lacks it. So the
-- revoke was accepted, changed nothing, and a signed-in owner could read their
-- own encrypted password back out with select=secret.
--
-- Encrypted is not the same as harmless. It is one stolen environment variable
-- away from being a password to somebody's file server, and it should never
-- have left the database at all.
--
-- These tables are used only by the server routines that talk to the far end,
-- which connect with the service role and are not subject to these grants.
-- Nothing in the browser queries them, so nothing in the browser needs to.
revoke all on cc_caldav_links from anon, authenticated;
revoke all on cc_caldav_objects from anon, authenticated;

-- Row level security stays on, and the policies stay as they are: if a future
-- migration hands the privileges back, the rows are still each owner's own.
alter table cc_caldav_links enable row level security;
alter table cc_caldav_objects enable row level security;
