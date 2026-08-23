import {
  CalendarDays,
  EyeOff,
  Paperclip,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * First thing a new visitor sees. Logged-in users never get here — the
 * middleware sends them straight to /calendar.
 */

const FEATURES = [
  {
    icon: Share2,
    title: "Share one thing, not everything",
    body: "Right-click any event to put it on your partner's calendar. The rest of your week stays yours.",
  },
  {
    icon: EyeOff,
    title: "Busy, without the details",
    body: "Your group sees that a time is taken — never the title, place or people. You choose, per calendar or per event.",
  },
  {
    icon: Users,
    title: "Groups that make sense",
    body: "A calendar for the two of you, another for the whole family. Everyone in the group reads and writes it.",
  },
  {
    icon: Paperclip,
    title: "Drop a file on a time slot",
    body: "A prescription, a ticket, a booking. Drop it on Tuesday at 3pm and the event writes itself.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-full bg-bg">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-5 sm:gap-3 sm:px-6 sm:py-6">
        <Image src="/logo-mark.png" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
        <span className="truncate text-[15px] font-bold tracking-tight text-ink sm:text-[16px]">
          DocMaker <span className="text-brand">Calendar</span>
        </span>
        <nav className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-ink-muted transition hover:bg-surface-2 hover:text-ink sm:px-3.5"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center rounded-lg bg-brand px-3.5 text-sm font-medium whitespace-nowrap text-white shadow-[var(--shadow-sm)] transition hover:bg-brand-strong sm:px-4"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-10 pb-16 text-center sm:pt-16">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-brand">
          <Sparkles size={13} /> Welcome to DocMaker Calendar
        </span>

        <h1 className="mx-auto mt-5 max-w-3xl text-[38px] leading-[1.1] font-bold tracking-tight text-balance text-ink sm:text-[52px]">
          The calendar for the people you plan life with
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-pretty text-ink-muted">
          Keep your own calendar. Share the parts that matter — a dinner, a
          school run, a doctor&apos;s appointment — and let everyone else see
          only that you are busy.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand px-6 text-[15px] font-semibold text-white shadow-[var(--shadow-sm)] transition hover:bg-brand-strong sm:w-auto"
          >
            Create your calendar
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-line bg-surface px-6 text-[15px] font-medium text-ink transition hover:bg-surface-2 sm:w-auto"
          >
            I already have an account
          </Link>
        </div>

        <p className="mt-4 text-[12px] text-ink-faint">
          Free to start · Sign in with Google or email
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon size={17} />
              </span>
              <h2 className="mt-3.5 text-[15px] font-semibold text-ink">{title}</h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
          <CalendarDays size={26} className="text-brand" />
          <h2 className="text-[22px] font-bold tracking-tight text-ink">
            Start with your own calendar. Invite people when you are ready.
          </h2>
          <p className="max-w-md text-[14px] leading-relaxed text-ink-muted">
            Nothing is shared until you share it, and you can take it back at
            any time.
          </p>
          <Link
            href="/signup"
            className="mt-1 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-[15px] font-semibold text-white transition hover:bg-brand-strong"
          >
            Get started — it takes a minute
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-[12px] text-ink-faint sm:flex-row">
          <span>Part of DocMaker Studio</span>
          <span>© {new Date().getFullYear()} DocMaker Studio</span>
        </div>
      </footer>
    </main>
  );
}
