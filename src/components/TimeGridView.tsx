"use client";

import clsx from "clsx";
import { addMinutes, endOfDay, format, isSameDay, isToday, startOfDay } from "date-fns";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Paperclip } from "lucide-react";
import { colorVar } from "@/lib/colors";
import { useIsMobile } from "@/lib/media";
import { useIsSpent } from "@/lib/past";
import { dragHasFiles, filesFromDrag } from "@/lib/files";
import {
  isBanner,
  layoutDay,
  layoutWeek,
  MINUTES_PER_DAY,
  minutesFromMidnight,
  timeLabel,
} from "@/lib/date";
import { useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/types";
import { EventPill, useEventColor } from "./EventPill";
import { AttachmentBadge } from "./Attachments";
import { ListBadge } from "./EventList";
import { NoteBadge } from "./NoteBadge";
import { PeopleStack, ProvenanceIcon, useEventPeople } from "./Participants";
import { LocationLink } from "./SmartText";
import { useFileDrop } from "./useFileDrop";
import { Avatar } from "./ui";
import type { ViewHandlers } from "./view-types";

/** Width of the "someone else is busy" lane, as a fraction of a day column. */
/*
 * How much of a day column somebody else's busy time takes. Wide enough to be
 * clicked on a narrow screen — a quarter of a phone column was about eleven
 * pixels, which is a target nobody can hit deliberately.
 */
const BUSY_LANE = 0.32;
const BUSY_LANE_START = 1 - BUSY_LANE;

const HOUR_H = 48;
const DAY_H = HOUR_H * 24;
/** Moving or resizing an existing event stays fine-grained. */
const SNAP = 15;
/** Creating one works in whole hours — fine-tune in the editor instead. */
const HOUR = 60;
/** The right-click menu offers the half hour you actually pointed at. */
const MENU_SNAP = 30;
/** How precisely the hover readout reports the time under the cursor. */
const READOUT_SNAP = 5;
/* Narrow on a phone: every pixel here is taken from the day columns. */
const GUTTER = "clamp(44px, 12vw, 64px)";

/**
 * A finger, rather than a mouse. Dragging with one is how you scroll, so the
 * press-and-drag gestures here — painting a new event, moving one, resizing
 * one — are for pointers that can hover and press separately.
 */
const isTouch = (e: { pointerType?: string }) => e.pointerType === "touch";

interface Tap {
  x: number;
  y: number;
  at: number;
}

/**
 * True when this tap is the second of a pair, in about the same spot. Lives
 * out here because it reads the clock, which is not allowed inside a component
 * — it is only ever called from a handler, long after rendering is done.
 */
function isSecondTap(previous: React.RefObject<Tap | null>, x: number, y: number) {
  const before = previous.current;
  const now = performance.now();
  previous.current = { x, y, at: now };
  return Boolean(
    before && now - before.at < 400 && Math.hypot(x - before.x, y - before.y) < 32,
  );
}

type Drag =
  | { mode: "create"; dayIndex: number; anchor: number; from: number; to: number }
  | { mode: "move"; event: CalendarEvent; dayIndex: number; from: number; to: number; grab: number }
  | { mode: "resize"; event: CalendarEvent; dayIndex: number; from: number; to: number };

function snap(minutes: number, step = SNAP) {
  return Math.round(minutes / step) * step;
}

const hourFloor = (minutes: number) => Math.floor(minutes / HOUR) * HOUR;
const hourCeil = (minutes: number) => Math.ceil(minutes / HOUR) * HOUR;

function clampDay(minutes: number) {
  return Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
}

function Block({
  event,
  style,
  selected,
  compact,
  editable,
  onOpen,
  onMenu,
  onMove,
  onResize,
  onFiles,
}: {
  event: CalendarEvent;
  style: React.CSSProperties;
  selected: boolean;
  compact: boolean;
  editable: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onMenu: (e: React.MouseEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onResize: (e: React.PointerEvent) => void;
  onFiles: (files: File[]) => void;
}) {
  const color = useEventColor(event);
  const { provenance, others, label } = useEventPeople(event);
  const start = new Date(event.start);
  const end = new Date(event.end);
  const masked = Boolean(event.masked);
  const spent = useIsSpent(event);
  const { over, handlers: dropHandlers } = useFileDrop(onFiles);

  return (
    <div
      style={{ ...style, ...colorVar(color) }}
      onPointerDown={editable ? (e) => !isTouch(e) && onMove(e) : undefined}
      onClick={onOpen}
      onContextMenu={onMenu}
      {...dropHandlers}
      title={masked ? label : `${event.title} — ${label}`}
      className={clsx(
        "group absolute overflow-hidden rounded-[7px] border px-2 py-1 text-[12px] transition select-none",
        // Already happened: recede, without becoming a different kind of thing.
        spent && "opacity-55",
        masked
          ? "cc-busy border-dashed"
          : "cc-tint cc-tint-border cc-rail hover:z-20 hover:shadow-[var(--shadow-sm)]",
        selected && "z-20 ring-2 ring-[var(--c)]",
        event.importance === "urgent" && !masked && "border-[#d1443c]/50",
        over && !masked && "z-40 ring-2 ring-brand ring-offset-1",
      )}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={clsx(
            "min-w-0 flex-1 truncate font-semibold",
            compact && "text-[11px] leading-tight",
            masked && "italic",
          )}
        >
          {event.title}
        </div>
        {event.importance === "urgent" && (
          <span title="Marked urgent" className="shrink-0 text-[#d1443c]">
            <AlertTriangle size={12} />
          </span>
        )}
        <NoteBadge event={event} className="opacity-80" />
        <ListBadge event={event} className="opacity-80" />
        <AttachmentBadge
          count={event.attachments?.length ?? 0}
          attachments={event.attachments}
          className="opacity-80"
        />
        {provenance !== "private" && (
          <ProvenanceIcon provenance={provenance} className="opacity-70" />
        )}
      </div>

      {!compact && (
        <div className="truncate text-[11px] opacity-80">
          <span className="tabular-nums">
            {timeLabel(start)} – {timeLabel(end)}
          </span>
          {event.location && (
            <>
              {" · "}
              <LocationLink location={event.location} showIcon={false} />
            </>
          )}
        </div>
      )}

      {!compact && others.length > 0 && (
        <PeopleStack people={others} size={16} max={4} className="mt-1" event={event} />
      )}

      {editable && (
        <div
          onPointerDown={(e) => !isTouch(e) && onResize(e)}
          className="absolute inset-x-0 -bottom-px h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
        >
          <div className="mx-auto mt-1 h-[3px] w-6 rounded-full bg-[var(--c)]" />
        </div>
      )}
    </div>
  );
}

/**
 * Someone else's time. It holds no details, but it is a real thing on the
 * screen: clicking it opens who and when, and a way to ask about it. The click
 * stops here rather than falling through to the hour underneath, which would
 * otherwise pick a slot the moment you tried to touch the block.
 */
function BusyBlock({
  event,
  style,
  height,
  narrow,
  onOpen,
  onMenu,
}: {
  event: CalendarEvent;
  style: React.CSSProperties;
  /** Rendered height in px — short blocks show the hatch alone. */
  height: number;
  narrow: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const { others, label } = useEventPeople(event);
  const person = others[0];

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      title={`${label} — click to ask about it`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(e as unknown as React.MouseEvent);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={onMenu}
      className="cc-busy absolute z-10 flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-[6px] border border-dashed px-1 py-0.5 text-[11px] transition select-none hover:border-solid hover:brightness-[0.97]"
    >
      {person && height >= 26 && <Avatar person={person} size={16} />}
      {!narrow && height >= 44 && (
        <span className="truncate font-medium italic">
          {person ? `${person.name} is busy` : "Busy"}
        </span>
      )}
    </div>
  );
}

export function TimeGridView({
  days,
  anchorDay,
  onVisibleDayChange,
  events,
  handlers,
}: {
  days: Date[];
  /** The day the app is on: where a strip opens, and where Today returns to. */
  anchorDay?: Date;
  /**
   * Told which day has come to rest on the left, so the title can follow a
   * finger across the strip without the strip itself being rebuilt underneath
   * it — rebuilding mid-pan is what a jump feels like.
   */
  onVisibleDayChange?: (day: Date) => void;
  events: CalendarEvent[];
  handlers: ViewHandlers;
}) {
  const { rescheduleEvent, canEditEvent } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  /*
   * On a phone the days are a strip wider than the screen, panned with the
   * browser's own horizontal scrolling rather than by watching for flicks: a
   * jump of a whole page on release is not what a finger asked for. Three days
   * are shown at a time and the rest is simply off the edge.
   */
  const strip = isMobile && days.length > 3;
  const column = strip ? "var(--cc-col)" : "minmax(0,1fr)";
  const template = `${GUTTER} repeat(${days.length}, ${column})`;

  /*
   * A finger is not a mouse. On a touch screen the same gesture that would be
   * a click-and-drag here is how you scroll, so pressing a slot must not start
   * painting an event and a single tap must not decide anything — otherwise
   * moving through the day leaves selections behind it.
   *
   * Across: the days move. Down: the hours scroll. Twice in the same place:
   * make something there.
   */
  const lastTap = useRef<Tap | null>(null);
  const panRef = useRef<HTMLDivElement>(null);


  const gridRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Hour slot highlighted while a file is dragged over the grid. */
  const [dropHint, setDropHint] = useState<{ dayIndex: number; hour: number } | null>(null);
  /** Minutes under the pointer, so the grid can say what time you are on. */
  const [hover, setHover] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Open on the working day rather than at midnight.
  useLayoutEffect(() => {
    const el = strip ? panRef.current : scrollRef.current;
    if (el) el.scrollTop = 7 * HOUR_H - 8;
  }, [strip]);

  const banners = useMemo(
    () => layoutWeek(events.filter(isBanner), days),
    [events, days],
  );
  /**
   * Other people's busy blocks live in their own lane down the right of the
   * column. Mixing them into the same overlap layout would shrink your real
   * events every time someone else is booked, which makes your own day harder
   * to read for information you cannot act on anyway.
   */
  const columns = useMemo(() => {
    const mine = events.filter((e) => !e.masked);
    const theirs = events.filter((e) => e.masked);
    return days.map((day) => ({
      mine: layoutDay(mine, day),
      theirs: layoutDay(theirs, day),
    }));
  }, [days, events]);

  const pointToTime = (clientX: number, clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    const colWidth = rect.width / days.length;
    const dayIndex = Math.max(
      0,
      Math.min(days.length - 1, Math.floor((clientX - rect.left) / colWidth)),
    );
    const minutes = clampDay(((clientY - rect.top) / DAY_H) * MINUTES_PER_DAY);
    return { dayIndex, minutes };
  };

  const at = (dayIndex: number, minutes: number) =>
    addMinutes(startOfDay(days[dayIndex]), clampDay(minutes));

  const beginDrag = (e: React.PointerEvent, initial: Drag) => {
    if (e.button !== 0) return;
    const originX = e.clientX;
    const originY = e.clientY;
    let moved = false;
    let current = initial;
    setDrag(current);

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - originX, ev.clientY - originY) < 5) return;
      moved = true;
      const { dayIndex, minutes } = pointToTime(ev.clientX, ev.clientY);

      if (current.mode === "create") {
        // Whole hours: dragging 17:20 → 18:40 gives 17:00 – 19:00.
        current = {
          ...current,
          from: Math.min(current.anchor, hourFloor(minutes)),
          to: Math.max(current.anchor + HOUR, hourCeil(minutes)),
        };
      } else if (current.mode === "move") {
        const length = current.to - current.from;
        const from = clampDay(snap(minutes - current.grab));
        current = {
          ...current,
          dayIndex,
          from,
          to: Math.min(MINUTES_PER_DAY, from + length),
        };
      } else {
        current = {
          ...current,
          to: Math.max(current.from + SNAP, snap(minutes)),
        };
      }
      setDrag(current);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);

      if (current.mode === "create") {
        if (!moved) return; // a plain click is handled by onClick
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 0);
        handlers.onCreate(
          at(current.dayIndex, current.from),
          at(current.dayIndex, current.to),
          false,
        );
        return;
      }

      if (!moved) return;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      rescheduleEvent(
        current.event.id,
        at(current.dayIndex, current.from),
        at(current.dayIndex, current.to),
      );
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** How much of a column your own events may use on a given day. */
  const lane = (dayIndex: number) =>
    columns[dayIndex].theirs.length > 0 ? BUSY_LANE_START : 1;

  /*
   * The strip starts showing the day the app is on, which is a few columns in
   * so there is somewhere to pan back to. Set without animation: this is where
   * the view begins, not a journey to it.
   */
  /*
   * Depends on where the strip starts and how long it is, not on the array
   * itself — a fresh array arrives on every render, so depending on it reset
   * the scroll position continuously and the days could not be moved at all.
   */
  const stripStart = days[0]?.getTime();
  const stripLength = days.length;
  useLayoutEffect(() => {
    const el = panRef.current;
    if (!el || !strip || stripStart === undefined) return;
    const index = days.findIndex((d) => isSameDay(d, anchorDay ?? days[0]));
    if (index <= 0) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) * (index / (stripLength - 3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripStart, stripLength, strip]);

  /** Which day has come to rest on the left, so the title can follow along. */
  const onPan = (e: React.UIEvent<HTMLDivElement>) => {
    if (!onVisibleDayChange || days.length < 2) return;
    const el = e.currentTarget;
    const span = el.scrollWidth - el.clientWidth;
    if (span <= 0) return;
    const index = Math.round((el.scrollLeft / span) * (days.length - 3));
    const day = days[Math.min(days.length - 1, Math.max(0, index))];
    if (day) onVisibleDayChange(day);
  };

  const selectedSlot = handlers.selectedSlot;

  /**
   * Whether the whole of this day is what has been picked out — the state you
   * get by clicking its name at the top, as opposed to an hour inside it.
   */
  const wholeDaySelected = (day: Date) => {
    if (!selectedSlot) return false;
    const from = new Date(selectedSlot.start);
    const to = new Date(selectedSlot.end);
    return (
      isSameDay(from, day) && to.getTime() - from.getTime() > 23 * 60 * 60 * 1000
    );
  };
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const nowMinutes = minutesFromMidnight(now);
  const single = days.length === 1;

  return (
    <div
      ref={panRef}
      onScroll={strip ? onPan : undefined}
      className={clsx(
        "flex min-h-0 flex-1 flex-col bg-surface",
        /*
         * The browser pans it: finger-tracking and momentum for free, and none
         * of it written here. Both axes belong to this one element, so the
         * hour gutter has something to pin itself to.
         *
         * Nothing snaps. It stops where you stop it, and the worst that
         * happens is part of a fourth day showing at the edge, which is a
         * better answer than the calendar arguing with your thumb.
         * overscroll-x-contain keeps a pan near the edge from being taken as
         * the browser's own back gesture.
         */
        strip && "cc-scroll overflow-auto overscroll-x-contain",
      )}
      style={
        strip
          ? ({ "--cc-col": `calc((100vw - ${GUTTER}) / 3)` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Day headers + all-day strip */}
      <div
        className={clsx(
          "shrink-0 border-b border-line",
          strip && "sticky top-0 z-30 w-max bg-surface",
        )}
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: template }}
        >
          <div className={clsx(strip && "sticky left-0 z-20 bg-surface")} />
          {days.map((day) => (
            <button
              key={day.toISOString()}
              type="button"
              /*
               * Clicking the name picks the whole day out; it takes a second
               * click to go there. On a phone one tap still opens it: there is
               * no second click worth waiting for, and less room to work in.
               */
              onClick={() =>
                isMobile
                  ? handlers.onNavigate(day, "day")
                  : handlers.onSelectSlot(startOfDay(day), endOfDay(day), true)
              }
              onDoubleClick={() => handlers.onNavigate(day, "day")}
              title={
                isMobile
                  ? undefined
                  : `Pick out ${format(day, "EEEE d MMMM")} — double-click to open it`
              }
              /*
               * Stacked on a narrow column, side by side when there is room.
               * Laid out in a row, "MON" and "17" collided with the next day's
               * label as soon as the column dropped below about 60px.
               */
              className={clsx(
                "flex flex-col items-center justify-center gap-0.5 border-l border-line py-2 transition sm:flex-row sm:gap-1.5",
                wholeDaySelected(day)
                  ? "bg-brand-soft ring-1 ring-brand/40 ring-inset"
                  : "hover:bg-surface-2",
              )}
            >
              <span
                className={clsx(
                  "text-[11px] font-semibold tracking-wider uppercase",
                  isToday(day) ? "text-brand" : "text-ink-faint",
                )}
              >
                {format(day, single ? "EEEE" : "EEE")}
              </span>
              <span
                className={clsx(
                  "flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[15px] font-semibold sm:h-6 sm:min-w-6 sm:text-[14px]",
                  isToday(day) ? "bg-brand text-white" : "text-ink",
                )}
              >
                {day.getDate()}
              </span>
            </button>
          ))}
        </div>

        <div
          className="grid"
          style={{ gridTemplateColumns: template }}
        >
          <div
            className={clsx(
              "flex items-start justify-end pt-1.5 pr-2 text-[10px] font-medium tracking-wide text-ink-faint uppercase",
              strip && "sticky left-0 z-20 bg-surface",
            )}
          >
            {/* "All day" wraps to two lines in the narrow phone gutter. */}
            <span className="hidden sm:inline">All day</span>
            <span className="sm:hidden">All</span>
          </div>
          <div
            className="relative min-h-[30px] py-1"
            style={{
              gridColumn: "2 / -1",
              height: Math.max(30, banners.laneCount * 23 + 8),
            }}
          >
            <div
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${days.length}, ${column})` }}
            >
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  onClick={() => {
                    const s = startOfDay(day);
                    const e = new Date(s);
                    e.setHours(23, 59, 59, 999);
                    handlers.onSelectSlot(s, e, true);
                  }}
                  onDoubleClick={() => {
                    const s = startOfDay(day);
                    const e = new Date(s);
                    e.setHours(23, 59, 59, 999);
                    handlers.onCreate(s, e, true);
                  }}
                  onContextMenu={(e) => handlers.onSlotMenu(e, day, true)}
                  className={clsx(
                    "border-l border-line transition-colors hover:bg-surface-2",
                    isToday(day) && !single && "bg-brand-soft/40",
                  )}
                />
              ))}
            </div>
            {banners.segments.map((seg) => (
              <div
                key={seg.event.id}
                className="absolute px-[3px]"
                style={{
                  left: `${(seg.col / days.length) * 100}%`,
                  width: `${(seg.span / days.length) * 100}%`,
                  top: 4 + seg.lane * 23,
                }}
              >
                <EventPill
                  event={seg.event}
                  banner
                  continuesLeft={seg.continuesLeft}
                  continuesRight={seg.continuesRight}
                  selected={handlers.selectedId === seg.event.id}
                  onOpen={(e) => {
                    e.stopPropagation();
                    if (seg.event.masked) return;
                    handlers.onOpenEvent(seg.event);
                  }}
                  onMenu={(e) => handlers.onEventMenu(e, seg.event)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={clsx(strip ? "w-max" : "cc-scroll min-h-0 flex-1 overflow-y-auto")}
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: template,
            height: DAY_H,
          }}
        >
          {/* Hour labels */}
          <div className={clsx("relative", strip && "sticky left-0 z-20 bg-surface")}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-ink-faint tabular-nums"
                style={{ top: h * HOUR_H }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {/* Columns */}
          <div
            ref={gridRef}
            onMouseMove={(e) => {
              const { minutes } = pointToTime(e.clientX, e.clientY);
              setHover(snap(minutes, READOUT_SNAP));
            }}
            onMouseLeave={() => setHover(null)}
            className="relative grid select-none"
            style={{
              gridColumn: "2 / -1",
              gridTemplateColumns: `repeat(${days.length}, ${column})`,
            }}
          >
            {hover !== null && !drag && (
              <div
                className="pointer-events-none absolute inset-x-0 z-20"
                style={{ top: (hover / MINUTES_PER_DAY) * DAY_H }}
              >
                <div className="h-px w-full bg-brand/45" />
                <span className="absolute -top-[9px] -left-[52px] w-[46px] rounded-md bg-brand px-1 py-0.5 text-center text-[10px] font-semibold text-white tabular-nums">
                  {timeLabel(addMinutes(startOfDay(days[0]), hover))}
                </span>
              </div>
            )}

            {days.map((day, dayIndex) => (
              <div
                key={day.toISOString()}
                className={clsx(
                  "relative border-l border-line",
                  isToday(day) && !single && "bg-brand-soft/25",
                  wholeDaySelected(day) && "bg-brand-soft/45",
                )}
                onPointerDown={(e) => {
                  // A finger here is scrolling until it proves otherwise.
                  if (isTouch(e)) {
                    if (isSecondTap(lastTap, e.clientX, e.clientY)) {
                      const { minutes } = pointToTime(e.clientX, e.clientY);
                      const from = hourFloor(minutes);
                      handlers.onCreate(at(dayIndex, from), at(dayIndex, from + HOUR), false);
                    }
                    return;
                  }
                  const { minutes } = pointToTime(e.clientX, e.clientY);
                  const anchor = hourFloor(minutes);
                  beginDrag(e, {
                    mode: "create",
                    dayIndex,
                    anchor,
                    from: anchor,
                    to: anchor + HOUR,
                  });
                }}
                onClick={(e) => {
                  if (justDragged.current || e.detail === 0) return;
                  // Handled on the second tap instead — see above.
                  if (isMobile) return;
                  const { minutes } = pointToTime(e.clientX, e.clientY);
                  const from = Math.floor(minutes / 60) * 60;
                  handlers.onSelectSlot(at(dayIndex, from), at(dayIndex, from + 60), false);
                }}
                onDoubleClick={(e) => {
                  const { minutes } = pointToTime(e.clientX, e.clientY);
                  const from = hourFloor(minutes);
                  handlers.onCreate(at(dayIndex, from), at(dayIndex, from + HOUR), false);
                }}
                onContextMenu={(e) => {
                  const { minutes } = pointToTime(e.clientX, e.clientY);
                  handlers.onSlotMenu(e, at(dayIndex, snap(minutes, MENU_SNAP)), false);
                }}
                onDragEnter={(e) => dragHasFiles(e) && e.preventDefault()}
                onDragOver={(e) => {
                  if (!dragHasFiles(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  const { minutes } = pointToTime(e.clientX, e.clientY);
                  const hour = Math.floor(minutes / 60);
                  if (dropHint?.dayIndex !== dayIndex || dropHint?.hour !== hour) {
                    setDropHint({ dayIndex, hour });
                  }
                }}
                onDragLeave={(e) => {
                  if (!dragHasFiles(e)) return;
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(null);
                }}
                onDrop={(e) => {
                  if (!dragHasFiles(e)) return;
                  e.preventDefault();
                  const files = filesFromDrag(e);
                  const { minutes } = pointToTime(e.clientX, e.clientY);
                  const hour = Math.floor(minutes / 60);
                  setDropHint(null);
                  if (files.length) {
                    handlers.onDropFiles(
                      files,
                      at(dayIndex, hour * 60),
                      at(dayIndex, hour * 60 + 60),
                      false,
                    );
                  }
                }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-line"
                    style={{ top: h * HOUR_H }}
                  >
                    <div
                      className="absolute inset-x-0 border-t border-dashed border-line/60"
                      style={{ top: HOUR_H / 2 }}
                    />
                  </div>
                ))}

                {columns[dayIndex].theirs.map((p) => (
                  <BusyBlock
                    key={p.event.id}
                    event={p.event}
                    narrow={!single}
                    height={Math.max(16, p.height * DAY_H - 2)}
                    onOpen={() => handlers.onOpenEvent(p.event)}
                    onMenu={(e) => handlers.onEventMenu(e, p.event)}
                    style={{
                      top: p.top * DAY_H,
                      height: Math.max(16, p.height * DAY_H - 2),
                      left: `calc(${(BUSY_LANE_START + p.left * BUSY_LANE) * 100}% + 2px)`,
                      width: `calc(${p.width * BUSY_LANE * 100}% - 4px)`,
                    }}
                  />
                ))}

                {columns[dayIndex].mine.map((p) => (
                  <Block
                    key={p.event.id}
                    event={p.event}
                    selected={handlers.selectedId === p.event.id}
                    compact={p.height * DAY_H < 44}
                    editable={canEditEvent(p.event)}
                    style={{
                      top: p.top * DAY_H,
                      height: Math.max(18, p.height * DAY_H - 2),
                      left: `calc(${p.left * lane(dayIndex) * 100}% + 3px)`,
                      width: `calc(${p.width * lane(dayIndex) * 100}% - 6px)`,
                      opacity: drag && "event" in drag && drag.event.id === p.event.id ? 0.35 : 1,
                    }}
                    onOpen={(e) => {
                      e.stopPropagation();
                      if (justDragged.current || p.event.masked) return;
                      handlers.onOpenEvent(p.event);
                    }}
                    onMenu={(e) => handlers.onEventMenu(e, p.event)}
                    onMove={(e) => {
                      e.stopPropagation();
                      const { minutes } = pointToTime(e.clientX, e.clientY);
                      const from = minutesFromMidnight(new Date(p.event.start));
                      const to = from + Math.round(p.height * MINUTES_PER_DAY);
                      beginDrag(e, {
                        mode: "move",
                        event: p.event,
                        dayIndex,
                        from,
                        to,
                        grab: minutes - from,
                      });
                    }}
                    onFiles={(files) => handlers.onDropFilesOnEvent(files, p.event)}
                    onResize={(e) => {
                      e.stopPropagation();
                      const from = minutesFromMidnight(new Date(p.event.start));
                      beginDrag(e, {
                        mode: "resize",
                        event: p.event,
                        dayIndex,
                        from,
                        to: from + Math.round(p.height * MINUTES_PER_DAY),
                      });
                    }}
                  />
                ))}

                {/* Live drag preview */}
                {drag && drag.dayIndex === dayIndex && (
                  <div
                    className="pointer-events-none absolute right-[3px] left-[3px] z-30 rounded-[7px] border-2 border-brand bg-brand/15 px-2 py-1 text-[11px] font-semibold text-brand"
                    style={{
                      top: (drag.from / MINUTES_PER_DAY) * DAY_H,
                      height: Math.max(18, ((drag.to - drag.from) / MINUTES_PER_DAY) * DAY_H),
                    }}
                  >
                    {timeLabel(at(dayIndex, drag.from))} – {timeLabel(at(dayIndex, drag.to))}
                  </div>
                )}

                {selectedSlot && isSameDay(new Date(selectedSlot.start), day) && (
                  <div
                    className="pointer-events-none absolute inset-x-[3px] z-10 rounded-[7px] border-2 border-brand/60 bg-brand-soft/60"
                    style={{
                      top:
                        (minutesFromMidnight(new Date(selectedSlot.start)) /
                          MINUTES_PER_DAY) *
                        DAY_H,
                      height: Math.max(
                        18,
                        ((new Date(selectedSlot.end).getTime() -
                          new Date(selectedSlot.start).getTime()) /
                          60000 /
                          MINUTES_PER_DAY) *
                          DAY_H,
                      ),
                    }}
                  />
                )}

                {dropHint?.dayIndex === dayIndex && (
                  <div
                    className="pointer-events-none absolute inset-x-[3px] z-40 flex flex-col items-center justify-center gap-1 rounded-[7px] border-2 border-dashed border-brand bg-brand-soft/90 px-1 text-center text-[11px] font-semibold text-brand"
                    style={{ top: dropHint.hour * HOUR_H, height: HOUR_H }}
                  >
                    <Paperclip size={13} />
                    <span className="truncate">
                      Drop here · {String(dropHint.hour).padStart(2, "0")}:00–
                      {String((dropHint.hour + 1) % 24).padStart(2, "0")}:00
                    </span>
                  </div>
                )}

                {isSameDay(day, now) && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10"
                    style={{ top: (nowMinutes / MINUTES_PER_DAY) * DAY_H }}
                  >
                    <div className="relative h-px bg-[#e0443c]">
                      <span className="absolute -top-[3.5px] -left-[3px] h-[7px] w-[7px] rounded-full bg-[#e0443c]" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
