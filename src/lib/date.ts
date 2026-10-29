import {
  addDays,
  differenceInMinutes,
  endOfDay,
  endOfWeek,
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { preferences } from "./settings";
import type { CalendarEvent } from "./types";

/**
 * Week start and clock format come from the viewer's settings. These helpers
 * are pure functions called from everywhere, so they read the mirrored
 * preferences rather than taking the values as arguments — see lib/settings.
 */
export const weekStartsOn = () => preferences().weekStartsOn;

/** Kept for the seed and anything that needs a fixed value. */
export const WEEK_STARTS_ON = 1 as const;

export const MINUTES_PER_DAY = 24 * 60;

export function weekStart(d: Date) {
  return startOfWeek(d, { weekStartsOn: weekStartsOn() });
}

export function weekEnd(d: Date) {
  return endOfWeek(d, { weekStartsOn: weekStartsOn() });
}

export function weekDays(d: Date): Date[] {
  const s = weekStart(d);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** The 6×7 grid a month view paints, including leading/trailing days. */
export function monthMatrix(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = weekStart(first);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
  );
}

export function eventRange(e: CalendarEvent) {
  return { start: new Date(e.start), end: new Date(e.end) };
}

/** Half-open overlap test — an event ending at 09:00 is not "in" the 09:00 slot. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export function occursOn(e: CalendarEvent, day: Date) {
  const { start, end } = eventRange(e);
  return overlaps(start, end, startOfDay(day), endOfDay(day));
}

/** True when the event covers more than one calendar day. */
export function isMultiDay(e: CalendarEvent) {
  const { start, end } = eventRange(e);
  return !isSameDay(start, end);
}

/** Events that occupy the all-day strip: all-day flag or spanning days. */
export function isBanner(e: CalendarEvent) {
  return e.allDay || isMultiDay(e);
}

export function minutesFromMidnight(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

export function durationMinutes(e: CalendarEvent) {
  const { start, end } = eventRange(e);
  return Math.max(1, differenceInMinutes(end, start));
}

/* ------------------------------------------------------------------ *
 * Month / all-day row layout
 * ------------------------------------------------------------------ */

export interface Segment {
  event: CalendarEvent;
  /** Column index within the week, 0–6. */
  col: number;
  span: number;
  /** Stacking row inside the week cell. */
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

/**
 * Places a week's events into lanes: banners first (earliest first, the
 * longer of two that start together above) so they form continuous bars
 * across the row, then timed events in start order.
 *
 * Given a `floor` — the lanes the row has room for — the banners settle to
 * the bottom of it as one block, earliest at the top of the block, and the
 * timed events fill down from the top. A bar running across the week then
 * does not take the first line of every day it touches. Without one they
 * start at the top, which is what a strip of nothing but banners wants.
 *
 * Returns the segments, how many lanes were needed, and the lane the banner
 * block starts at.
 */
export function layoutWeek(events: CalendarEvent[], days: Date[], floor?: number) {
  const rowStart = startOfDay(days[0]);
  const rowEnd = endOfDay(days[days.length - 1]);

  const visible = events.filter((e) => {
    const { start, end } = eventRange(e);
    return overlaps(start, end, rowStart, rowEnd);
  });

  const ranked = [...visible].sort((a, b) => {
    const ab = isBanner(a);
    const bb = isBanner(b);
    if (ab !== bb) return ab ? -1 : 1;
    const as = new Date(a.start).getTime();
    const bs = new Date(b.start).getTime();
    if (as !== bs) return as - bs;
    if (ab && bb) {
      const aLen = new Date(a.end).getTime() - as;
      const bLen = new Date(b.end).getTime() - bs;
      if (aLen !== bLen) return bLen - aLen;
    }
    return a.title.localeCompare(b.title);
  });

  const placed = ranked.flatMap((event) => {
    const { start, end } = eventRange(event);
    let col = days.findIndex((d) => isSameDay(d, start));
    if (col < 0) col = start < rowStart ? 0 : -1;
    if (col < 0) return [];

    let last = days.findIndex((d) => isSameDay(d, end));
    if (last < 0) last = end > rowEnd ? 6 : col;
    const span = Math.max(1, last - col + 1);

    return [
      {
        event,
        col,
        span,
        continuesLeft: start < rowStart,
        continuesRight: end > rowEnd,
      },
    ];
  });

  const pack = (lanes: boolean[][], col: number, span: number, from = 0) => {
    let lane = from;
    for (;;) {
      lanes[lane] ??= new Array(7).fill(false);
      const free = lanes[lane].slice(col, col + span).every((taken) => !taken);
      if (free) break;
      lane += 1;
    }
    for (let i = col; i < col + span; i++) lanes[lane][i] = true;
    return lane;
  };

  // The banners are packed among themselves first, to learn how tall their
  // block is, and then the block is set down where it belongs.
  const bannerLanes: boolean[][] = [];
  const inBlock = new Map<CalendarEvent, number>();
  for (const p of placed) {
    if (isBanner(p.event)) inBlock.set(p.event, pack(bannerLanes, p.col, p.span));
  }
  const bannerFrom =
    floor === undefined ? 0 : Math.max(0, floor - bannerLanes.length);

  const lanes: boolean[][] = [];
  const segments: Segment[] = [];
  for (const p of placed) {
    const block = inBlock.get(p.event);
    const lane =
      block === undefined ? pack(lanes, p.col, p.span) : pack(lanes, p.col, p.span, bannerFrom + block);
    segments.push({ ...p, lane });
  }

  return { segments, laneCount: lanes.length, bannerFrom };
}

/* ------------------------------------------------------------------ *
 * Time grid layout
 * ------------------------------------------------------------------ */

export interface Positioned {
  event: CalendarEvent;
  /** Fractions of the day, 0–1. */
  top: number;
  height: number;
  /** Fractions of the column width, 0–1. */
  left: number;
  width: number;
}

/**
 * Side-by-side placement for overlapping timed events: events are grouped into
 * clusters that touch, and each cluster is split into as many columns as its
 * deepest overlap needs.
 */
export function layoutDay(events: CalendarEvent[], day: Date): Positioned[] {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  const items = events
    .filter((e) => !isBanner(e) && occursOn(e, day))
    .map((e) => {
      const { start, end } = eventRange(e);
      const from = Math.max(minutesFromMidnight(start), start < dayStart ? 0 : minutesFromMidnight(start));
      const to = end > dayEnd ? MINUTES_PER_DAY : minutesFromMidnight(end);
      return { event: e, from, to: Math.max(to, from + 15) };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);

  const out: Positioned[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const columns: (typeof items)[] = [];
    for (const item of cluster) {
      let placed = false;
      for (const col of columns) {
        if (col[col.length - 1].to <= item.from) {
          col.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([item]);
    }
    const total = columns.length;
    columns.forEach((col, index) => {
      for (const item of col) {
        out.push({
          event: item.event,
          top: item.from / MINUTES_PER_DAY,
          height: (item.to - item.from) / MINUTES_PER_DAY,
          left: index / total,
          width: 1 / total,
        });
      }
    });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length && item.from >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.to);
  }
  flush();

  return out;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function timeLabel(d: Date, hour12 = preferences().hour12) {
  if (hour12) {
    return format(d, d.getMinutes() === 0 ? "h a" : "h:mm a").toLowerCase();
  }
  return format(d, "HH:mm");
}

export function rangeLabel(e: CalendarEvent, hour12 = preferences().hour12) {
  const { start, end } = eventRange(e);
  if (e.allDay) return "All day";
  return `${timeLabel(start, hour12)} – ${timeLabel(end, hour12)}`;
}

/** Title shown in the top bar for the active view. */
export function periodLabel(date: Date, view: string) {
  if (view === "day") return format(date, "EEEE, d MMMM yyyy");
  if (view === "week") {
    const s = weekStart(date);
    const e = weekEnd(date);
    if (s.getMonth() === e.getMonth()) return format(s, "MMMM yyyy");
    if (s.getFullYear() === e.getFullYear())
      return `${format(s, "MMM")} – ${format(e, "MMM yyyy")}`;
    return `${format(s, "MMM yyyy")} – ${format(e, "MMM yyyy")}`;
  }
  if (view === "agenda") return format(date, "MMMM yyyy");
  return format(date, "MMMM yyyy");
}

/** Snap a date to the nearest N-minute step — used by click-to-create. */
export function snapMinutes(d: Date, step = 15) {
  const snapped = new Date(d);
  snapped.setMinutes(Math.round(d.getMinutes() / step) * step, 0, 0);
  return snapped;
}
