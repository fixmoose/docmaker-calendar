import type { SupabaseClient } from "@supabase/supabase-js";
import { getObject, listObjects, putEvent, type Credentials } from "./caldav";
import { eventToIcs, parseIcs } from "./ics";
import { decryptSecret } from "./secrets";

/**
 * Both directions of one person's calendar server.
 *
 * The aim is one calendar in two places rather than two calendars kept in step:
 * events made here are written out, events made there are read in, and each
 * side keeps what the other has not touched.
 *
 * Where they disagree, the most recent change wins. That is the honest rule
 * for one person moving between their own devices, which is what this is for.
 * It is not enough for two people editing the same event in different places
 * at once, and nothing here pretends otherwise.
 */

export interface Link {
  id: string;
  owner_id: string;
  base_url: string;
  username: string;
  secret: string;
  calendar_href: string | null;
  source_calendar_id: string | null;
  include_shared: boolean;
}

const WINDOW_BACK_DAYS = 365;
const WINDOW_FORWARD_DAYS = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where imported events land: the chosen calendar, else the owner's first. */
async function targetCalendar(admin: SupabaseClient, link: Link) {
  if (link.source_calendar_id) return link.source_calendar_id;
  const { data } = await admin
    .from("cc_calendars")
    .select("id")
    .eq("owner_id", link.owner_id)
    .eq("kind", "personal")
    .order("created_at")
    .limit(1);
  return (data?.[0]?.id as string) ?? null;
}

/** Reads the far calendar into this one. */
export async function pull(admin: SupabaseClient, link: Link) {
  if (!link.calendar_href) return { added: 0, updated: 0, removed: 0 };

  const credentials: Credentials = {
    baseUrl: link.base_url,
    username: link.username,
    password: decryptSecret(link.secret),
  };

  const calendarId = await targetCalendar(admin, link);
  if (!calendarId) return { added: 0, updated: 0, removed: 0 };

  const remote = await listObjects(credentials, link.calendar_href);

  const { data: known } = await admin
    .from("cc_caldav_objects")
    .select("event_id,href,etag")
    .eq("link_id", link.id);
  const byHref = new Map((known ?? []).map((o) => [o.href as string, o]));

  /*
   * Which of these are ours, told by asking rather than by the shape of the
   * id. Nextcloud names its own events with UUIDs too, so "looks like a UUID"
   * matched events made over there — and each one was applied to a row of ours
   * that did not exist, counted as updated, and never imported. That is why an
   * event created in Nextcloud never arrived: it was mistaken for its own
   * reflection.
   */
  const candidates = remote
    .map((o) => decodeURIComponent(o.href.split("/").pop() ?? "").replace(/\.ics$/i, ""))
    .filter((uid) => UUID.test(uid));
  const mineAlready = new Set<string>();
  if (candidates.length) {
    const { data } = await admin.from("cc_events").select("id").in("id", candidates);
    for (const row of data ?? []) mineAlready.add(row.id as string);
  }

  const from = new Date(Date.now() - WINDOW_BACK_DAYS * 86400_000);
  const to = new Date(Date.now() + WINDOW_FORWARD_DAYS * 86400_000);

  let added = 0;
  let updated = 0;
  /** Ours, seen again: worth remembering the version, not worth applying. */
  const etagOnly: { eventId: string; href: string; etag?: string }[] = [];

  for (const object of remote) {
    const seen = byHref.get(object.href);
    // Unchanged since we last looked, whichever side wrote it.
    if (seen && object.etag && seen.etag === object.etag) continue;

    const { ics, etag } = await getObject(credentials, object.href);
    const [event] = parseIcs(ics, { from, to });
    if (!event) continue;

    // An event of ours, coming back changed: the far end edited it, so take
    // that. Editing here and syncing writes it out again in the other pass.
    const ours = mineAlready.has(event.uid);

    const row = {
      title: event.title,
      notes: event.notes ?? null,
      location: event.location ?? null,
      starts_at: event.start.toISOString(),
      ends_at: event.end.toISOString(),
      all_day: event.allDay,
    };

    if (ours) {
      /*
       * An event of ours, read back. We do not apply it.
       *
       * The round trip is not lossless yet: an all-day event went out as a
       * date, came back as midday, and was written down as a move — which
       * reached everybody it was shared with as "Someone moved it to Saturday
       * 29 Aug", from nobody, about an appointment that had not moved.
       *
       * Losing an edit made at the far end is a nuisance. Silently shifting an
       * appointment and announcing it is worse, so until the two ends agree on
       * exactly what an all-day event is, this side keeps what it wrote.
       */
      etagOnly.push({ eventId: event.uid, href: object.href, etag });
    } else {
      // Somebody made this over there. It becomes an event here, under an id
      // of our own, remembered by href so the next pass recognises it.
      const existing = seen?.event_id as string | undefined;
      if (existing) {
        await admin.from("cc_events").update(row).eq("id", existing);
        updated += 1;
      } else {
        const id = crypto.randomUUID();
        const { error } = await admin.from("cc_events").insert({
          id,
          ...row,
          calendar_id: calendarId,
          created_by: link.owner_id,
        });
        if (error) continue;
        await admin.from("cc_caldav_objects").upsert(
          { link_id: link.id, event_id: id, href: object.href, etag: etag ?? null },
          { onConflict: "link_id,event_id" },
        );
        added += 1;
        continue;
      }
    }

    if (!ours) {
      await admin.from("cc_caldav_objects").upsert(
        {
          link_id: link.id,
          event_id: seen?.event_id as string,
          href: object.href,
          etag: etag ?? null,
        },
        { onConflict: "link_id,event_id" },
      );
    }
  }

  for (const seen of etagOnly) {
    await admin.from("cc_caldav_objects").upsert(
      { link_id: link.id, event_id: seen.eventId, href: seen.href, etag: seen.etag ?? null },
      { onConflict: "link_id,event_id" },
    );
  }

  // Gone from the far calendar: gone from here too, but only the ones that
  // came from there. An event of ours that vanished is dealt with by pushing
  // it back, not by deleting it locally.
  const hrefs = new Set(remote.map((o) => o.href));
  let removed = 0;
  for (const [href, object] of byHref) {
    if (hrefs.has(href)) continue;
    const eventId = object.event_id as string;
    const { data: event } = await admin
      .from("cc_events")
      .select("created_by")
      .eq("id", eventId)
      .maybeSingle();
    if (event) {
      await admin.from("cc_events").update({ deleted_at: new Date().toISOString() }).eq("id", eventId);
      removed += 1;
    }
    await admin.from("cc_caldav_objects").delete().eq("link_id", link.id).eq("event_id", eventId);
  }

  return { added, updated, removed };
}

/** Writes this calendar out to the far one. */
export async function push(admin: SupabaseClient, link: Link) {
  if (!link.calendar_href) return { sent: 0, failed: 0 };

  const credentials: Credentials = {
    baseUrl: link.base_url,
    username: link.username,
    password: decryptSecret(link.secret),
  };

  const { data: calendars } = await admin
    .from("cc_calendars")
    .select("id")
    .eq("owner_id", link.owner_id);
  const wanted = link.source_calendar_id
    ? [link.source_calendar_id]
    : (calendars ?? []).map((c) => c.id as string);

  const since = new Date(Date.now() - WINDOW_BACK_DAYS * 86400_000).toISOString();
  const columns = "id,title,notes,location,starts_at,ends_at,all_day,rrule,updated_at";

  const mine = wanted.length
    ? await admin
        .from("cc_events")
        .select(columns)
        .in("calendar_id", wanted)
        .is("deleted_at", null)
        .gte("starts_at", since)
        .limit(500)
    : { data: [] };

  let shared: { data: unknown[] | null } = { data: [] };
  if (link.include_shared) {
    const { data: guest } = await admin
      .from("cc_event_shares")
      .select("event_id")
      .eq("user_id", link.owner_id);
    const ids = (guest ?? []).map((g) => g.event_id as string);
    if (ids.length) {
      shared = await admin
        .from("cc_events")
        .select(columns)
        .in("id", ids)
        .is("deleted_at", null)
        .gte("starts_at", since)
        .limit(500);
    }
  }

  const events = [
    ...((mine.data ?? []) as Record<string, string | boolean | null>[]),
    ...((shared.data ?? []) as Record<string, string | boolean | null>[]),
  ];

  const { data: known } = await admin
    .from("cc_caldav_objects")
    .select("event_id,etag")
    .eq("link_id", link.id);
  const etags = new Map((known ?? []).map((o) => [o.event_id as string, o.etag as string]));

  let sent = 0;
  let failed = 0;

  for (const event of events) {
    const id = event.id as string;
    // Anything that arrived from the far end is already there.
    const ics = eventToIcs({
      id,
      title: event.title as string,
      notes: (event.notes as string) ?? undefined,
      location: (event.location as string) ?? undefined,
      start: event.starts_at as string,
      end: event.ends_at as string,
      allDay: Boolean(event.all_day),
      rrule: (event.rrule as string) ?? undefined,
      updatedAt: (event.updated_at as string) ?? undefined,
    });

    try {
      const result = await putEvent(credentials, link.calendar_href, `${id}.ics`, ics, etags.get(id));
      await admin.from("cc_caldav_objects").upsert(
        {
          link_id: link.id,
          event_id: id,
          href: result.href,
          etag: result.etag ?? null,
          pushed_at: new Date().toISOString(),
        },
        { onConflict: "link_id,event_id" },
      );
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed };
}

/**
 * Both ways, in the order that loses least: read first, so anything made at
 * the far end is here before this end writes its version of the world back.
 */
export async function syncLink(admin: SupabaseClient, link: Link) {
  const inbound = await pull(admin, link);
  const outbound = await push(admin, link);
  await admin
    .from("cc_caldav_links")
    .update({ last_pushed_at: new Date().toISOString(), last_error: null })
    .eq("id", link.id);
  return { ...inbound, ...outbound };
}
