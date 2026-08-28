import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/** Records which calendar at the far end events should be written to. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { href, name, sourceCalendarId } = (await request.json().catch(() => ({}))) as {
    href?: string;
    name?: string;
    sourceCalendarId?: string | null;
  };
  if (!href) return NextResponse.json({ error: "No calendar chosen." }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("cc_caldav_links")
    .update({
      calendar_href: href,
      calendar_name: name ?? null,
      source_calendar_id: sourceCalendarId ?? null,
    })
    .eq("owner_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Disconnects, and forgets the password with it. */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("cc_caldav_links").delete().eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}
