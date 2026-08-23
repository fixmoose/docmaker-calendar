import { NextResponse } from "next/server";

/**
 * Sends invitation emails through UniOne (US region).
 *
 * Set UNIONE_API_KEY (and optionally UNIONE_FROM_EMAIL / UNIONE_FROM_NAME) in
 * the environment. Without a key the route reports back cleanly so the UI can
 * fall back to copyable invite links instead of failing silently.
 *
 * UNIONE_FROM_EMAIL must live on a domain UniOne has verified, which cannot be
 * calendar.docmaker.studio: that name is a CNAME to Vercel, and a CNAME
 * excludes every other record, so the SPF/DKIM/verification TXT records have
 * nowhere to go. Send from the apex (docmaker.studio) instead.
 */

const UNIONE_ENDPOINT =
  process.env.UNIONE_API_URL ?? "https://us1.unione.io/en/transactional/api/v1/email/send.json";

interface InvitePayload {
  email: string;
  token: string;
  link: string;
}

/** The event an invitation is about, when it is about one. */
interface EventPayload {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  organiser?: string;
  organiserEmail?: string;
}

const stamp = (iso: string, allDay = false) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return allDay ? date : `${date}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};

const escapeIcs = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/**
 * A real iCalendar attachment, so the invitation lands in Outlook, Apple
 * Calendar and Gmail as something you can accept rather than just a link.
 */
function buildIcs(event: EventPayload, uid: string, link: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DocMaker Studio//DocMaker Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${stamp(event.start, true)}`
      : `DTSTART:${stamp(event.start)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${stamp(event.end, true)}`
      : `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.location ? `LOCATION:${escapeIcs(event.location)}` : "",
    `DESCRIPTION:${escapeIcs(`${event.notes ? `${event.notes}\n\n` : ""}Open in DocMaker Calendar: ${link}`)}`,
    event.organiserEmail
      ? `ORGANIZER;CN=${escapeIcs(event.organiser ?? "")}:mailto:${event.organiserEmail}`
      : "",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter(Boolean).join("\r\n");
}

function when(event: EventPayload) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const date = start.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  if (event.allDay) return `${date} · all day`;
  const time = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time(start)} – ${time(end)}`;
}

function html(fromName: string, link: string, message: string, event?: EventPayload) {
  return `<!doctype html>
<html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#fff;border-radius:16px;padding:32px">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:20px;color:#1a1a1e">
            ${escapeHtml(fromName)} invited you to ${event ? escapeHtml(event.title) : "DocMaker Calendar"}
          </h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#6b6b76">
            Share plans, and keep the rest of your calendar private.
          </p>
          ${
            event
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;border:1px solid #e6e6ea;border-radius:12px">
                   <tr><td style="padding:14px 16px">
                     <div style="font-size:16px;font-weight:600;color:#1a1a1e">${escapeHtml(event.title)}</div>
                     <div style="margin-top:4px;font-size:14px;color:#6b6b76">${escapeHtml(when(event))}</div>
                     ${event.location ? `<div style="margin-top:4px;font-size:14px;color:#6b6b76">${escapeHtml(event.location)}</div>` : ""}
                   </td></tr>
                 </table>`
              : ""
          }
          ${
            message
              ? `<p style="margin:0 0 20px;padding:12px 14px;border-left:3px solid #dc6b15;background:#fdf1e7;font-size:14px;line-height:1.5;color:#1a1a1e">${escapeHtml(message)}</p>`
              : ""
          }
          <a href="${link}" style="display:inline-block;background:#dc6b15;color:#fff;text-decoration:none;
             font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Accept the invitation</a>
          <p style="margin:22px 0 0;font-size:12px;color:#9a9aa5">
            Or paste this link into your browser:<br>${link}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export async function POST(request: Request) {
  const apiKey = process.env.UNIONE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Email is not configured yet — set UNIONE_API_KEY. Share the invite links below in the meantime.",
      },
      { status: 503 },
    );
  }

  let body: {
    invites?: InvitePayload[];
    fromName?: string;
    message?: string;
    event?: EventPayload;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const invites = (body.invites ?? []).filter((i) => i?.email?.includes("@"));
  if (!invites.length) {
    return NextResponse.json({ error: "No valid email addresses." }, { status: 400 });
  }

  const fromName = body.fromName?.slice(0, 80) || "A friend";
  const message = body.message?.slice(0, 500) ?? "";

  const results = await Promise.all(
    invites.map(async (invite) => {
      const response = await fetch(UNIONE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          message: {
            recipients: [{ email: invite.email }],
            template_engine: "simple",
            body: { html: html(fromName, invite.link, message, body.event) },
            subject: body.event
              ? `${fromName} invited you to ${body.event.title}`
              : `${fromName} invited you to DocMaker Calendar`,
            ...(body.event
              ? {
                  attachments: [
                    {
                      type: "text/calendar; method=REQUEST; charset=utf-8",
                      name: "invite.ics",
                      content: Buffer.from(
                        buildIcs(body.event, `${invite.token}@calendar.docmaker.studio`, invite.link),
                      ).toString("base64"),
                    },
                  ],
                }
              : {}),
            from_email: process.env.UNIONE_FROM_EMAIL ?? "no-reply@docmaker.studio",
            from_name: process.env.UNIONE_FROM_NAME ?? "DocMaker Calendar",
            track_links: 0,
            track_read: 0,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      return { email: invite.email, ok: response.ok, payload };
    }),
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    return NextResponse.json(
      {
        error: `UniOne rejected ${failed.length} of ${results.length} invitations.`,
        details: failed.map((f) => ({ email: f.email, response: f.payload })),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ sent: results.length });
}
