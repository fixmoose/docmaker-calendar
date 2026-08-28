"use client";

import clsx from "clsx";
import { Check, Loader2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar } from "./ui";

/**
 * Who sees everything, without being added to each event.
 *
 * This is a standing arrangement about events you create from now on — the
 * people here are put into the share field of every new event, where they can
 * still be taken off one at a time. It is deliberately not a grant of access
 * to the calendar: what it shares is events, one by one, which is why it can
 * offer to catch up the past and why removing somebody does not silently take
 * back what they have already been shown.
 */
export function AutoShareField() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [caught, setCaught] = useState<number | null>(null);

  const chosen = store.autoShare
    .map((id) => store.personById(id))
    .filter((p) => p !== undefined);

  const rest = store.contacts.filter((p) => !store.autoShare.includes(p.id));

  const add = (id: string) => {
    store.setAutoShare([...store.autoShare, id]);
    setCaught(null);
  };

  const remove = (id: string) => {
    store.setAutoShare(store.autoShare.filter((x) => x !== id));
    setCaught(null);
  };

  const catchUp = async () => {
    setBusy(true);
    try {
      setCaught(await store.backfillAutoShare());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-faint">Everything goes to</span>
          {chosen.map((person) => (
            <span
              key={person.id}
              className="flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft py-1 pr-1.5 pl-1 text-[13px] text-ink"
            >
              <Avatar person={person} size={20} />
              {person.name}
              <button
                type="button"
                onClick={() => remove(person.id)}
                aria-label={`Stop always sharing with ${person.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/*
       * These are buttons, and they now look like it. As a row of outlined
       * pills with a small plus tucked at the end they read as a list of
       * names — something being shown to you rather than something to press —
       * and the question people asked was how to add anybody at all.
       */}
      {rest.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-faint">
            {chosen.length ? "Also add" : "Add"}
          </span>
          {rest.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => add(person.id)}
              title={`Share every new event with ${person.name}`}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-brand/50 bg-surface py-1 pr-3 pl-1.5 text-[13px] font-medium text-brand transition hover:bg-brand-soft"
            >
              <UserPlus size={13} />
              <Avatar person={person} size={20} />
              {person.name}
            </button>
          ))}
        </div>
      )}

      {!chosen.length && !rest.length && (
        <p className="text-[12px] text-ink-faint">
          Nobody to share with yet — invite somebody from the sidebar first.
        </p>
      )}

      <p className="text-[12px] leading-relaxed text-ink-faint">
        {chosen.length
          ? `Every new event you make already has ${chosen
              .map((p) => p.name.split(" ")[0])
              .join(" and ")} on it, and you can take them off any single one. They are not told about each event — that would be a notification for every dentist appointment — but they see it on their calendar, and they can correct it.`
          : "Press a name above and every event you create is shared with them from the start, without your adding them each time."}
      </p>

      {chosen.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void catchUp()}
            disabled={busy}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium transition",
              busy ? "text-ink-faint" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Share the events I already have
          </button>
          {caught !== null && (
            <span className="text-[12px] text-ink-faint">
              {caught === 0 ? "Nothing to catch up." : `${caught} events caught up.`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
