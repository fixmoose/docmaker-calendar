-- DocMaker Calendar — delta: connect your own CalDAV server (Nextcloud, and
-- anything else that speaks it). Safe to run repeatedly.

-- Everybody brings their own server, so the credentials belong to the person
-- rather than to the deployment. The app password is stored encrypted and the
-- column is unreadable to signed-in clients: only the server routines that
-- talk to the far end can decrypt it, and there is no request that returns it.
create table if not exists cc_caldav_links (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  -- What was typed in: https://host/remote.php/dav for Nextcloud.
  base_url       text not null,
  username       text not null,
  -- AES-256-GCM, keyed from the server's environment. Never leaves the server.
  secret         text not null,
  -- The calendar chosen at the far end, and what it is called there.
  calendar_href  text,
  calendar_name  text,
  -- Which calendar here is sent over. Null means everything the owner owns.
  source_calendar_id uuid references cc_calendars (id) on delete set null,
  last_pushed_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);

create index if not exists cc_caldav_links_owner_idx on cc_caldav_links (owner_id);

alter table cc_caldav_links enable row level security;

drop policy if exists cc_caldav_links_own on cc_caldav_links;
create policy cc_caldav_links_own on cc_caldav_links for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- The one column nobody signed in may read, whatever they ask for. Postgres
-- checks column privileges before row policies, so this holds even for the
-- owner of the row — the secret is the server's business, not the browser's.
revoke select (secret) on cc_caldav_links from authenticated;
revoke update (secret) on cc_caldav_links from authenticated;

-- What has been written to the far end, so a second push replaces an event
-- rather than making another copy of it. The ETag is how the server tells us
-- whether our copy is still the current one.
create table if not exists cc_caldav_objects (
  link_id    uuid not null references cc_caldav_links (id) on delete cascade,
  event_id   uuid not null references cc_events (id) on delete cascade,
  href       text not null,
  etag       text,
  pushed_at  timestamptz not null default now(),
  primary key (link_id, event_id)
);

alter table cc_caldav_objects enable row level security;

drop policy if exists cc_caldav_objects_own on cc_caldav_objects;
create policy cc_caldav_objects_own on cc_caldav_objects for all
  using (
    exists (
      select 1 from cc_caldav_links l
      where l.id = link_id and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from cc_caldav_links l
      where l.id = link_id and l.owner_id = auth.uid()
    )
  );
