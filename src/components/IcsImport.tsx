"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { importIcsEvents } from "@/lib/db";
import { parseIcs } from "@/lib/ics";
import { useStore } from "@/lib/store";
import { Button, controlClass } from "./ui";

/**
 * A calendar file, read in once.
 *
 * Not a connection: an .ics is what somebody sends you or what another
 * calendar hands you on the way out, and once its events are here they are
 * ordinary events — editable, deletable, yours. Anything that should stay in
 * step belongs in the rows above instead.
 */
/**
 * Wide enough to take a whole file rather than a window of it: somebody
 * importing last year's diary means to import last year's diary. Out here
 * because it reads the clock, which a component may not do while rendering.
 */
const wholeFile = () => ({
  from: new Date(Date.now() - 10 * 365 * 86400_000),
  to: new Date(Date.now() + 10 * 365 * 86400_000),
});

export function IcsImport() {
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mine = store.calendars.filter((c) => c.ownerId === store.currentUserId);
  const [target, setTarget] = useState(mine[0]?.id ?? "");

  const read = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      if (!text.includes("BEGIN:VCALENDAR")) {
        throw new Error("That file is not a calendar. It should end in .ics");
      }
      const events = parseIcs(text, wholeFile());
      if (!events.length) throw new Error("No events were found in that file.");

      const count = await importIcsEvents(
        store.supabase,
        target || mine[0].id,
        store.currentUserId,
        events,
      );
      setResult(
        `${count} event${count === 1 ? "" : "s"} added to ${
          mine.find((c) => c.id === (target || mine[0].id))?.name ?? "your calendar"
        }.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
          Import a calendar file (.ics)
        </Button>

        {mine.length > 1 && (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${controlClass} py-1.5 text-[13px]`}
          >
            {mine.map((c) => (
              <option key={c.id} value={c.id}>
                into {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
        }}
      />

      {result && <p className="text-[12px] text-[#3f9142]">{result}</p>}
      {error && <p className="text-[12px] text-[#d1443c]">{error}</p>}

      <p className="text-[12px] leading-relaxed text-ink-faint">
        A one-off copy — the events become yours to edit. Importing the same
        file again replaces what it brought last time rather than doubling it.
      </p>
    </div>
  );
}
