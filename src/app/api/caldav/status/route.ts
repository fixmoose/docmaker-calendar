import { NextResponse } from "next/server";
import { listCalendars } from "@/lib/caldav";
import { decryptSecret } from "@/lib/secrets";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * What is already connected, and what could be written to.
 *
 * Without this the connection existed only in the memory of the page that made
 * it: closing Settings lost the list of calendars, the form came back as
 * though nothing had happened, and the one step that matters — choosing where
 * events go — became unreachable. The password is still held, so the list can
 * be fetched again without asking for it a second time.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("cc_caldav_links")
    .select("base_url,username,secret,calendar_href,calendar_name,source_calendar_id,include_shared,last_pushed_at,last_error")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!link) return NextResponse.json({ connected: false });

  const connected = {
    connected: true,
    baseUrl: link.base_url as string,
    username: link.username as string,
    calendarHref: (link.calendar_href as string) ?? null,
    calendarName: (link.calendar_name as string) ?? null,
    sourceCalendarId: (link.source_calendar_id as string) ?? null,
    includeShared: link.include_shared !== false,
    lastPushedAt: (link.last_pushed_at as string) ?? null,
    lastError: (link.last_error as string) ?? null,
  };

  // The list is worth having every time: calendars get added and renamed at
  // the far end, and this is the only way to notice.
  try {
    const calendars = await listCalendars({
      baseUrl: link.base_url as string,
      username: link.username as string,
      password: decryptSecret(link.secret as string),
    });
    return NextResponse.json({ ...connected, calendars });
  } catch (e) {
    return NextResponse.json({
      ...connected,
      calendars: [],
      listError: e instanceof Error ? e.message : "Could not reach that server.",
    });
  }
}
