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
    .select("id,base_url,username,secret,calendar_href,source_calendar_id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!link?.calendar_href) {
    return NextResponse.json(
      { error: "No calendar chosen on the other server yet." },
      { status: 400 },
    );
  }

  const credentials = {
    baseUrl: link.base_url as string,
    username: link.username as string,
    password: decryptSecret(link.secret as string),
  };

  // Only what belongs to this person: never anything shared with them, which
  // is somebody else's to put on their own server if they want it there.
  const calendars = await admin
    .from("cc_calendars")
    .select("id")
    .eq("owner_id", user.id);
  const ownIds = (calendars.data ?? []).map((c) => c.id as string);
  const wanted = link.source_calendar_id ? [link.source_calendar_id as string] : ownIds;
  if (!wanted.length) return NextResponse.json({ sent: 0 });

  const { data: events } = await admin
    .from("cc_events")
    .select("id,title,notes,location,starts_at,ends_at,all_day,rrule,updated_at")
    .in("calendar_id", wanted)
    .is("deleted_at", null)
    // A year back is enough history for a calendar somebody actually reads.
    .gte("starts_at", new Date(Date.now() - 365 * 86400_000).toISOString())
    .limit(500);

  const { data: already } = await admin
    .from("cc_caldav_objects")
    .select("event_id,etag")
    .eq("link_id", link.id);
  const etags = new Map((already ?? []).map((o) => [o.event_id as string, o.etag as string]));

  let sent = 0;
  const failures: string[] = [];

  for (const event of events ?? []) {
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
