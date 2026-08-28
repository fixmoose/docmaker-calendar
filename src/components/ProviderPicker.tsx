"use client";

import clsx from "clsx";
import { Apple, Cloud, FileUp, Globe, Loader2, Mail, Server } from "lucide-react";
import { useState } from "react";
import { Button, Modal, controlClass } from "./ui";

/**
 * Choosing what to connect, before being asked for anything.
 *
 * "Paste a link" is a fair description of the mechanism and a poor first
 * question: people know the name of their calendar, not which of its several
 * addresses is the one a program wants. So the name is the question, and each
 * answer knows where its own server lives and what it will ask for.
 *
 * Which of these can be signed into properly is not a matter of taste — a
 * provider either offers a password a program may use, or it insists on its
 * own sign-in screen and an application registered with them. Both are here,
 * and each card says which it is rather than promising a button that would
 * take somebody to a page that refuses them.
 */

type Kind = "caldav" | "link" | "oauth";

interface Provider {
  id: string;
  name: string;
  icon: typeof Cloud;
  kind: Kind;
  /** Prefilled for the ones whose address is always the same. */
  baseUrl?: string;
  /** What it takes, in the words that provider uses. */
  how: string;
  /** Where to find the thing it will ask for. */
  where?: string;
}

const PROVIDERS: Provider[] = [
  {
    id: "nextcloud",
    name: "Nextcloud",
    icon: Cloud,
    kind: "caldav",
    how: "Two-way, with an app password",
    where: "Nextcloud → Settings → Security → Create new app password",
  },
  {
    id: "icloud",
    name: "Apple iCloud",
    icon: Apple,
    kind: "caldav",
    baseUrl: "https://caldav.icloud.com",
    how: "Two-way, with an app-specific password",
    where: "account.apple.com → Sign-In and Security → App-Specific Passwords",
  },
  {
    id: "fastmail",
    name: "Fastmail",
    icon: Mail,
    kind: "caldav",
    baseUrl: "https://caldav.fastmail.com/dav/",
    how: "Two-way, with an app password",
    where: "Fastmail → Settings → Privacy & Security → App Passwords",
  },
  {
    id: "zoho",
    name: "Zoho Calendar",
    icon: Mail,
    kind: "caldav",
    baseUrl: "https://calendar.zoho.com/caldav/",
    how: "Two-way, with an application-specific password",
    where: "Zoho Accounts → Security → App Passwords",
  },
  {
    id: "other",
    name: "Another server",
    icon: Server,
    kind: "caldav",
    how: "Two-way, if it speaks CalDAV",
    where: "Its address usually ends in /dav or /caldav",
  },
  {
    id: "google",
    name: "Google Calendar",
    icon: Globe,
    kind: "oauth",
    how: "Read-only for now, from its secret address",
    where: "Google Calendar → the calendar's Settings → Secret address in iCal format",
  },
  {
    id: "outlook",
    name: "Outlook · Microsoft 365",
    icon: Globe,
    kind: "oauth",
    how: "Read-only for now, from its published address",
    where: "Outlook → Settings → Calendar → Shared calendars → Publish, then copy the ICS link",
  },
  {
    id: "link",
    name: "Any calendar address",
    icon: Globe,
    kind: "link",
    how: "Read-only, from a link ending in .ics",
  },
  {
    id: "file",
    name: "A calendar file",
    icon: FileUp,
    kind: "link",
    how: "A one-off import from an .ics on this computer",
  },
];

export function ProviderPicker({
  onClose,
  onLink,
  onFile,
  onConnected,
}: {
  onClose: () => void;
  /** Read-only: hand over to the subscribe dialog. */
  onLink: (provider?: string) => void;
  onFile: () => void;
  onConnected: () => void;
}) {
  const [chosen, setChosen] = useState<Provider | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/caldav/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not connect.");
      onConnected();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

  if (!chosen) {
    return (
      <Modal title="Sync a third-party calendar" onClose={onClose} width={620} autoFocus={false}>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const Icon = provider.icon;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  if (provider.id === "file") return onFile();
                  if (provider.kind === "caldav") {
                    setBaseUrl(provider.baseUrl ?? "");
                    setChosen(provider);
                    return;
                  }
                  onLink(provider.id);
                }}
                className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-brand/50 hover:bg-brand-soft/40"
              >
                <Icon size={17} className="mt-0.5 shrink-0 text-brand" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {provider.name}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">
                    {provider.how}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
          Google and Microsoft do not let a program hold your password; they
          insist on their own sign-in, which needs this calendar registered with
          them first. Until that is done they are read-only, which still shows
          their events here — it is only the writing back that waits.
        </p>
      </Modal>
    );
  }

  const Icon = chosen.icon;
  return (
    <Modal title={`Connect ${chosen.name}`} onClose={onClose} width={520}>
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-[13px] text-ink-muted">
          <Icon size={16} className="mt-0.5 shrink-0 text-brand" />
          {chosen.how}
          {chosen.where ? ` — ${chosen.where}.` : "."}
        </p>

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
            placeholder="Username or email"
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

        {error && <p className="text-[12px] leading-relaxed text-[#d1443c]">{error}</p>}

        <p className="text-[12px] leading-relaxed text-ink-faint">
          An app password rather than the one you sign in with: it can be
          revoked on its own, and revoking it ends this connection with nothing
          to clean up here. It is stored encrypted and never shown again.
        </p>

        <div className={clsx("flex justify-end gap-2")}>
          <Button variant="ghost" onClick={() => setChosen(null)}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={() => void connect()}
            disabled={busy || !baseUrl || !username || !password}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Connect
          </Button>
        </div>
      </div>
    </Modal>
  );
}
