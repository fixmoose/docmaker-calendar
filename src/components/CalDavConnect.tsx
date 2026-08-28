"use client";

import clsx from "clsx";
import { Check, Loader2, Lock, Server, Upload, X } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, controlClass } from "./ui";

/**
 * Connecting your own calendar server.
 *
 * Everybody brings their own — a Nextcloud, a Fastmail, whatever speaks
 * CalDAV — so this asks for an address and an app password rather than being
 * configured once for everybody by whoever runs the site.
 *
 * It sends events out and does not read anything back. Saying so is the point:
 * somebody who believes this is a two-way sync will eventually make a change
 * at the other end and expect to see it here.
 */
interface RemoteCalendar {
  href: string;
  name: string;
  readOnly: boolean;
}

export function CalDavConnect() {
  const store = useStore();
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "connecting" | "pushing">(null);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<RemoteCalendar[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");
  const [sent, setSent] = useState<number | null>(null);

  const mine = store.calendars.filter((c) => c.ownerId === store.currentUserId);

  const connect = async () => {
    setBusy("connecting");
    setError(null);
    try {
      const res = await fetch("/api/caldav/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not connect.");
      setCalendars(body.calendars as RemoteCalendar[]);
      // The password has been kept, encrypted; this copy is no longer needed.
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(null);
    }
  };

  const choose = async (calendar: RemoteCalendar, sourceId = source) => {
    setChosen(calendar.href);
    await fetch("/api/caldav/choose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        href: calendar.href,
        name: calendar.name,
        sourceCalendarId: sourceId || null,
      }),
    });
  };

  const push = async () => {
    setBusy("pushing");
    setError(null);
    setSent(null);
    try {
      const res = await fetch("/api/caldav/push", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send.");
      setSent(body.sent as number);
      if (body.error) setError(body.error as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    await fetch("/api/caldav/choose", { method: "DELETE" });
    setCalendars(null);
    setChosen(null);
    setSent(null);
  };

  if (!calendars) {
    return (
      <div className="space-y-2">
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://your-server/remote.php/dav"
          className={`${controlClass} w-full py-2 text-[13px]`}
        />
        <div className="flex gap-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="off"
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

        <Button
          variant="outline"
          onClick={() => void connect()}
          disabled={busy !== null || !baseUrl || !username || !password}
          className="w-full justify-center"
        >
          {busy === "connecting" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Server size={14} />
          )}
          Connect
        </Button>

        {error && <p className="text-[12px] leading-relaxed text-[#d1443c]">{error}</p>}

        <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-faint">
          <Lock size={12} className="mt-0.5 shrink-0" />
          Use an app password rather than the one you log in with — on Nextcloud,
          Settings → Security → Create new app password. It is stored encrypted,
          never sent back to this page, and revoking it there ends this
          connection with nothing to clean up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-ink-muted">Write my events into</p>
      <ul className="space-y-1">
        {calendars.map((calendar) => (
          <li key={calendar.href}>
            <button
              type="button"
              disabled={calendar.readOnly}
              onClick={() => void choose(calendar)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] transition",
                chosen === calendar.href
                  ? "border-brand bg-brand-soft font-medium text-brand"
                  : calendar.readOnly
                    ? "cursor-not-allowed border-line text-ink-faint"
                    : "border-line text-ink hover:bg-surface-2",
              )}
            >
              {chosen === calendar.href ? <Check size={14} /> : <Server size={14} />}
              <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
              {calendar.readOnly && <span className="text-[11px]">read only</span>}
            </button>
          </li>
        ))}
      </ul>

      {chosen && (
        <>
          <label className="block text-[12px] text-ink-muted">
            Which of mine to send
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                const calendar = calendars.find((c) => c.href === chosen);
                if (calendar) void choose(calendar, e.target.value);
              }}
              className={`${controlClass} mt-1 w-full py-1.5 text-[13px]`}
            >
              <option value="">All my calendars</option>
              {mine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => void push()} disabled={busy !== null}>
              {busy === "pushing" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              Send my events now
            </Button>
            {sent !== null && (
              <span className="text-[12px] text-ink-faint">
                {sent === 0 ? "Nothing to send." : `${sent} sent.`}
              </span>
            )}
          </div>
        </>
      )}

      {error && <p className="text-[12px] leading-relaxed text-[#d1443c]">{error}</p>}

      <p className="text-[12px] leading-relaxed text-ink-faint">
        This writes your events out. Nothing is read back yet, so a change made
        on the other server will not appear here — subscribe to it as well if
        you want to see it.
      </p>

      <button
        type="button"
        onClick={() => void forget()}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-faint hover:text-[#d1443c]"
      >
        <X size={12} /> Disconnect and forget the password
      </button>
    </div>
  );
}
