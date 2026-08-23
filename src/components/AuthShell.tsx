import Link from "next/link";
import type { ReactNode } from "react";

/** Centred card used by the log-in and sign-up pages. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-full flex-col bg-bg">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-md)]">
          {children}
        </div>
      </div>
      <footer className="pb-8 text-center text-[12px] text-ink-faint">
        <Link href="/" className="hover:text-ink">
          DocMaker Calendar
        </Link>{" "}
        — part of DocMaker Studio
      </footer>
    </main>
  );
}
