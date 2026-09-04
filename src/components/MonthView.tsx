"use client";

import clsx from "clsx";
import {
  addDays,
  addHours,
  differenceInCalendarDays,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  endOfDay as endOfDayOf,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Paperclip, ShoppingCart, StickyNote } from "lucide-react";
import { colorVar } from "@/lib/colors";
import { layoutWeek, monthMatrix, occursOn, weekDays } from "@/lib/date";
import { isHoliday } from "@/lib/holidays";
import { useIsMobile } from "@/lib/media";
import { dragHasFiles, filesFromDrag } from "@/lib/files";
import { localDay, useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/types";
import { EventPill } from "./EventPill";
import type { ViewHandlers } from "./view-types";

const LANE_H = 23;
const HEADER_H = 26;
/** One line of a national day, along the floor of the cell. */
const HOLIDAY_H = 15;
/** The band standing where one month turns into the next, in pixels. */
const WALL_W = 30;

/** About one notch of a mouse wheel — that much movement moves a row. */
const WHEEL_STEP = 30;
/** The pause between rows, so one long flick does not run away with the year. */
const WHEEL_COOLDOWN = 80;

export function MonthView({
  date,
  events,
  handlers,
}: {
  date: Date;
  events: CalendarEvent[];
  handlers: ViewHandlers;
}) {
  const { rescheduleEvent, canEditEvent, notes, shoppingLists } = useStore();

  /*
   * What is written against a day rather than against something in it: a note
   * about the day, and the shopping. Both are a mark in the corner of the box
   * — small enough to ignore, enough to know it is there — and both open the
   * paper they live on.
   */
  const marks = useMemo(() => {
    const map = new Map<string, { notes: number; board: string; shopping: boolean }>();
    const at = (day: string) =>
      map.get(day) ?? { notes: 0, board: "me", shopping: false };
    for (const note of notes) {
      if (!note.day) continue;
      const mark = at(note.day);
      map.set(note.day, {
        ...mark,
        notes: mark.notes + 1,
        board: mark.notes ? mark.board : (note.groupId ?? "me"),
      });
    }
    for (const list of shoppingLists) {
      map.set(list.day, { ...at(list.day), shopping: true });
    }
    return map;
  }, [notes, shoppingLists]);
  const isMobile = useIsMobile();
  /**
   * Where the six rows start when a month is simply opened.
   *
   * Its own grid, except for today: being shown today on the last row but one
   * is an answer about the past, when what is wanted is the week one is in and
   * the weeks to come. Today's row is put second — a week of what has been
   * above it, four of what is ahead below.
   */
  const opensAt = useMemo(() => {
    const grid = monthMatrix(date);
    if (!isToday(date)) return grid[0][0];
    const row = grid.findIndex((week) => week.some((day) => isSameDay(day, date)));
    return addDays(grid[0][0], (row < 0 ? 0 : row - 1) * 7);
  }, [date]);

  /**
   * Where the wheel has put them since, which holds only for the month it was
   * left in. Any other way into a month — the arrows, Today, a link, the back
   * button — no longer answers to it, and the month opens where it should.
   */
  const [scrolled, setScrolled] = useState<{ month: number; top: number } | null>(null);
  const topTime = scrolled?.month === date.getTime() ? scrolled.top : opensAt.getTime();
  const weeks = useMemo(() => {
    const start = new Date(topTime);
    return Array.from({ length: 6 }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
    );
  }, [topTime]);
  const labels = useMemo(
    () => weekDays(new Date()).map((d) => format(d, "EEE")),
    [],
  );

  /*
   * A national day is not an appointment. It belongs to the box rather than
   * to the list of things happening in it, so it is set along the floor of the
   * cell and left out of the packing above — where it would otherwise take the
   * first lane and push the day's actual events down.
   */
  const [plain, holidays] = useMemo(
    () => [events.filter((e) => !isHoliday(e)), events.filter(isHoliday)],
    [events],
  );

  const [rowHeight, setRowHeight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; overKey: string } | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  // A drag ends with a click event on the pill; swallow that one click.
  const justDragged = useRef(false);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setRowHeight(el.clientHeight / weeks.length);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  const lanesIn = (holidayLines: number) =>
    Math.max(
      1,
      Math.floor((rowHeight - HEADER_H - 4 - holidayLines * HOLIDAY_H) / LANE_H),
    );

  /*
   * A phone's day cell is a third the width, and the same wall there would
   * swallow the day either side of it.
   */
  const wallW = isMobile ? 16 : WALL_W;
  /*
   * The name is as large as the wall can hold and the row can show: three
   * upright letters each take about their own size in height, and neither the
   * frame's sides nor its ends may be pushed at. A window squeezed short
   * therefore gets smaller letters rather than letters running past the
   * frame, and it stops growing at the wall's own width so it cannot be wider
   * than what it stands in.
   */
  const wallType = Math.max(
    8,
    Math.min(wallW - 2, Math.floor((rowHeight - 14) / 3.2)),
  );

  /**
   * The wheel moves one row: a week down, a week up. A whole month a notch is
   * more than anybody means by turning a wheel, and it left nothing on screen
   * to hold on to.
   *
   * The month named above the grid follows the rows rather than leading them:
   * whichever month the middle of the six belongs to is the one being looked
   * at, and the view does not move when the name changes.
   *
   * A trackpad sends a stream of small deltas for a single flick, so movement
   * is gathered to a notch's worth and a short pause between rows keeps a long
   * gesture from running away. The listener is non-passive, so the page behind
   * cannot scroll or swipe back instead.
   */
  const onNavigate = handlers.onNavigate;
  const top = weeks[0][0];
  const wheel = useRef({ accum: 0, last: 0, until: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const moveRows = (direction: 1 | -1) => {
      const nextTop = addDays(top, direction * 7);
      // Whichever month the middle of the six belongs to is the one being
      // looked at, so the name follows the rows rather than leading them.
      const month = startOfMonth(addDays(nextTop, 21));
      if (isSameMonth(month, date)) {
        setScrolled({ month: date.getTime(), top: nextTop.getTime() });
        return;
      }
      setScrolled({ month: month.getTime(), top: nextTop.getTime() });
      onNavigate(month, "month");
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // a zoom gesture, not navigation
      e.preventDefault();
      const now = Date.now();
      const w = wheel.current;
      if (now - w.last > 200) w.accum = 0; // a new gesture starts from nothing
      w.last = now;
      if (now < w.until) return;
      w.accum += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      if (Math.abs(w.accum) < WHEEL_STEP) return;
      const direction = w.accum > 0 ? 1 : -1;
      w.accum = 0;
      w.until = now + WHEEL_COOLDOWN;
      moveRows(direction);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [date, top, onNavigate]);

  /** Pointer-drag an event onto another day. */
  const startDrag = (e: React.PointerEvent, event: CalendarEvent) => {
    if (e.button !== 0 || !canEditEvent(event)) return;
    const originX = e.clientX;
    const originY = e.clientY;
    let moved = false;
    let target: Date | null = null;

    const dayUnder = (x: number, y: number) => {
      const el = document
        .elementsFromPoint(x, y)
        .find((n) => n instanceof HTMLElement && n.dataset.day) as
        | HTMLElement
        | undefined;
      return el?.dataset.day ? new Date(el.dataset.day) : null;
    };

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - originX, ev.clientY - originY) < 5) return;
      moved = true;
      target = dayUnder(ev.clientX, ev.clientY);
      setDrag({ id: event.id, overKey: target ? target.toDateString() : "" });
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved || !target) return;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      const start = new Date(event.start);
      const end = new Date(event.end);
      const shift = differenceInCalendarDays(target, startOfDay(start));
      if (shift !== 0) {
        rescheduleEvent(event.id, addDays(start, shift), addDays(end, shift));
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {labels.map((label) => (
          <div
            key={label}
            className="py-2 text-center text-[11px] font-semibold tracking-wider text-ink-faint uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      <div ref={gridRef} className="flex min-h-0 flex-1 flex-col">
        {weeks.map((days, weekIndex) => {
          const { segments } = layoutWeek(plain, days);
          const onDay = days.map((day) => holidays.filter((h) => occursOn(h, day)));
          // The whole row gives up the same floor space, so its lanes stay level.
          const maxLanes = lanesIn(Math.max(...onDay.map((list) => list.length)));
          const shown = segments.filter((s) => s.lane < maxLanes);
          const hidden = segments.filter((s) => s.lane >= maxLanes);

          /*
           * Where the month turns over, said plainly rather than left to be
           * worked out by reading the numbers — which is the whole trouble
           * with scrolling week by week.
           *
           * Inside a row it is a band standing between the last day of one
           * month and the first of the next, taking a sliver from each and
           * carrying the new month's name. Where a month begins on the first
           * day of a week there is no such gap, and the row's own top edge is
           * the break.
           */
          const turnsOver = days.findIndex(
            (day, i) => i > 0 && !isSameMonth(day, days[i - 1]),
          );
          const opensRow = days[0].getDate() === 1;

          /*
           * The wall stands in the row rather than over the top of it. A pill
           * reaching the turn of the month stops short of it, one beginning
           * there begins after it, and one running across is drawn as two —
           * which is what it is: some days in August and some in September.
           */
          const pieces = shown.flatMap((seg) => {
            const from = seg.col;
            const to = seg.col + seg.span;
            const across = turnsOver > from && turnsOver < to;
            const spans: { from: number; to: number; left: boolean; right: boolean }[] = across
              ? [
                  { from, to: turnsOver, left: seg.continuesLeft, right: true },
                  { from: turnsOver, to, left: true, right: seg.continuesRight },
                ]
              : [{ from, to, left: seg.continuesLeft, right: seg.continuesRight }];

            return spans.map((piece) => {
              const clipStart = turnsOver === piece.from ? WALL_W / 2 : 0;
              const clipEnd = turnsOver === piece.to ? WALL_W / 2 : 0;
              return { seg, ...piece, clipStart, clipEnd };
            });
          });

          return (
            <div
              key={weekIndex}
              className="relative grid min-h-0 flex-1 grid-cols-7"
            >
              {days.map((day, dayIndex) => {
                const inMonth = isSameMonth(day, date);
                const today = isToday(day);
                const overflow = hidden.filter(
                  (s) =>
                    day >= days[s.col] &&
                    day <= days[Math.min(6, s.col + s.span - 1)],
                ).length;

                return (
                  <div
                    key={day.toISOString()}
                    data-day={day.toISOString()}
                    /*
                     * A click picks the day out; it takes a second one to go
                     * there. Clicking about a month to see what is on is the
                     * common act, and having each of those clicks change the
                     * view made looking around feel like being dragged.
                     *
                     * A phone has no double tap worth relying on, and its
                     * month cells show dots rather than titles, so there a tap
                     * still opens the day — otherwise the view answers nothing.
                     */
                    onClick={() =>
                      isMobile
                        ? handlers.onNavigate(day, "day")
                        : handlers.onSelectSlot(startOfDay(day), endOfDayOf(day), true)
                    }
                    onDoubleClick={() => handlers.onNavigate(day, "day")}
                    onContextMenu={(e) => handlers.onSlotMenu(e, day, true)}
                    onDragEnter={(e) => {
                      if (!dragHasFiles(e)) return;
                      e.preventDefault();
                      setDropDay(day.toDateString());
                    }}
                    onDragOver={(e) => {
                      if (!dragHasFiles(e)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDragLeave={(e) => {
                      if (!dragHasFiles(e)) return;
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropDay(null);
                    }}
                    onDrop={(e) => {
                      if (!dragHasFiles(e)) return;
                      e.preventDefault();
                      setDropDay(null);
                      const files = filesFromDrag(e);
                      if (!files.length) return;
                      const start = new Date(day);
                      start.setHours(9, 0, 0, 0);
                      handlers.onDropFiles(files, start, addHours(start, 1), false);
                    }}
                    className={clsx(
                      "group relative min-w-0 border-r border-b border-line transition-colors last:border-r-0",
                      inMonth ? "bg-surface" : "bg-surface-2/60",
                      drag?.overKey === day.toDateString() && "bg-brand-soft",
                      dropDay === day.toDateString() &&
                        "bg-brand-soft ring-2 ring-brand ring-inset",
                      handlers.selectedSlot &&
                        isSameDay(new Date(handlers.selectedSlot.start), day) &&
                        "ring-2 ring-brand/60 ring-inset",
                    )}
                  >
                    {dropDay === day.toDateString() && (
                      <span className="pointer-events-none absolute inset-x-1 bottom-1 z-30 flex items-center justify-center gap-1 rounded-md bg-brand px-1 py-0.5 text-[10px] font-semibold text-white">
                        <Paperclip size={10} /> Drop file here
                      </span>
                    )}
                    <div className="flex h-[26px] items-center justify-center pt-[3px]">
                      <button
                        type="button"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handlers.onNavigate(day, "day");
                        }}
                        title="Double-click to open this day"
                        className={clsx(
                          "flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-medium transition",
                          today
                            ? "bg-brand font-semibold text-white"
                            : inMonth
                              ? "text-ink-muted hover:bg-surface-2"
                              : "text-ink-faint hover:bg-surface",
                        )}
                      >
                        {day.getDate() === 1
                          ? format(day, "d MMM")
                          : day.getDate()}
                      </button>
                    </div>

                    <DayMarks mark={marks.get(localDay(day))} />

                    {isMobile ? (
                      <MonthDots events={plain} day={day} />
                    ) : null}

                    <div className="absolute right-1.5 bottom-1 left-1.5 flex flex-col">
                      {!isMobile && overflow > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlers.onNavigate(day, "day");
                          }}
                          className="truncate rounded px-1 text-left text-[11px] font-medium text-ink-muted hover:bg-surface-2 hover:text-brand"
                        >
                          +{overflow} more
                        </button>
                      )}
                      {onDay[dayIndex].map((holiday) => (
                        <span
                          key={holiday.id}
                          title={holiday.title}
                          onContextMenu={(e) => handlers.onEventMenu(e, holiday)}
                          // Said quietly: it is the day's name, not something
                          // anybody has to do.
                          className="truncate px-1 text-[11px] leading-[15px] font-medium text-ink-muted opacity-70"
                        >
                          {holiday.title}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}

              {turnsOver > 0 && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-20 flex -translate-x-1/2 items-center justify-center border border-line-strong bg-surface-2"
                  style={{
                    left: `${(turnsOver * 100) / 7}%`,
                    width: wallW,
                  }}
                >
                  {/*
                   * Upright letters stacked one on the next, not a word turned
                   * on its side: it is read at a glance while scrolling, and a
                   * glance does not tilt its head. Ink rather than a faint
                   * grey, so it carries at the edge of the eye — and ink is
                   * black on a white calendar and white on a dark one, which
                   * a hard black would not be.
                   */}
                  <span
                    className="leading-none font-bold tracking-tighter text-ink uppercase [text-orientation:upright] [writing-mode:vertical-rl]"
                    style={{ fontSize: wallType }}
                  >
                    {format(days[turnsOver], "MMM")}
                  </span>
                </div>
              )}

              {opensRow && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-0 items-center gap-1.5 pr-2">
                  <span className="rounded-r-sm border-y border-r border-line-strong bg-surface-2 px-1.5 py-[3px] text-[12px] font-bold tracking-[0.08em] text-ink uppercase">
                    {format(days[0], "MMM")}
                  </span>
                  <span className="h-px flex-1 bg-line-strong" />
                </div>
              )}

              <div
                className={clsx(
                  "pointer-events-none absolute inset-x-0 bottom-0",
                  // Phones show dots inside each cell instead — see MonthDots.
                  isMobile && "hidden",
                )}
                style={{ top: HEADER_H }}
              >
                {pieces.map(({ seg, from, to, left, right, clipStart, clipEnd }) => (
                  <div
                    key={`${seg.event.id}:${from}`}
                    className="pointer-events-auto absolute px-[3px]"
                    style={{
                      left: `calc(${(from / 7) * 100}% + ${clipStart}px)`,
                      width: `calc(${((to - from) / 7) * 100}% - ${clipStart + clipEnd}px)`,
                      top: seg.lane * LANE_H,
                      opacity: drag?.id === seg.event.id ? 0.45 : 1,
                    }}
                  >
                    <EventPill
                      event={seg.event}
                      banner={to - from > 1 || seg.event.allDay}
                      continuesLeft={left}
                      continuesRight={right}
                      selected={handlers.selectedId === seg.event.id}
                      onDragStart={(e) => startDrag(e, seg.event)}
                      onOpen={(e) => {
                        e.stopPropagation();
                        if (justDragged.current || seg.event.masked) return;
                        handlers.onOpenEvent(seg.event);
                      }}
                      onMenu={(e) => handlers.onEventMenu(e, seg.event)}
                      onFiles={(files) =>
                        handlers.onDropFilesOnEvent(files, seg.event)
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A month cell on a phone is about 50px across — too narrow for a title, wide
 * enough for a dot per event in the calendar's own colour. Four or more and it
 * says how many, because five identical dots tell you nothing a number does
 * not. The whole cell already opens the day, where the titles live.
 */
/**
 * The corner of the day box: a list was written here, or something was noted
 * about the day itself. Quiet marks — the day's own business, not an
 * appointment — and each one opens the paper it belongs to.
 */
function DayMarks({
  mark,
}: {
  mark: { notes: number; board: string; shopping: boolean } | undefined;
}) {
  if (!mark || (!mark.shopping && !mark.notes)) return null;

  const open = (e: React.MouseEvent, board: string) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("cc:open-notes", { detail: board }));
  };

  return (
    <span className="absolute top-1 right-1 z-10 flex items-center gap-1">
      {mark.shopping && (
        <button
          type="button"
          title="There is a shopping list for this day"
          onClick={(e) => open(e, "cc-shopping")}
          className="text-ink-faint transition hover:text-brand"
        >
          <ShoppingCart size={12} />
        </button>
      )}
      {mark.notes > 0 && (
        <button
          type="button"
          title={`${mark.notes} note${mark.notes === 1 ? "" : "s"} about this day`}
          onClick={(e) => open(e, mark.board)}
          className="text-ink-faint transition hover:text-brand"
        >
          <StickyNote size={12} />
        </button>
      )}
    </span>
  );
}

function MonthDots({ events, day }: { events: CalendarEvent[]; day: Date }) {
  const { calendarById } = useStore();
  const onDay = events.filter((e) => occursOn(e, day));
  if (!onDay.length) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-[3px] px-1">
      {onDay.slice(0, 3).map((event) => (
        <span
          key={event.id}
          style={colorVar(event.color ?? calendarById(event.calendarId)?.color ?? "slate")}
          className={clsx(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            event.masked ? "bg-ink-faint/50" : "cc-dot",
          )}
        />
      ))}
      {onDay.length > 3 && (
        <span className="text-[11px] leading-none font-semibold text-ink-muted">
          {onDay.length}
        </span>
      )}
    </div>
  );
}
