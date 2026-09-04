import { NextResponse } from "next/server";

/**
 * The two moments in letting somebody into a group that cannot wait for
 * whenever a person next opens the calendar.
 *
 * Everything else the app has to say it says in the app, where it belongs.
 * But being asked to agree to something is not news you go looking for: the
 * question sits in a sidebar nobody has a reason to open, and the person who
 * asked is left thinking the whole thing is broken. Likewise being told a
 * group has said yes to you.
 *
 * The wording is fixed here rather than passed in: this route sends two
 * sentences about a calendar, and nothing else, whoever calls it.
 */

const UNIONE_ENDPOINT =
  process.env.UNIONE_API_URL ?? "https://us1.unione.io/en/transactional/api/v1/email/send.json";

type Kind = "vote" | "join";

const clean = (value: unknown, max = 80) =>
  typeof value === "string" ? value.slice(0, max).replace(/[<>]/g, "") : "";

function html(heading: string, line: string, link: string, action: string) {
  return `<!doctype html>
<html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td>
          <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;color:#18181b">${heading}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#52525b">${line}</p>
          <a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px">${action}</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a1a1aa">DocMaker Calendar</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function POST(request: Request) {
  const apiKey = process.env.UNIONE_API_KEY;
  // No key is not a failure: the calendar says all of this in the app too.
  if (!apiKey) return NextResponse.json({ sent: 0, reason: "no mail key" });

  let body: {
    kind?: Kind;
    to?: string[];
    fromName?: string;
    personName?: string;
    groupName?: string;
    link?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const kind: Kind = body.kind === "join" ? "join" : "vote";
  const to = (body.to ?? []).filter((e) => typeof e === "string" && e.includes("@")).slice(0, 20);
  if (!to.length) return NextResponse.json({ error: "No valid email addresses." }, { status: 400 });

  const from = clean(body.fromName) || "Somebody";
  const person = clean(body.personName) || "somebody";
  const group = clean(body.groupName) || "a group";
  const link = /^https?:\/\//.test(body.link ?? "") ? (body.link as string) : "";
  if (!link) return NextResponse.json({ error: "No link." }, { status: 400 });

  const subject =
    kind === "vote"
      ? `${from} wants to add ${person} to ${group}`
      : `${group} would like you to join`;

  const heading = subject;
  const line =
    kind === "vote"
      ? `They would see when everybody in ${group} is busy, and everything the group shares. It does not happen until everyone agrees — including you.`
      : `Everyone there will see when you are busy, and you will see the same of them. Nothing happens until you say yes.`;
  const action = kind === "vote" ? "Say yes or no" : "Open the calendar";

  const results = await Promise.all(
    to.map(async (email) => {
      try {
        const response = await fetch(UNIONE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
          body: JSON.stringify({
            message: {
              recipients: [{ email }],
              template_engine: "simple",
              body: { html: html(heading, line, link, action) },
              subject,
              from_email: process.env.UNIONE_FROM_EMAIL ?? "no-reply@docmaker.studio",
              from_name: process.env.UNIONE_FROM_NAME ?? "DocMaker Calendar",
              track_links: 0,
              track_read: 0,
            },
          }),
        });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );

  return NextResponse.json({ sent: results.filter(Boolean).length });
}
