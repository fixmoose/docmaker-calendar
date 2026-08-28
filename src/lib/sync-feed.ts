import type { SupabaseClient } from "@supabase/supabase-js";
import { feedUrlProblem, normaliseFeedUrl, parseIcs } from "./ics";

/**
 * Re-reads one subscribed calendar and mirrors it into cc_events.
 *
 * Runs with the service role, because it writes events on behalf of the feed's
 * owner outside of any request of theirs. Everything it touches is scoped to
 * that feed's own calendar, and imported rows carry feed_id so they stay
 * read-only in the app and can be replaced wholesale on the next pass.
 */

export interface FeedRow {
  id: string;
  owner_id: string;
  calendar_id: string;
  name: string;
  url: string;
  mode: "once" | "auto";
}

/** How far around today we keep occurrences of recurring events. */
const WINDOW_BACK_DAYS = 60;
const WINDOW_FORWARD_DAYS = 400;

export async function syncFeed(admin: SupabaseClient, feed: FeedRow) {
  const from = new Date(Date.now() - WINDOW_BACK_DAYS * 86400_000);
  const to = new Date(Date.now() + WINDOW_FORWARD_DAYS * 86400_000);

  try {
    const problem = feedUrlProblem(feed.url);
    if (problem) throw new Error(problem);

    const response = await fetch(normaliseFeedUrl(feed.url), {
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
      redirect: "follow",
      cache: "no-store",
    });

    if (!response.ok) {
      // A bare status code tells somebody nothing about what to do next.
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "That calendar asked for a password. A subscription is fetched with nobody signed in, so it needs an address that works on its own — in Nextcloud, share the calendar by link and copy the subscription link it gives you. Google and Outlook call it the secret iCal address.",
        );
      }
      if (response.status === 404) {
        throw new Error("Nothing was there. The address may have been withdrawn or mistyped.");
      }
      throw new Error(`The calendar URL returned ${response.status}.`);
    }

    const body = await response.text();
    if (!body.includes("BEGIN:VCALENDAR")) {
      throw new Error("That URL did not return a calendar file.");
    }

    const parsed = parseIcs(body, { from, to });

    const rows = parsed.map((event) => ({
      calendar_id: feed.calendar_id,
      feed_id: feed.id,
      external_uid: event.uid,
      title: event.title,
      notes: event.notes ?? null,
      location: event.location ?? null,
      starts_at: event.start.toISOString(),
      ends_at: event.end.toISOString(),
      all_day: event.allDay,
      created_by: feed.owner_id,
    }));

    // Upsert on (feed_id, external_uid) so a re-sync updates in place.
    if (rows.length) {
      const { error } = await admin
        .from("cc_events")
        .upsert(rows, { onConflict: "feed_id,external_uid" });
      if (error) throw error;
    }

    // Anything no longer in the feed within the window has been cancelled.
    const keep = parsed.map((e) => e.uid);
    let removal = admin
      .from("cc_events")
      .delete()
      .eq("feed_id", feed.id)
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString());
    if (keep.length) {
      removal = removal.not(
        "external_uid",
        "in",
        `(${keep.map((uid) => `"${uid.replace(/"/g, '""')}"`).join(",")})`,
      );
    }
    await removal;

    await admin
      .from("cc_calendar_feeds")
      .update({
        last_synced_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
        event_count: rows.length,
        // A one-off import stops polling after it has run.
        mode: feed.mode === "once" ? "once" : "auto",
      })
      .eq("id", feed.id);

    return { ok: true as const, imported: rows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not read that calendar.";
    await admin
      .from("cc_calendar_feeds")
      .update({
        last_synced_at: new Date().toISOString(),
        last_status: "error",
        last_error: message.slice(0, 300),
      })
      .eq("id", feed.id);
    return { ok: false as const, error: message };
  }
}
