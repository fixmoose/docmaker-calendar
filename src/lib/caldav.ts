/**
 * Just enough CalDAV to put events on somebody else's server.
 *
 * CalDAV is WebDAV with calendar extensions: you ask a URL what it knows with
 * PROPFIND, and you write an event by PUTting an .ics file at a URL you choose
 * yourself. That is the whole of what is needed to push, and deliberately all
 * that is implemented — reading back, sync tokens and conflict resolution are
 * a different job with different failure modes.
 *
 * Written against Nextcloud, which is the common case, but the requests are
 * plain CalDAV and should hold for anything that speaks it.
 */

export interface Credentials {
  baseUrl: string;
  username: string;
  password: string;
}

export interface RemoteCalendar {
  href: string;
  name: string;
  readOnly: boolean;
}

const TIMEOUT_MS = 15_000;

function auth({ username, password }: Credentials) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Resolves a href from a DAV response against the server it came from. */
function absolute(baseUrl: string, href: string) {
  return new URL(href, baseUrl).toString();
}

async function dav(
  url: string,
  credentials: Credentials,
  init: RequestInit & { depth?: string },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: auth(credentials),
        ...(init.depth ? { Depth: init.depth } : {}),
        ...init.headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Everything between two tags, for the handful of fields that matter here. */
const between = (xml: string, tag: string) => {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)</[^>]*${tag}>`, "i"));
  return match?.[1]?.trim();
};

/**
 * Finds the calendars this account can write to.
 *
 * Two hops, which is how CalDAV is meant to be walked: ask the server who the
 * current user is, then ask that principal where its calendars live, then list
 * them. Nextcloud will also answer a direct listing, but the walk is what the
 * standard says and works on servers that lay their paths out differently.
 */
export async function listCalendars(credentials: Credentials): Promise<RemoteCalendar[]> {
  const base = credentials.baseUrl.replace(/\/+$/, "");

  const principalResponse = await dav(base, credentials, {
    method: "PROPFIND",
    depth: "0",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
  });

  if (principalResponse.status === 401) {
    throw new Error(
      "The server refused that username and password. On Nextcloud use an app password — Settings, Security, Create new app password — rather than the one you log in with.",
    );
  }
  if (!principalResponse.ok) {
    throw new Error(`The server answered ${principalResponse.status} when asked who you are.`);
  }

  const principalHref = between(await principalResponse.text(), "current-user-principal")
    ?.match(/<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i)?.[1]
    ?.trim();
  if (!principalHref) throw new Error("The server did not say which account this is.");

  const homeResponse = await dav(absolute(base, principalHref), credentials, {
    method: "PROPFIND",
    depth: "0",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
  });
  const homeHref = between(await homeResponse.text(), "calendar-home-set")
    ?.match(/<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i)?.[1]
    ?.trim();
  if (!homeHref) throw new Error("The server did not say where your calendars are.");

  const listResponse = await dav(absolute(base, homeHref), credentials, {
    method: "PROPFIND",
    depth: "1",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><d:current-user-privilege-set/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
  });
  const listing = await listResponse.text();

  const calendars: RemoteCalendar[] = [];
  for (const block of listing.split(/<[^>]*response[^>]*>/i).slice(1)) {
    // Calendars only: the home itself and address books come back too.
    if (!/calendar[^>]*\/>/i.test(block)) continue;
    // And only ones that hold events, not tasks or subscribed copies.
    if (/subscribed/i.test(block)) continue;
    if (/supported-calendar-component-set/i.test(block) && !/name="VEVENT"/i.test(block)) continue;

    const href = block.match(/<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i)?.[1]?.trim();
    if (!href) continue;
    const name = between(block, "displayname") || decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "Calendar");
    calendars.push({
      href: absolute(base, href),
      name,
      readOnly: /privilege-set/i.test(block) && !/<[^>]*write[^>]*\/>/i.test(block),
    });
  }

  if (!calendars.length) {
    throw new Error("Signed in, but no calendar was found on that account.");
  }
  return calendars;
}

/** Puts one event on the far calendar, replacing our previous copy of it. */
/**
 * One shape for an ETag, wherever it is kept or compared.
 *
 * HTTP quotes them and a weak one carries a W/ in front. Listing and reading
 * unquoted theirs while a write kept the header exactly as it arrived, so the
 * tag recorded after sending an event never equalled the tag read back on the
 * next pass. Every event then looked changed at the far end, and the copy over
 * there — older than the one just edited here — was applied on top of it.
 */
export function etagValue(raw: string | null | undefined) {
  if (!raw) return undefined;
  return raw.trim().replace(/^W\//i, "").replace(/^"|"$/g, "") || undefined;
}

export async function putEvent(
  credentials: Credentials,
  href: string,
  ics: string,
  etag?: string,
): Promise<{ etag?: string; href: string }> {
  const response = await dav(href, credentials, {
    method: "PUT",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      /*
       * Replace only our own copy: if somebody else changed it since, this
       * fails rather than overwriting their version.
       *
       * The quotes matter. An ETag is a quoted string in HTTP, and a server
       * given a bare one matches it against nothing and answers 412 — which
       * looked exactly like a conflict, so every write was refused as though
       * somebody else had got there first.
       */
      ...(etag ? { "If-Match": /^["W]/.test(etag) ? etag : `"${etag}"` } : {}),
    },
    body: ics,
  });

  if (response.status === 412) {
    throw new Error("That event was changed on the server since we last sent it.");
  }
  if (!response.ok && response.status !== 204) {
    throw new Error(`The server answered ${response.status} when saving an event.`);
  }
  return { etag: etagValue(response.headers.get("etag")), href };
}

export async function deleteEvent(
  credentials: Credentials,
  href: string,
): Promise<void> {
  const response = await dav(href, credentials, { method: "DELETE" });
  // Gone already is the outcome we wanted.
  if (!response.ok && response.status !== 404 && response.status !== 204) {
    throw new Error(`The server answered ${response.status} when removing an event.`);
  }
}


/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface RemoteObject {
  href: string;
  etag?: string;
}

/**
 * What is in the far calendar, as hrefs and ETags.
 *
 * The ETag is the server's word for "this is the version you have". Listing
 * them is cheap; fetching the bodies is not, so only the ones whose ETag we do
 * not recognise are downloaded.
 */
export async function listObjects(
  credentials: Credentials,
  calendarHref: string,
): Promise<RemoteObject[]> {
  const response = await dav(calendarHref, credentials, {
    method: "PROPFIND",
    depth: "1",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: `<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`,
  });
  if (!response.ok) {
    throw new Error(`The server answered ${response.status} when listing the calendar.`);
  }

  const out: RemoteObject[] = [];
  for (const block of (await response.text()).split(/<[^>]*response[^>]*>/i).slice(1)) {
    // The collection itself comes back first; only files hold events.
    if (/<[^>]*collection[^>]*\/>/i.test(block)) continue;
    const href = block.match(/<[^>]*href[^>]*>([\s\S]*?)<\/[^>]*href>/i)?.[1]?.trim();
    if (!href || !/\.ics$/i.test(href)) continue;
    const etag = block.match(/<[^>]*getetag[^>]*>([\s\S]*?)<\/[^>]*getetag>/i)?.[1]?.trim();
    out.push({ href: absolute(calendarHref, href), etag: etagValue(etag) });
  }
  return out;
}

/** The calendar file behind one of those hrefs. */
export async function getObject(
  credentials: Credentials,
  href: string,
): Promise<{ ics: string; etag?: string }> {
  const response = await dav(href, credentials, { method: "GET" });
  if (!response.ok) {
    throw new Error(`The server answered ${response.status} when reading an event.`);
  }
  return {
    ics: await response.text(),
    etag: etagValue(response.headers.get("etag")),
  };
}
