import { NextResponse } from "next/server";
import { syncLink, type Link } from "@/lib/caldav-sync";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Sync now: read the far calendar, then write this one out.
 *
 * The same work the schedule does, for somebody who does not want to wait five
 * minutes to see whether it works.
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
    .select("id,owner_id,base_url,username,secret,calendar_href,source_calendar_id,include_shared")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!link?.calendar_href) {
    return NextResponse.json(
      { error: "No calendar chosen on the other server yet." },
      { status: 400 },
    );
  }

  try {
    const result = await syncLink(admin, link as unknown as Link);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not sync.";
    await admin.from("cc_caldav_links").update({ last_error: message }).eq("id", link.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
