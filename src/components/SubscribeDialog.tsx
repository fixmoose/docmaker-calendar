"use client";

import clsx from "clsx";
import { Link2, RefreshCw, TriangleAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { feedUrlProblem } from "@/lib/ics";
import { useStore } from "@/lib/store";
import type { ColorKey } from "@/lib/types";
import { Button, ColorPicker, Field, Modal, inputClass } from "./ui";

const INTERVALS = [
  { minutes: 60, label: "Every hour" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Once a day" },
];

/**
 * Subscribe to a Google or Outlook calendar by its secret iCal address —
 * either as a one-off import or kept up to date on a schedule.
 */
export function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<ColorKey>("blue");
  const [mode, setMode] = useState<"once" | "auto">("auto");
  const [interval, setInterval] = useState(360);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!url.trim()) return;

    // Said before the request rather than after it comes back refused.
    const problem = feedUrlProblem(url);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    const result = await store.addFeed({
      name: name.trim() || "Imported calendar",
      url: url.trim(),
      color,
      mode,
      intervalMinutes: interval,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setName("");
    setUrl("");
  };

  return (
    <Modal
      title="Sync a third-party calendar"
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void add()} disabled={busy || !url.trim()}>
            <Link2 size={15} />
            {busy ? "Reading…" : mode === "once" ? "Import once" : "Subscribe"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <details className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
          <summary className="cursor-pointer font-medium text-ink">
            Where do I find the address?
          </summary>
          <p className="mt-2">
            <strong className="text-ink">Google Calendar</strong> → Settings →
            pick the calendar → “Secret address in iCal format”.
          </p>
          <p className="mt-1.5">
            <strong className="text-ink">Outlook</strong> → Settings → Calendar →
            Shared calendars → Publish a calendar → choose “Can view all
            details” → copy the ICS link.
          </p>
          <p className="mt-1.5">
            Keep it private: anyone with that address can read the calendar.
          </p>
        </details>

        <Field label="Calendar address (.ics)">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Show it as">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work (Outlook)"
              className={inputClass}
            />
          </Field>
          <Field label="Colour">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
        </div>

        <Field label="Keep it up to date?">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["auto", "Keep synced"],
                ["once", "Import once"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={clsx(
                  "rounded-lg border px-3 py-1.5 text-[13px] transition",
                  mode === value
                    ? "border-brand/50 bg-brand-soft font-medium text-brand"
                    : "border-line text-ink-muted hover:bg-surface-2",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "auto" ? (
            <select
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className={`${inputClass} mt-2`}
            >
              {INTERVALS.map((i) => (
                <option key={i.minutes} value={i.minutes}>
                  {i.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-faint">
              Events are copied in now and never touched again.
            </p>
          )}
        </Field>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[#d1443c]/30 bg-[#d1443c]/8 px-3 py-2 text-[12px] text-[#d1443c]">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {store.feeds.length > 0 && (
          <Field label="Subscribed">
            <div className="space-y-1.5">
              {store.feeds.map((feed) => (
                <div
                  key={feed.id}
                  className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {feed.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {feed.mode === "auto"
                        ? `every ${feed.intervalMinutes / 60}h`
                        : "one-off import"}
                      {feed.lastSyncedAt &&
                        ` · ${formatDistanceToNow(new Date(feed.lastSyncedAt))} ago`}
                      {feed.eventCount > 0 && ` · ${feed.eventCount} events`}
                      {feed.lastStatus === "error" && (
                        <span className="text-[#d1443c]"> · {feed.lastError}</span>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void store.syncFeed(feed.id)}
                    title="Sync now"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => store.removeFeed(feed.id)}
                    title="Unsubscribe"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-[#d1443c]"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
