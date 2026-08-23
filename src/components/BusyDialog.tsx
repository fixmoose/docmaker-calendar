"use client";

import { EyeOff, Send } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { rangeLabel } from "@/lib/date";
import { useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/types";
import { Avatar, Button, Field, Modal } from "./ui";

/**
 * Somebody else's busy block, opened.
 *
 * It used to open nothing at all, which is right about the details and wrong
 * about the person: seeing that Wednesday afternoon is taken and having no way
 * to ask about it is exactly when you want to say something.
 *
 * What is not shown here is deliberate — no title, no place, no guesswork — and
 * the note does not go onto their event either. It goes into the notes you
 * share, quoting the time, so they can answer it. Writing on an event you are
 * not entitled to read would be the same leak in the other direction.
 */
export function BusyDialog({
  event,
  onClose,
}: {
  event: CalendarEvent;
  onClose: () => void;
}) {
  const store = useStore();
  const person = store.personById(event.createdBy);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const start = new Date(event.start);
  const when = `${format(start, "EEEE d MMMM")}, ${rangeLabel(event)}`;

  // Somewhere they will both see it: a group the two of them are in.
  const shared = store.groups.find(
    (g) =>
      g.memberIds.includes(store.currentUserId) &&
      g.memberIds.includes(event.createdBy),
  );

  const ask = () => {
    const text = body.trim();
    if (!text) return;
    store.addNote({
      body: `${when} — ${text}`,
      groupId: shared?.id,
      color: "slate",
    });
    setSent(true);
    window.setTimeout(onClose, 1200);
  };

  return (
    <Modal title="Someone else's time" onClose={onClose} width={460}>
      {sent ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Send size={26} className="text-brand" />
          <p className="text-[15px] font-medium text-ink">
            Written in {shared ? shared.name : "your notes"}
          </p>
          <p className="text-[13px] text-ink-muted">
            {person?.name ?? "They"} will see it with the time attached.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            {person && <Avatar person={person} size={26} />}
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium text-ink">
                {person?.name ?? "Somebody"} is busy
              </span>
              <span className="block text-[13px] text-ink-muted">{when}</span>
            </span>
          </div>

          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
            <EyeOff size={13} className="mt-0.5 shrink-0" />
            You are shown that the time is taken and nothing else — not the
            title, the place, or who else is on it. That is their setting to
            change, not yours.
          </p>

          <Field label="Ask about it">
            <textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
              }}
              rows={3}
              placeholder={`Is this movable? Could you fetch Lena at four?`}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand"
            />
            <p className="mt-1.5 text-[12px] text-ink-faint">
              Goes into {shared ? `the ${shared.name} notes` : "your notes"} with
              the time written at the front, so it is clear what it is about.
            </p>
          </Field>
        </div>
      )}

      {!sent && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={ask} disabled={!body.trim()}>
            <Send size={15} /> Ask {person?.name.split(" ")[0] ?? "them"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
