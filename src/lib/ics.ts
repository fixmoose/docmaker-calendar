import { RRule } from "rrule";

/**
 * Just enough iCalendar to read a Google or Outlook feed.
 *
 * These feeds are plain text over HTTPS, which is why subscribing needs no
 * OAuth: the provider hands you a secret URL and we re-read it on a schedule.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  notes?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

/** Unfolds the 75-octet line wrapping the format mandates. */
function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescape(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\;/g, ";")
    .replace(/\\\\/g, "\\");
}

interface Line {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(raw: string): Line | null {
  const colon = raw.indexOf(":");
  if (colon < 0) return null;
  const left = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const [name, ...paramParts] = left.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/"/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Dates arrive as 20260817, 20260817T140000Z or a local time with a TZID.
 * Without a full tz database we treat floating times as the server's local
 * time, which is what most feeds mean by them anyway.
 */
function parseDate(line: Line): { date: Date; allDay: boolean } | null {
  const value = line.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    // Midday UTC, not midnight: an all-day event must land on the same date
    // whether it is read in Zagreb or Los Angeles, and midnight is one time
    // zone away from the day before.
    return {
      date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12)),
      allDay: true,
    };
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!stamp) return null;
  const [, y, m, d, hh, mm, ss, zulu] = stamp;
  const parts = [Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)] as const;
  return {
    date: zulu ? new Date(Date.UTC(...parts)) : new Date(...parts),
    allDay: false,
  };
}

export interface ParseOptions {
  /** Occurrences are expanded within this window only. */
  from: Date;
  to: Date;
  /** Guards against a runaway recurrence rule. */
  maxEvents?: number;
}

export function parseIcs(text: string, options: ParseOptions): IcsEvent[] {
  const { from, to, maxEvents = 2000 } = options;
  const lines = unfold(text).split("\n");
  const events: IcsEvent[] = [];

  let current: Record<string, Line> | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (current) collect(current, events, { from, to, maxEvents });
      current = null;
      continue;
    }
    if (!current) continue;

    const line = parseLine(trimmed);
    if (line) current[line.name] = line;
    if (events.length >= maxEvents) break;
  }

  return events.slice(0, maxEvents);
}

function collect(
  fields: Record<string, Line>,
  out: IcsEvent[],
  { from, to, maxEvents }: Required<ParseOptions>,
) {
  const uid = fields.UID?.value?.trim();
  const startLine = fields.DTSTART;
  if (!uid || !startLine) return;

  const start = parseDate(startLine);
  if (!start) return;

  const endLine = fields.DTEND;
  const parsedEnd = endLine ? parseDate(endLine) : null;

  // For all-day events DTEND is exclusive — 22nd to 24th means the 22nd and
  // 23rd — so the last day it actually covers is one day earlier.
  const DAY = 24 * 60 * 60 * 1000;
  const durationMs = parsedEnd
    ? Math.max(0, parsedEnd.date.getTime() - start.date.getTime() - (start.allDay ? DAY : 0))
    : start.allDay
      ? 0
      : 60 * 60 * 1000;

  const base: Omit<IcsEvent, "start" | "end"> = {
    uid,
    title: unescape(fields.SUMMARY?.value ?? "(no title)").trim() || "(no title)",
    notes: fields.DESCRIPTION ? unescape(fields.DESCRIPTION.value).trim() || undefined : undefined,
    location: fields.LOCATION ? unescape(fields.LOCATION.value).trim() || undefined : undefined,
    allDay: start.allDay,
  };

  const rule = fields.RRULE?.value;
  if (!rule) {
    if (start.date <= to && new Date(start.date.getTime() + durationMs) >= from) {
      out.push({ ...base, start: start.date, end: new Date(start.date.getTime() + durationMs) });
    }
    return;
  }

  // Recurring: expand only inside the window we actually display.
  try {
    const rrule = RRule.fromString(`DTSTART:${toIcsStamp(start.date)}\nRRULE:${rule}`);
    const excluded = new Set(
      (fields.EXDATE?.value ?? "")
        .split(",")
        .map((v) => parseDate({ name: "EXDATE", params: {}, value: v })?.date.getTime())
        .filter(Boolean) as number[],
    );

    for (const occurrence of rrule.between(from, to, true)) {
      if (excluded.has(occurrence.getTime())) continue;
      out.push({
        ...base,
        uid: `${uid}-${occurrence.toISOString().slice(0, 10)}`,
        start: occurrence,
        end: new Date(occurrence.getTime() + durationMs),
      });
      if (out.length >= maxEvents) return;
    }
  } catch {
    // An unparseable rule should not lose the rest of the feed.
  }
}

function toIcsStamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Google and Outlook both hand out webcal:// links that are really https. */
export function normaliseFeedUrl(url: string) {
  let clean = url.trim().replace(/^webcal:\/\//i, "https://");

  // People paste the embed code, because that is what the share dialog gives
  // them: a whole iframe tag with the address buried in it.
  const framed = clean.match(/src\s*=\s*["']([^"']+)["']/i);
  if (framed) clean = framed[1].trim();

  /*
   * Nextcloud shows a share as a page to look at and an embed to paste, and
   * neither is a calendar file — the first is HTML and the second is an
   * iframe of that HTML. Both carry the token, though, and the token is what
   * the calendar itself is served under.
   */
  const shared = clean.match(
    /^(https?:\/\/[^/]+)\/(?:index\.php\/)?apps\/calendar\/(?:embed|p)\/([^/?#]+)/i,
  );
  if (shared) {
    return `${shared[1]}/remote.php/dav/public-calendars/${shared[2]}?export`;
  }

  // Nextcloud hands out subscription links without it, and returns a directory
  // listing rather than a calendar unless it is asked for the export.
  if (/\/remote\.php\/dav\/public-calendars\/[^/?]+$/i.test(clean)) {
    return `${clean}?export`;
  }
  return clean;
}

/**
 * Why this address cannot be subscribed to, in words, or null if it looks
 * fine. A calendar feed is fetched with nobody signed in, so anything that
 * needs a password cannot be one however valid it is.
 */
export function feedUrlProblem(url: string): string | null {
  const clean = normaliseFeedUrl(url);

  if (!/^https?:\/\//i.test(clean)) {
    return "That does not look like a web address. It should begin with https://";
  }

  // The DAV root, or a personal calendar path: both need a username and
  // password, which a subscription has no way to supply.
  if (/\/remote\.php\/dav\/?$/i.test(clean)) {
    return "That is the address of your whole Nextcloud account, not of one calendar — and it needs your password, which a subscription cannot give it. In Nextcloud open Calendar, press the three dots beside the calendar you want, share it by link, then copy the subscription link it offers. That address ends in a long code and works without signing in.";
  }
  if (/\/remote\.php\/dav\/calendars\//i.test(clean)) {
    return "That is your private Nextcloud calendar address, which asks for a password. Use the subscription link instead: in Calendar, the three dots beside the calendar, share by link, then copy the subscription link.";
  }

  return null;
}


/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

const fold = (line: string) =>
  line.length <= 75 ? line : line.match(/.{1,73}/g)!.join("\r\n ");

const escape = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

const stamp = (date: Date, allDay = false) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  return allDay ? day : `${day}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00Z`;
};

/**
 * One event as a calendar file, for handing to somebody else's server.
 *
 * The UID is this event's own id, so sending it twice replaces the first copy
 * rather than making a second. A repeating event carries its rule across whole,
 * which is why the far end shows one entry rather than three hundred.
 */
export function eventToIcs(event: {
  id: string;
  title: string;
  notes?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  rrule?: string;
  updatedAt?: string;
}): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const rule = event.rrule?.split("\n").find((l) => l.startsWith("RRULE:"));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DocMaker Studio//DocMaker Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}`,
    `DTSTAMP:${stamp(new Date(event.updatedAt ?? event.start))}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${stamp(start, true)}`
      : `DTSTART:${stamp(start)}`,
    event.allDay ? `DTEND;VALUE=DATE:${stamp(end, true)}` : `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(event.title)}`,
    ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
    ...(event.notes ? [`DESCRIPTION:${escape(event.notes)}`] : []),
    ...(rule ? [rule] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(fold).join("\r\n") + "\r\n";
}
