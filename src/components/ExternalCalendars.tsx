"use client";

import { CalendarSync, ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store";

/**
 * Calendars kept somewhere else: Nextcloud, Google, Outlook, a work calendar.
 *
 * What this does today is read them, on a schedule, into a calendar of their
 * own here. It is deliberately honest that nothing travels the other way yet —
 * a line offering "sync" that silently only imports is how people lose events
 * they thought were saved in both places.
 */
export function ExternalCalendars() {
  const store = useStore();
  const feeds = store.feeds ?? [];

  return (
    <div className="space-y-2">
      {feeds.length > 0 && (
        <ul className="space-y-1">
          {feeds.map((feed) => (
            <li key={feed.id} className="flex items-center gap-2 text-[13px]">
              <CalendarSync size={14} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-ink">{feed.name}</span>
              <span className="shrink-0 text-[12px] text-ink-faint">
                {feed.mode === "auto" ? "kept up to date" : "imported once"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[12px] leading-relaxed text-ink-faint">
        Add one with the <span className="font-medium text-ink-muted">+</span> beside
        Subscribed in the sidebar, using the calendar&apos;s secret iCal address.
        Nextcloud gives you one under Calendar → the three dots beside a calendar
        → Copy subscription link.
      </p>

      <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-faint">
        <ExternalLink size={12} className="mt-0.5 shrink-0" />
        This reads them. Events you make here stay here for now — nothing is
        written back to Nextcloud, Google or Outlook.
      </p>
    </div>
  );
}
