"use client";

import clsx from "clsx";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Button, controlClass } from "./ui";

/**
 * Everywhere this calendar also lives.
 *
 * One list, because that is the truth of it: a calendar kept in Nextcloud and
 * here is one calendar in two places, not two calendars to be reconciled. Each
 * row says which way things travel, since that is the only question anybody
 * has — and the earlier version buried it in paragraphs while putting the way
 * to add one somewhere else entirely.
 */

interface RemoteCalendar {
  href: string;
  name: string;
  readOnly: boolean;
}

interface Status {
  connected: boolean;
  baseUrl?: string;
  username?: string;
  calendarHref?: string | null;
  calendarName?: string | null;
  sourceCalendarId?: string | null;
  includeShared?: boolean;
  lastPushedAt?: string | null;
  lastError?: string | null;
  calendars?: RemoteCalendar[];
  listError?: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function OtherCalendars({ onAddSubscription }: { onAddSubscription: () => void }) {
  const store = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | "push" | "connect">(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const load = () => {
    void fetch("/api/caldav/status")
      .then((r) => r.json())
      .then((body: Status) => {
        setStatus(body);
        if (body.listError) setError(body.listError);
      })
      .catch(() => setStatus({ connected: false }));
  };

  useEffect(load, []);

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      const res = await fetch("/api/caldav/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not connect.");
      setPassword("");
      setAdding(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(null);
    }
  };

  const choose = async (patch: Record<string, unknown>) => {
    setStatus((s) => (s ? { ...s, ...patch } : s));
    await fetch("/api/caldav/choose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        href: patch.calendarHref ?? status?.calendarHref,
        name: patch.calendarName ?? status?.calendarName,
        sourceCalendarId:
          "sourceCalendarId" in patch ? patch.sourceCalendarId : status?.sourceCalendarId,
        includeShared:
          "includeShared" in patch ? patch.includeShared : status?.includeShared,
      }),
    });
  };

  const push = async () => {
    setBusy("push");
    setError(null);
    setSent(null);
    try {
      const res = await fetch("/api/caldav/push", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send.");
      setSent(body.sent as number);
      if (body.error) setError(body.error as string);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    await fetch("/api/caldav/choose", { method: "DELETE" });
    setStatus({ connected: false });
    setSent(null);
  };

  const feeds = store.feeds ?? [];
  // Calendars a subscription fills are not ones to send back out again.
  const imported = new Set(feeds.map((f) => f.calendarId));
  const mine = store.calendars.filter(
    (c) => c.ownerId === store.currentUserId && !imported.has(c.id),
  );
  const writable = (status?.calendars ?? []).filter((c) => !c.readOnly);

  return (
    <div className="space-y-2">
      {/* Coming in */}
      {feeds.map((feed) => (
        <div key={feed.id} className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <ArrowDownToLine size={15} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
              {feed.name}
            </span>
            <button
              type="button"
              onClick={() => store.removeFeed(feed.id)}
              title="Stop reading this one"
              className="text-ink-faint hover:text-[#d1443c]"
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-1 pl-6 text-[12px] text-ink-muted">
            Read in{feed.mode === "auto" ? ", kept up to date" : " once"}
            {feed.lastSyncedAt ? ` · last ${when(feed.lastSyncedAt)}` : ""}
          </p>
        </div>
      ))}

      {/* Going out */}
      {status?.connected && (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <ArrowUpFromLine size={15} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
              {new URL(status.baseUrl ?? "https://x").hostname}
            </span>
            <button
              type="button"
              onClick={() => void disconnect()}
              title="Disconnect and forget the password"
              className="text-ink-faint hover:text-[#d1443c]"
            >
              <X size={14} />
            </button>
          </div>

          <p className="mt-1 pl-6 text-[12px] text-ink-muted">
            {status.calendarName
              ? `Your calendar is written into “${status.calendarName}” there`
              : "Connected, but not writing anywhere yet"}
            {status.lastPushedAt ? ` · last sent ${when(status.lastPushedAt)}` : ""}
          </p>

          <div className="mt-2.5 space-y-2 pl-6">
            {!status.calendarName && writable.length > 0 && (
              <p className="text-[12px] font-medium text-brand">Pick one to write into:</p>
            )}
            {writable.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {writable.map((calendar) => (
                  <button
                    key={calendar.href}
                    type="button"
                    onClick={() =>
                      void choose({
                        calendarHref: calendar.href,
                        calendarName: calendar.name,
                      })
                    }
                    className={clsx(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition",
                      status.calendarHref === calendar.href
                        ? "border-brand bg-brand-soft font-medium text-brand"
                        : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {status.calendarHref === calendar.href && <Check size={12} />}
                    {calendar.name}
                  </button>
                ))}
              </div>
            )}

            {status.calendarName && (
              <>
                {mine.length > 1 && (
                  <label className="block text-[12px] text-ink-muted">
                    Which of mine
                    <select
                      value={status.sourceCalendarId ?? ""}
                      onChange={(e) =>
                        void choose({ sourceCalendarId: e.target.value || null })
                      }
                      className={`${controlClass} mt-1 w-full py-1.5 text-[13px]`}
                    >
                      <option value="">All of them</option>
                      {mine.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="flex items-start gap-2 text-[12px] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={status.includeShared ?? true}
                    onChange={(e) => void choose({ includeShared: e.target.checked })}
                    className="mt-0.5"
                  />
                  Send events other people share with me as well, so the copy over
                  there shows the same week this one does.
                </label>

                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => void push()} disabled={busy !== null}>
                    {busy === "push" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    Sync now
                  </Button>
                  {sent !== null && (
                    <span className="text-[12px] text-ink-faint">
                      {sent === 0 ? "Nothing to send." : `${sent} sent.`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!feeds.length && !status?.connected && (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          This calendar lives only here. Sync it with Google, Outlook, Nextcloud,
          Zoho or anything else that keeps calendars, and it can live in both.
        </p>
      )}

      {/* Adding */}
      {adding ? (
        <div className="space-y-2 rounded-xl border border-brand/40 bg-brand-soft/40 p-3">
          <p className="text-[12px] font-medium text-ink">
            Sync this calendar to a server of your own
          </p>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-nextcloud/remote.php/dav"
            className={`${controlClass} w-full py-2 text-[13px]`}
          />
          <div className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className={`${controlClass} min-w-0 flex-1 py-2 text-[13px]`}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="App password"
              autoComplete="new-password"
              className={`${controlClass} min-w-0 flex-1 py-2 text-[13px]`}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => void connect()}
              disabled={busy !== null || !baseUrl || !username || !password}
            >
              {busy === "connect" && <Loader2 size={13} className="animate-spin" />}
              Connect
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            An app password, not the one you log in with — Nextcloud puts them
            under Settings, Security. Stored encrypted and never shown again.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {/*
           * "Sync" on the buttons because that is the word people came looking
           * for; the rows themselves say which way things actually travel, so
           * nobody is left believing a change made over there will find its
           * way back here.
           */}
          <Button variant="outline" onClick={onAddSubscription}>
            <Plus size={14} /> Sync a third-party calendar
          </Button>
          {!status?.connected && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus size={14} /> Sync mine to my own server
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[#d1443c]">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
