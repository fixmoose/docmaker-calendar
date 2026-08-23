"use client";

import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { colorVar } from "@/lib/colors";
import { isPast, isSpent, outstanding, useNow } from "@/lib/past";
import { timeLabel } from "@/lib/date";
import { useStore } from "@/lib/store";
import type { CalendarEvent, ColorKey } from "@/lib/types";
import { AttachmentBadge } from "./Attachments";
import { ListBadge } from "./EventList";
import { NoteBadge } from "./NoteBadge";
import { PeopleStack, ProvenanceIcon, useEventPeople } from "./Participants";
import { useFileDrop } from "./useFileDrop";

export function useEventColor(event: CalendarEvent): ColorKey {
  const { calendarById } = useStore();
  return event.color ?? calendarById(event.calendarId)?.color ?? "slate";
}

/**
 * The compact representation used in month cells and the all-day strip.
 * `banner` events get a solid bar; timed events stay light so a dense day
 * still reads as a list rather than a block of colour.
 */
export function EventPill({
  event,
  banner,
  continuesLeft,
  continuesRight,
  selected,
  onOpen,
  onMenu,
  onDragStart,
  onFiles,
}: {
  event: CalendarEvent;
  banner: boolean;
  continuesLeft?: boolean;
  continuesRight?: boolean;
  selected?: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onMenu: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.PointerEvent) => void;
  onFiles?: (files: File[]) => void;
}) {
  const color = useEventColor(event);
  const { provenance, others, label } = useEventPeople(event);
  const start = new Date(event.start);
  const masked = Boolean(event.masked);
  const now = useNow();
  const spent = isSpent(event, now);
  // Past, but with things still unticked: the opposite of finished.
  const overdue = isPast(event, now) && !spent;
  const left = outstanding(event);
  const { over, handlers: dropHandlers } = useFileDrop((files) => onFiles?.(files));

  return (
    <div
      role="button"
      tabIndex={0}
      style={colorVar(color)}
      onPointerDown={masked ? undefined : onDragStart}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e as unknown as React.MouseEvent);
        }
      }}
      onContextMenu={onMenu}
      {...(onFiles && !masked ? dropHandlers : {})}
      title={`${event.title} — ${label}`}
      className={clsx(
        "flex h-[21px] w-full items-center gap-1.5 overflow-hidden px-1.5 text-[12px] leading-none transition select-none",
        // Already happened: recede, but stay legible and stay itself.
        spent && "opacity-55",
        event.importance === "urgent" && !masked && "ring-1 ring-[#d1443c]/40",
        masked
          ? "cc-busy border border-dashed font-medium italic"
          : banner
            ? "cc-solid font-medium"
            : "font-medium text-ink hover:bg-surface-2",
        continuesLeft ? "rounded-l-none" : "rounded-l-[5px]",
        continuesRight ? "rounded-r-none" : "rounded-r-[5px]",
        selected && "ring-2 ring-[var(--c)] ring-offset-1 ring-offset-[var(--surface)]",
        over && "ring-2 ring-brand ring-offset-1 ring-offset-[var(--surface)]",
      )}
    >
      {!banner && !masked && (
        <span className="cc-dot h-[7px] w-[7px] shrink-0 rounded-full" />
      )}
      {continuesLeft && <span className="shrink-0 opacity-80">‹</span>}
      <span className="truncate">
        {!banner && (
          <span
            className={clsx(
              "mr-1 tabular-nums",
              masked ? "opacity-70" : "text-ink-muted",
            )}
          >
            {timeLabel(start)}
          </span>
        )}
        {event.title}
      </span>
      {event.importance === "urgent" && (
        <AlertTriangle
          size={11}
          className={clsx("shrink-0", banner ? "opacity-90" : "text-[#d1443c]")}
        />
      )}
      {/* Its date has gone by and the list has not been finished. */}
      {left > 0 && overdue && (
        <span
          title={`${left} still to do`}
          className="shrink-0 rounded-full bg-[#d1443c] px-1 text-[10px] leading-[14px] font-semibold text-white"
        >
          {left}
        </span>
      )}
      <NoteBadge event={event} className={banner ? "opacity-90" : "text-ink-faint"} />
      <ListBadge event={event} className={banner ? "opacity-90" : "text-ink-faint"} />
      <AttachmentBadge
        count={event.attachments?.length ?? 0}
        attachments={event.attachments}
        className={banner ? "opacity-90" : "text-ink-faint"}
      />

      <span className="ml-auto flex shrink-0 items-center gap-1">
        {/* On a busy block the useful detail is whose time it is. */}
        {masked ? (
          <PeopleStack people={others} size={13} max={1} />
        ) : (
          <>
            {provenance !== "private" && (
              <ProvenanceIcon
                provenance={provenance}
                className={banner ? "opacity-90" : "text-ink-faint"}
              />
            )}
            {others.length > 0 && (
              <PeopleStack people={others} size={14} max={2} event={event} />
            )}
          </>
        )}
        {continuesRight && <span className="opacity-80">›</span>}
      </span>
    </div>
  );
}
