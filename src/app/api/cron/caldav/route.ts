import { NextResponse } from "next/server";
import { syncLink, type Link } from "@/lib/caldav-sync";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Keeps every connected calendar server in step, on a schedule.
 *
 * Without this, syncing is something somebody has to remember to press, which
 * is not syncing. An event made on a phone in Nextcloud should be here shortly
 * afterwards without anybody doing anything about it.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok =
      request.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(request.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  } else if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: links } = await admin
    .from("cc_caldav_links")
    .select("id,owner_id,base_url,username,secret,calendar_href,source_calendar_id,include_shared")
    .not("calendar_href", "is", null);

  const results: Record<string, unknown>[] = [];

  for (const link of (links ?? []) as unknown as Link[]) {
    try {
      results.push({ id: link.id, ...(await syncLink(admin, link)) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      // Recorded rather than thrown, so one broken server does not stop the
      // rest, and so the person can see why theirs is not moving.
      await admin.from("cc_caldav_links").update({ last_error: message }).eq("id", link.id);
      results.push({ id: link.id, error: message });
    }
  }

  return NextResponse.json({ links: results.length, results });
}
