"use client";

import clsx from "clsx";
import { addDays, format, isToday, startOfDay } from "date-fns";
import { CalendarX2 } from "lucide-react";
import { useMemo } from "react";
import { colorVar } from "@/lib/colors";
import { occursOn, rangeLabel } from "@/lib/date";
import { useIsSpent } from "@/lib/past";
import { useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/types";
import { AttachmentBadge } from "./Attachments";
import { LocationLink } from "./SmartText";
import { useEventColor } from "./EventPill";
import { PeopleStack, ProvenanceIcon, useEventPeople } from "./Participants";
import type { ViewHandlers } from "./view-types";

const HORIZON_DAYS = 60;

function Row({
  event,
  handlers,
}: {
  event: CalendarEvent;
  handlers: ViewHandlers;
}) {
  const { calendarById } = useStore();
  const color = useEventColor(event);
  const spent = useIsSpent(event);
  const calendar = calendarById(event.calendarId);
  const { provenance, others, label } = useEventPeople(event);

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !event.masked) handlers.onOpenEvent(event);
      }}
      onClick={() => !event.masked && handlers.onOpenEvent(event)}
      title={event.masked ? label : `${event.title} — ${label}`}
      onContextMenu={(e) => handlers.onEventMenu(e, event)}
      style={colorVar(color)}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-2",
        spent && "opacity-55",
        handlers.selectedId === event.id && "bg-surface-2",
      )}
    >
      {event.masked ? (
        <span className="cc-busy h-2.5 w-2.5 shrink-0 rounded-full border" />
      ) : (
        <span className="cc-dot h-2.5 w-2.5 shrink-0 rounded-full" />
      )}
      <span className="hidden w-[132px] shrink-0 text-[13px] text-ink-muted tabular-nums sm:block">
        {rangeLabel(event)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={clsx(
            "block truncate text-[15px] font-medium sm:text-[14px]",
            event.masked ? "text-ink-muted italic" : "text-ink",
          )}
        >
          {event.title}
        </span>
        <span className="block text-[13px] text-ink-muted tabular-nums sm:hidden">
          {rangeLabel(event)}
        </span>
      </span>
      {provenance !== "private" && (
        <ProvenanceIcon provenance={provenance} size={13} className="text-ink-faint" />
      )}
      {event.location && (
        <span className="hidden max-w-[180px] text-[12px] sm:flex">
          <LocationLink location={event.location} />
        </span>
      )}
      <span className="hidden w-28 shrink-0 truncate text-right text-[12px] text-ink-faint md:block">
        {calendar?.name}
      </span>
      <AttachmentBadge
        count={event.attachments?.length ?? 0}
        attachments={event.attachments}
        className="text-ink-faint"
      />
      {others.length > 0 && (
        <span className="flex shrink-0 justify-end sm:w-20">
          <PeopleStack people={others} size={20} max={3} event={event} />
        </span>
      )}
    </div>
  );
}

export function AgendaView({
  date,
  events,
  handlers,
}: {
  date: Date;
  events: CalendarEvent[];
  handlers: ViewHandlers;
}) {
  const groups = useMemo(() => {
    const from = startOfDay(date);
    return Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(from, i))
      .map((day) => ({
        day,
        items: events
          .filter((e) => occursOn(e, day))
          .sort(
            (a, b) =>
              Number(b.allDay) - Number(a.allDay) ||
              new Date(a.start).getTime() - new Date(b.start).getTime(),
          ),
      }))
      .filter((g) => g.items.length > 0);
  }, [date, events]);

  return (
    <div className="cc-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl px-3 py-5 sm:px-5 sm:py-6">
        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <CalendarX2 size={30} className="text-ink-faint" />
            <p className="text-[14px] text-ink-muted">
              Nothing scheduled in the next {HORIZON_DAYS} days.
            </p>
          </div>
        )}

        {groups.map(({ day, items }) => (
          <section key={day.toISOString()} className="mb-5 flex gap-3 sm:gap-5">
            <div className="w-12 shrink-0 pt-2 text-right sm:w-20">
              <div
                className={clsx(
                  "text-[22px] leading-none font-semibold tabular-nums",
                  isToday(day) ? "text-brand" : "text-ink",
                )}
              >
                {format(day, "d")}
              </div>
              <div className="mt-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                {/* The month is already in the title bar on a narrow screen. */}
                <span className="sm:hidden">{format(day, "EEE")}</span>
                <span className="hidden sm:inline">{format(day, "EEE MMM")}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 border-l border-line pl-2">
              {items.map((event) => (
                <Row key={event.id} event={event} handlers={handlers} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
