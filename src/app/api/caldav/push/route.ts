import { NextResponse } from "next/server";
import { putEvent } from "@/lib/caldav";
import { eventToIcs } from "@/lib/ics";
import { decryptSecret } from "@/lib/secrets";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Sends this person's events to the calendar they connected.
 *
 * One direction only, and deliberately: nothing here reads the far end or
 * decides which version wins. What it does guarantee is that sending twice
 * does not make two copies — every event goes under its own id, so the second
 * send replaces the first.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("cc_caldav_links")
    .select("id,base_url,username,secret,calendar_href,source_calendar_id,include_shared")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!link?.calendar_href) {
    return NextResponse.json(
      { error: "No calendar chosen on the other server yet." },
      { status: 400 },
    );
  }

  /*
   * A stored password can only be read back with the same CC_SECRET_KEY it was
   * written with. If that value changed, every saved connection is unreadable
   * — which is the intended property, but it needs saying rather than becoming
   * a five hundred with no explanation.
   */
  let credentials;
  try {
    credentials = {
      baseUrl: link.base_url as string,
      username: link.username as string,
      password: decryptSecret(link.secret as string),
    };
  } catch {
    return NextResponse.json(
      {
        error:
          "This connection cannot be read any more — the server's encryption key has changed since it was saved. Disconnect and connect it again.",
      },
      { status: 409 },
    );
  }

  /*
   * What is on this person's calendar — which is not the same as what they
   * own. An evening Ellen shared is on their calendar here, so a copy kept
   * elsewhere that omits it says the evening is free when it is not.
   *
   * Busy blocks are excluded by construction: only events shared in full have
   * a row here to read, and a masked one has nothing worth sending.
   */
  const calendars = await admin
    .from("cc_calendars")
    .select("id")
    .eq("owner_id", user.id);
  const ownIds = (calendars.data ?? []).map((c) => c.id as string);
  const wanted = link.source_calendar_id ? [link.source_calendar_id as string] : ownIds;

  const since = new Date(Date.now() - 365 * 86400_000).toISOString();
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
      .eq("user_id", user.id);
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
    ...((mine.data ?? []) as Record<string, unknown>[]),
    ...((shared.data ?? []) as Record<string, unknown>[]),
  ];
  if (!events.length) return NextResponse.json({ sent: 0 });

  const { data: already } = await admin
    .from("cc_caldav_objects")
    .select("event_id,etag")
    .eq("link_id", link.id);
  const etags = new Map((already ?? []).map((o) => [o.event_id as string, o.etag as string]));

  let sent = 0;
  const failures: string[] = [];

  for (const event of events) {
    const ics = eventToIcs({
      id: event.id as string,
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
      const result = await putEvent(
        credentials,
        link.calendar_href as string,
        `${event.id}.ics`,
        ics,
        etags.get(event.id as string),
      );
      await admin.from("cc_caldav_objects").upsert(
        {
          link_id: link.id,
          event_id: event.id,
          href: result.href,
          etag: result.etag ?? null,
          pushed_at: new Date().toISOString(),
        },
        { onConflict: "link_id,event_id" },
      );
      sent += 1;
    } catch (e) {
      failures.push(e instanceof Error ? e.message : "unknown");
    }
  }

  await admin
    .from("cc_caldav_links")
    .update({
      last_pushed_at: new Date().toISOString(),
      last_error: failures.length ? failures[0] : null,
    })
    .eq("id", link.id);

  return NextResponse.json({ sent, failed: failures.length, ...(failures[0] ? { error: failures[0] } : {}) });
}
