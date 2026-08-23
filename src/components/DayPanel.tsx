"use client";

import clsx from "clsx";
import { format, isToday } from "date-fns";
import { AlertTriangle, CalendarPlus, EyeOff, MapPin } from "lucide-react";
import { useMemo } from "react";
import { colorVar } from "@/lib/colors";
import { occursOn, rangeLabel } from "@/lib/date";
import { useIsSpent } from "@/lib/past";
import { useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/types";
import { AttachmentBadge } from "./Attachments";
import { EventList, ListBadge } from "./EventList";
import { useEventColor } from "./EventPill";
import { PeopleStack, useEventPeople } from "./Participants";
import { LocationLink } from "./SmartText";
import type { ViewHandlers } from "./view-types";

function Item({
  event,
  handlers,
  mobile = false,
}: {
  event: CalendarEvent;
  handlers: ViewHandlers;
  mobile?: boolean;
}) {
  const color = useEventColor(event);
  const { others, label } = useEventPeople(event);
  const { calendarById } = useStore();
  const masked = Boolean(event.masked);
  const spent = useIsSpent(event);

  return (
    <div
      role="button"
      tabIndex={0}
      title={masked ? label : `${event.title} — ${label}`}
      onClick={() => !masked && handlers.onOpenEvent(event)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !masked) handlers.onOpenEvent(event);
      }}
      onContextMenu={(e) => handlers.onEventMenu(e, event)}
      style={colorVar(color)}
      className={clsx(
        "group w-full rounded-xl border text-left transition",
        mobile ? "px-4 py-3.5" : "px-3 py-2.5",
        spent && "opacity-55",
        masked
          ? "cc-busy border-dashed"
          : "cc-tint-border border-line bg-surface hover:border-[var(--c)] hover:shadow-[var(--shadow-sm)]",
        handlers.selectedId === event.id && "ring-2 ring-[var(--c)]",
      )}
    >
      <div className="flex items-center gap-2">
        {masked ? (
          <EyeOff size={12} className="shrink-0 text-ink-faint" />
        ) : (
          <span className="cc-dot h-2.5 w-2.5 shrink-0 rounded-full" />
        )}
        <span
          className={clsx(
            "min-w-0 flex-1 truncate font-semibold",
            mobile ? "text-[16px]" : "text-[13px]",
            masked ? "text-ink-muted italic" : "text-ink",
          )}
        >
          {event.title}
        </span>
        {event.importance === "urgent" && (
          <AlertTriangle size={13} className="shrink-0 text-[#d1443c]" />
        )}
        <ListBadge event={event} className="text-ink-faint" />
        <AttachmentBadge
          count={event.attachments?.length ?? 0}
          attachments={event.attachments}
          className="text-ink-faint"
        />
      </div>

      <div className="mt-1 flex items-center gap-2 pl-[18px]">
        <span
          className={clsx(
            "text-ink-muted tabular-nums",
            mobile ? "text-[14px]" : "text-[12px]",
          )}
        >
          {rangeLabel(event)}
        </span>
        {!masked && (
          <span className="truncate text-[11px] text-ink-faint">
            {calendarById(event.calendarId)?.name}
          </span>
        )}
      </div>

      {event.location && (
        <div className="mt-1 flex items-center gap-1 pl-[18px] text-[12px]">
          <MapPin size={11} className="shrink-0 text-ink-faint" />
          <LocationLink location={event.location} showIcon={false} />
        </div>
      )}

      {!masked && (event.items?.length ?? 0) > 0 && (
        <div
          className="mt-2 border-t border-line pt-2 pl-[18px]"
          onClick={(e) => e.stopPropagation()}
        >
          <EventList event={event} compact />
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-1.5 pl-[18px]">
          <PeopleStack people={others} size={18} max={5} event={event} />
        </div>
      )}
    </div>
  );
}

/**
 * The companion list beside the day grid: everything happening that day in
 * order, so the day reads as a to-do without hunting through the timeline.
 */
export function DayPanel({
  date,
  events,
  handlers,
  mobile = false,
}: {
  date: Date;
  events: CalendarEvent[];
  handlers: ViewHandlers;
  /** On a phone this is the whole view, not a companion column. */
  mobile?: boolean;
}) {
  const items = useMemo(
    () =>
      events
        .filter((e) => occursOn(e, date))
        .sort(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) ||
            new Date(a.start).getTime() - new Date(b.start).getTime(),
        ),
    [events, date],
  );

  const mine = items.filter((e) => !e.masked);
  const urgent = mine.filter((e) => e.importance === "urgent").length;

  return (
    <aside
      className={clsx(
        "flex flex-col bg-surface",
        mobile ? "min-h-0 flex-1" : "w-[340px] shrink-0 border-l border-line",
      )}
    >
      <div
        className={clsx(
          "flex items-baseline gap-2 border-b border-line px-4",
          mobile ? "py-4" : "py-3",
        )}
      >
        <h2
          className={clsx(
            "font-semibold text-ink",
            mobile ? "text-[20px]" : "text-[15px]",
          )}
        >
          {isToday(date) ? "Today" : format(date, "EEEE")}
        </h2>
        <span className={clsx("text-ink-faint", mobile ? "text-[15px]" : "text-[12px]")}>
          {format(date, "d MMMM")}
        </span>
        <span
          className={clsx("ml-auto text-ink-faint", mobile ? "text-[14px]" : "text-[12px]")}
        >
          {mine.length} {mine.length === 1 ? "item" : "items"}
          {urgent > 0 && <span className="ml-1.5 text-[#d1443c]">· {urgent} urgent</span>}
        </span>
      </div>

      <div
        className={clsx(
          "cc-scroll min-h-0 flex-1 overflow-y-auto",
          mobile ? "space-y-2.5 p-3 pb-24" : "space-y-1.5 p-3",
        )}
      >
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <CalendarPlus size={24} className="text-ink-faint" />
            <p className="text-[13px] text-ink-muted">Nothing planned.</p>
            <button
              type="button"
              onClick={() => {
                const start = new Date(date);
                start.setHours(9, 0, 0, 0);
                const end = new Date(start);
                end.setHours(10, 0, 0, 0);
                handlers.onCreate(start, end, false);
              }}
              className="text-[13px] font-medium text-brand hover:underline"
            >
              Add something
            </button>
          </div>
        )}

        {items.map((event) => (
          <Item key={event.id} event={event} handlers={handlers} mobile={mobile} />
        ))}
      </div>
    </aside>
  );
}
