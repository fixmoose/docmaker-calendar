import { NextResponse } from "next/server";
import { listCalendars } from "@/lib/caldav";
import { canHoldSecrets, encryptSecret } from "@/lib/secrets";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Connects somebody's own CalDAV server — Nextcloud, or anything that speaks
 * it — and lists the calendars they could write to.
 *
 * The password never reaches the database in the clear and never comes back
 * out: it is encrypted here and only ever decrypted by the routine that talks
 * to the far end. Everything happens server-side because CalDAV cannot be
 * spoken from a browser, and because credentials have no business there.
 */
export async function POST(request: Request) {
  if (!canHoldSecrets()) {
    return NextResponse.json(
      {
        error:
          "This server is not set up to hold credentials yet — CC_SECRET_KEY is missing from its environment.",
      },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { baseUrl, username, password } = (await request.json().catch(() => ({}))) as {
    baseUrl?: string;
    username?: string;
    password?: string;
  };

  if (!baseUrl || !username || !password) {
    return NextResponse.json(
      { error: "The address, your username and an app password are all needed." },
      { status: 400 },
    );
  }

  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return NextResponse.json({ error: "That is not a web address." }, { status: 400 });
  }
  if (url.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only https addresses are accepted: a password must not travel in the open." },
      { status: 400 },
    );
  }

  let calendars;
  try {
    calendars = await listCalendars({ baseUrl: url.toString(), username, password });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not reach that server." },
      { status: 502 },
    );
  }

  // Only now, once the credentials are known to work, are they kept.
  const admin = createAdminClient();
  await admin.from("cc_caldav_links").delete().eq("owner_id", user.id);
  const { data, error } = await admin
    .from("cc_caldav_links")
    .insert({
      owner_id: user.id,
      base_url: url.toString(),
      username,
      secret: encryptSecret(password),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, calendars });
}
