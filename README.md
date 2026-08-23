# DocMaker Calendar

A shared calendar for the people you plan life with: your own calendars, group
calendars, and the ability to push a single event onto someone else's calendar
with a right-click.

**Phase 1 (this repo, now):** the calendar itself — month / week / day / agenda,
drag to create and move, groups, sharing UX — running entirely in the browser so
we can tune the look and feel before wiring a backend.

**Phase 2 (next):** Supabase auth + database, real multi-user sync, deploy to
Vercel. The schema is already written in [`supabase/schema.sql`](supabase/schema.sql).

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## What works today

| Area | Details |
| --- | --- |
| Views | Day, Week, Month, Agenda — switch with the segmented control or `D` / `W` / `M` / `A` |
| Create | Click an empty slot, or drag down the time grid to draw a duration |
| Move | Drag an event to another day (month) or another time/day (week & day); drag the bottom edge to resize |
| Right-click an event | Open, duplicate, **add to their calendar** (per-person sharing), **who else can see it** (privacy), move to another calendar, recolour, delete |
| Sharing at a glance | Every event shows who else is on it (avatars) and how it reached you: shared with you ↙, shared out ↗, on a group calendar 👥 |
| Busy blocks | Other people's private time appears as an anonymous grey block in its own lane, so the group can see you are taken without seeing what you are doing |
| Preview as | Look at the calendar as any group member and see exactly what they see |
| Drop files | Drag a PDF, prescription or photo onto any hour slot — it uploads, then the editor opens on that slot with the file attached, ready for times, notes and sharing. Drop onto an existing event to attach it there |
| People | Two lists — *People who share with me* and *People I share with* — with item counts; click anyone for everything running between you |
| Invite | Invite by email; they get a link to create an account. Sent through UniOne |
| Right-click empty space | New event here, new all-day event, jump to that day |
| Calendars | Personal and group-shared, colour-coded, toggled from the sidebar |
| Groups | Create a group, pick members, invite by email, optionally spin up a shared calendar with it |
| Search | Filters the current view by title, location or notes |
| Theme | Light / dark, remembered per browser |
| URL | `?view=week&date=2026-08-16` — reloads and links land where you left off |

Keyboard: `T` today · `←` / `→` (or `J` / `K`) previous/next · `N` new event ·
`Esc` close.

## How sharing is modelled

Three ways an event reaches someone, deliberately kept distinct:

1. **Personal calendar** — yours alone.
2. **Group calendar** — owned by a group (`Us`, `Family`); every member reads and
   writes it. Create one from **My groups → +**.
3. **Per-event share** — a single event pushed onto specific people's calendars
   without sharing the whole calendar. That is the right-click →
   *Add to their calendar* flow, and the *Also on their calendar* row in the
   event editor.

Every event carries that on its face: the avatars of everyone who can see it,
and an icon for how it got there — ↙ shared with you, ↗ shared out, 👥 on a
group calendar. Open one and the banner spells it out ("Ana shared this with
you", "On the Us calendar — Ana can see it"). Events other people own are
read-only, with a **Copy to my calendar** button.

### Privacy: what the rest of your group sees

The owner decides, per calendar — and per event, if one needs to differ. Set it
in the calendar settings, the sidebar's ⚙ menu, or right-click → *Who else can
see it*:

| Setting | Everyone in your groups sees |
| --- | --- |
| **Show details** | The event exactly as you see it |
| **Busy only** (default for personal calendars) | An anonymous grey hatched block — no title, place, notes or guests |
| **Hidden** | Nothing at all |

Busy blocks sit in a narrow lane down the right of the day column, so other
people's commitments never squeeze your own events. Masking happens in the
store, not the view: a masked event is rebuilt with nothing but its times, so
no detail can leak through a tooltip, a search match or the dialog. Anyone you
share an event with directly always sees it in full — that is what sharing
means, and it overrides the privacy setting.

Use **Preview as** (the avatar, top right) to look at your calendar as Ana or
anyone else and confirm what they get. It exists because phase 1 has no login;
Supabase auth replaces it.

## Files on the calendar

Drag any file onto a time slot. The hovered hour highlights (`13:00–14:00`),
the file uploads, and the event editor opens on that slot with the file
attached and the title guessed from the filename — so exact times, notes and
sharing get set in one pass. Dropping onto an existing event attaches it there
instead, and the editor has its own drop zone. Files ride along with the
event's privacy: busy-only viewers never learn they exist.

Locally the bytes go to IndexedDB (`cc.files`) and metadata to the store.
Phase 2 swaps `storeFile()` in `src/lib/files.ts` for an upload into the
`cc_attachments` bucket; nothing else changes.

## People, and who shares what

The sidebar splits contacts by direction, because "people" alone did not say
who was sending and who was receiving:

- **People who share with me** — anyone whose items reach you, with a count.
- **People I share with** — anyone your items reach.

Click a person for a panel with both directions: everything they shared with
you, everything you shared with them, dates, files and a switch for their busy
times. **Invite people** takes a list of email addresses, optionally drops them
into a group, and emails each one a `/join/<token>` link. Every invitation also
carries a copyable link, so invites still work before mail is configured.

## Project layout

```
src/
  app/
    layout.tsx        fonts, metadata, no-flash theme script
    page.tsx          mounts the store + the app
  components/
    CalendarApp.tsx   state owner: date, view, dialogs, context menus, shortcuts
    Sidebar.tsx       brand, mini month, calendar + group lists
    TopBar.tsx        navigation, search, view switch, theme
    MonthView.tsx     month grid with lane-packed event bars
    TimeGridView.tsx  week + day time grid (drag create / move / resize)
    AgendaView.tsx    upcoming list
    EventDialog.tsx   create + edit an event
    CalendarDialog.tsx / GroupDialog.tsx
    ContextMenu.tsx   right-click menus with submenus
    ui.tsx            buttons, modal, colour picker, avatars
  lib/
    types.ts          domain model (mirrors the SQL tables)
    access.ts         who may see what: full / busy / none, and event masking
    files.ts          attachment storage (IndexedDB now, Supabase Storage next)
    supabase/         browser + server clients, ready for phase 2
    date.ts           week/month maths, lane packing, overlap layout
    colors.ts         palette; colours are mixed in CSS so both themes work
    store.tsx         all reads/writes — the seam Supabase plugs into
    seed.ts           demo data, anchored to the current week
  app/api/invite/     sends invitation emails through UniOne
  app/join/[token]/   where an invite link lands
supabase/schema.sql   CC_ tables, RLS policies, storage bucket (phase 2)
```

## Data, and the road to Supabase

Everything lives in `localStorage` under `cc.state.v2`, behind the
`useStore()` API in `src/lib/store.tsx`. Every action there
(`createEvent`, `toggleEventShare`, `createGroup`, …) maps one-to-one onto a
table in `supabase/schema.sql`, so phase 2 replaces the bodies of those
functions with Supabase queries and the UI does not change.

The privacy rules exist twice on purpose: `accessFor()` in `src/lib/access.ts`
for the UI, and `cc_event_access()` plus the `cc_calendar_feed` view in the
schema for the database. Postgres row level security can hide rows but not
columns, so busy blocks are served by that view — the client selects events
from it and never from `cc_events` directly. Keep the two in step.

To reset the demo content, clear the key from devtools or call
`useStore().resetDemoData()`.

Tables are prefixed `CC_` as agreed. Postgres folds unquoted identifiers to
lower case, so they are created as `cc_events`, `cc_groups`, … and `CC_events`
in a query still resolves to the same table.

### Applying the schema

The Supabase project is **shared with other apps** — it already holds ~176
tables under `sm_`, `fm_`, `hw_`, `ab_` and other prefixes. Everything this app
creates is therefore `CC_` prefixed, and the schema touches nothing else.

That sharing extends to authentication: `auth.users` and the provider settings
(including the Google client) are common to every app on the project. So this
schema adds **no trigger on `auth.users`** — a signup for another app would
otherwise create DocMaker Calendar rows. Instead the client calls
`cc_bootstrap_me()` on load, which creates this app's profile and starter
calendar for whoever is signed in, and does nothing if they already exist.
One Google OAuth client covers every app on the project; apps are separated by
the redirect URLs allow-listed in Supabase, not by having a client each.

`supabase/schema.sql` is idempotent (every policy drops before it is created),
so paste the whole file into **Supabase → SQL editor → Run**. It creates:

`cc_profiles`, `cc_groups`, `cc_group_members`, `cc_calendars`,
`cc_calendar_visibility`, `cc_events`, `cc_attachments`, `cc_invitations`,
`cc_event_shares`, the `cc_calendar_feed` and `cc_event_guests` views, and the
private `cc_attachments` storage bucket with its policies.

It cannot be applied with the anon or service-role key alone — Supabase does
not expose arbitrary DDL over the REST API — so it is a copy-paste, or
`supabase link` + `supabase db push` if you add the CLI.

### Environment

`.env.local` is git-ignored and already filled in locally. The same four
values go into Vercel (Project → Settings → Environment Variables):

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://calendar.docmaker.studio` — invite links and metadata |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** — bypasses row level security |
| `UNIONE_API_KEY` | UniOne US; without it invites still generate links |

Optional: `UNIONE_FROM_EMAIL`, `UNIONE_FROM_NAME`.

## Lists on an event

Every event can carry a list, typed as **To-do**, **Shopping** or **Packing** —
the type decides the icon and the wording, so a reminder says "3 to buy" rather
than "3 to do".

Items take free-text quantities ("2 ×", "500g", "a case of") and can be
assigned to anyone on the event by clicking the avatar slot. **Anyone who can
see the event in full can work the list** — whoever is at the shop ticks it
off, which is the point of sharing one — and ticking is broadcast over Realtime
so it lands on the other person's screen straight away.

The grid shows a progress chip (`🛒 1/4`) beside the paperclip; the day panel
shows the whole list inline and lets you tick from there; and a reminder that
fires counts what is still outstanding.

## Reminders

Every new event starts with two: **24 hours** and **2 hours** before. Change
them in the event editor — presets from 7 days down to "at the time", and each
one delivers either as a **browser notification** or an **email**.

Reminders are personal by default:

- Yours alone unless you switch one to **everyone** (the 👤/👥 toggle).
- An "everyone" reminder reaches each person the event is shared with.
- Anyone who can see an event can add **their own** reminders on top, and only
  they see or control those.

Nobody is signed up to somebody else's alarms without choosing to, which is
why "only me" is the default.

### Notifications

Sharing an event with somebody writes them a notification — a row in
`cc_notifications`, created by a database trigger on `cc_event_shares` so it
happens however the share was made. They are kept rather than fired and
forgotten, so a share still greets you after a refresh, a new login or on
another device. The bell in the top bar carries the unread count and opens the
list; clicking one jumps to the event.

Notifications arrive **live**: the store subscribes to Supabase Realtime on
`cc_notifications`, `cc_events` and `cc_event_shares`, so a share from your
partner lights the bell without a refresh. Realtime honours row level security,
so a client is only sent changes to rows it could have selected anyway — and
rather than patching state from the payload, a change triggers a re-read, which
keeps busy masking correct (the masking lives in the view, not the raw row).

Each person also picks, **per event**, how they hear about it: in the app
(always), by email (opt-in), or on mobile (waiting on the app). Email copies go
out from the same cron, claimed with `emailed_at` before sending so nothing is
sent twice.

Browser reminders fire from the open tab (`ReminderWatcher`), which is the
honest limit of notifications without a service worker and push subscriptions;
that is the next step. When one fires you get the event, the time, the place
and a note about the next reminder still to come — with a "turn that one off"
button only if the event is yours.

Email reminders go out from `/api/cron/reminders` every 15 minutes, to the
creator, anyone the event was shared with, and the members of the group owning
the calendar. Each send inserts a row in `cc_reminder_deliveries` first, and
that insert is the lock — so a re-run inside the same window cannot send
twice.

## Subscribing to Google and Outlook

Sidebar → **Subscribed → +**. Paste the calendar's secret iCal address and
choose **Import once** or **Keep synced** (hourly, six-hourly or daily).

- Google Calendar → Settings → the calendar → *Secret address in iCal format*
- Outlook → Settings → Calendar → Shared calendars → *Publish a calendar* →
  "Can view all details" → the ICS link

Each subscription lands in its own colour-coded calendar. Imported events are
read-only both in the UI and in the database (`cc_events.feed_id is null` is
required to update a row), because the upstream calendar owns them and the
next sync would overwrite a local edit.

`/api/cron/sync-feeds` re-reads everything that is due; `vercel.json`
schedules it hourly, and each feed is only fetched once its own interval has
elapsed. Protect it by setting `CRON_SECRET` in Vercel — Vercel Cron sends it
automatically as a bearer token.

Recurring events are expanded with `rrule` across a window of 60 days back and
400 forward, and re-syncing upserts on `(feed_id, external_uid)`, so nothing
duplicates and anything cancelled upstream disappears.

**This is one-way.** Changes here never travel back to Google or Outlook —
that needs OAuth against each provider (and Google verification for the
calendar scope), which is a separate piece of work.

## Domain

DocMaker Calendar is part of **DocMaker Studio** and lives at
**calendar.docmaker.studio**.

`docmaker.studio` is registered with DNS at GoDaddy (`ns11/ns12.domaincontrol.com`)
and its apex points elsewhere, so only the subdomain is delegated — the main
site is untouched.

1. **Vercel** → project `couplescalendar` → Settings → Domains → add
   `calendar.docmaker.studio`.
2. **GoDaddy** → docmaker.studio → DNS → add the record Vercel shows, normally:

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | CNAME | `calendar` | `cname.vercel-dns.com` | 1 hour |

   Copy the target exactly as Vercel displays it — newer projects are given a
   per-account `*.vercel-dns-###.com` hostname instead.
3. Certificates are issued automatically once the record resolves.

Two things must know about the domain as well:

- **Supabase** → Authentication → URL Configuration: set the Site URL to
  `https://calendar.docmaker.studio` and add `http://localhost:3000/**` plus
  the Vercel preview pattern to the redirect allow-list. Without this,
  sign-in links bounce.
- **UniOne**: see below. The sending domain cannot be
  `calendar.docmaker.studio`.

### Why email cannot be sent from calendar.docmaker.studio

`calendar.docmaker.studio` is a CNAME to Vercel. A name holding a CNAME may
hold **no other records** (RFC 1034) — so the SPF, DKIM and ownership TXT
records UniOne asks for have nowhere to live, and verification can never pass
there. GoDaddy is not the problem; no DNS provider can do it.

The sending domain does not have to match the site domain. Recipients happily
see `DocMaker Calendar <no-reply@docmaker.studio>` on mail about a calendar at
`calendar.docmaker.studio`. So verify **`docmaker.studio`** at UniOne (or a
dedicated `mail.docmaker.studio`, which has no CNAME either) and point
`UNIONE_FROM_EMAIL` at it.

Check any candidate domain before touching UniOne:

```bash
npm run check:mail docmaker.studio
```

It reports SPF, DKIM, DMARC, the UniOne ownership record, and flags a CNAME
clash — reading public DNS, so it shows what UniOne will see.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · date-fns ·
lucide-react. Supabase for auth + data, Vercel for hosting.
