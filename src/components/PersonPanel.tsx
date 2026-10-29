"use client";

import clsx from "clsx";
import { format, isBefore, startOfDay } from "date-fns";
import { ArrowDownLeft, CalendarDays, Eye, EyeOff, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { colorVar } from "@/lib/colors";
import { rangeLabel } from "@/lib/date";
import { useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/types";
import { AttachmentBadge } from "./Attachments";
import { useEventColor } from "./EventPill";
import { Avatar, Button, Modal } from "./ui";

type Tab = "from" | "to";

function ItemRow({
  event,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
}) {
  const color = useEventColor(event);
  const { calendarById } = useStore();
  const start = new Date(event.start);
  const past = isBefore(start, startOfDay(new Date()));

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      style={colorVar(color)}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2",
        past && "cc-past",
      )}
    >
      <span className="cc-dot h-2.5 w-2.5 shrink-0 rounded-full" />
      <span className="w-[92px] shrink-0 text-[12px] text-ink-muted tabular-nums">
        {format(start, "d MMM")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {event.title}
        </span>
        <span className="block truncate text-[11px] text-ink-faint">
          {rangeLabel(event)} · {calendarById(event.calendarId)?.name}
        </span>
      </span>
      <AttachmentBadge count={event.attachments?.length ?? 0} className="text-ink-faint" />
    </button>
  );
}

/**
 * Everything running between you and one person: what they sent you, what you
 * sent them, and a switch for their busy blocks.
 */
export function PersonPanel({
  personId,
  onClose,
  onOpenEvent,
}: {
  personId: string;
  onClose: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
}) {
  const store = useStore();
  const person = store.personById(personId);
  const { fromThem, toThem } = store.itemsWith(personId);
  const [tab, setTab] = useState<Tab>(fromThem.length >= toThem.length ? "from" : "to");

  const items = useMemo(() => {
    const list = tab === "from" ? fromThem : toThem;
    return [...list].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  }, [tab, fromThem, toThem]);

  if (!person) return null;
  const busyHidden = store.busyHidden.includes(personId);

  return (
    <Modal
      title={
        <span className="flex items-center gap-2.5">
          <Avatar person={person} size={26} />
          <span>
            <span className="block leading-tight">{person.name}</span>
            <span className="block text-[11px] font-normal text-ink-faint">
              {person.email}
            </span>
          </span>
        </span>
      }
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => store.togglePersonBusy(personId)}
          >
            {busyHidden ? <Eye size={15} /> : <EyeOff size={15} />}
            {busyHidden ? "Show their busy times" : "Hide their busy times"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5">
          {(
            [
              ["from", `Shared with me`, fromThem.length, <ArrowDownLeft key="f" size={13} />],
              ["to", `I shared with ${person.name}`, toThem.length, <Share2 key="t" size={13} />],
            ] as const
          ).map(([value, label, count, icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={clsx(
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium transition",
                tab === value
                  ? "bg-surface text-brand shadow-[var(--shadow-sm)]"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {icon}
              {label}
              <span className="text-ink-faint">{count}</span>
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CalendarDays size={26} className="text-ink-faint" />
            <p className="text-[13px] text-ink-muted">
              {tab === "from"
                ? `${person.name} has not shared anything with you yet.`
                : `You have not shared anything with ${person.name} yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((event) => (
              <ItemRow key={event.id} event={event} onOpen={onOpenEvent} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
