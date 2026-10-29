"use client";

import clsx from "clsx";
import { addDays, format, isToday, isTomorrow, startOfDay } from "date-fns";
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { occursOn } from "@/lib/date";
import { isHoliday } from "@/lib/holidays";
import type { CalendarEvent } from "@/lib/types";
import { IconButton } from "./ui";

/** How far ahead the strip runs: a year is further than anyone plans on a phone. */
const DAYS_AHEAD = 365;

/**
 * The phone's first step to a new event: which day. A strip of days starting
 * today, thrown sideways with a thumb — the browser's own scrolling, so a
 * harder flick carries further — and a tap on a day opens the same form as
 * the desktop, already on that day.
 *
 * Today is first and nothing earlier is offered: on a phone you are adding
 * what is coming, and the form can still move it anywhere.
 */
export function DayPickerSheet({
  events,
  onPick,
  onClose,
}: {
  events: CalendarEvent[];
  onPick: (day: Date) => void;
  onClose: () => void;
}) {
  const days = useMemo(() => {
    const first = startOfDay(new Date());
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(first, i));
  }, []);

  // A dot or two for what is already on a day, so a free one can be seen.
  const counts = useMemo(() => {
    const own = events.filter((e) => !isHoliday(e));
    return days.map((day) => own.filter((e) => occursOn(e, day)).length);
  }, [days, events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="cc-fade fixed inset-0 z-50 flex items-end bg-black/35"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick a day"
        className="cc-pop w-full rounded-t-2xl border-t border-line bg-surface shadow-[var(--shadow-lg)]"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <div>
            <div className="text-[17px] font-semibold text-ink">Which day?</div>
            <div className="text-[13px] text-ink-faint">Swipe for later days</div>
          </div>
          <IconButton onClick={onClose} aria-label="Close" className="-mr-1.5">
            <X size={18} />
          </IconButton>
        </div>

        <div className="cc-scroll flex gap-2 overflow-x-auto overscroll-x-contain px-5 pt-3 pb-2">
          {days.map((day, i) => {
            const today = isToday(day);
            // Where a month begins, it says so — otherwise a fast throw
            // lands somewhere with only a number to go on.
            const month = i === 0 || day.getDate() === 1;
            return (
              <button
                key={day.getTime()}
                type="button"
                onClick={() => onPick(day)}
                className={clsx(
                  "flex w-[64px] shrink-0 flex-col items-center rounded-xl border py-2.5 transition active:scale-95",
                  today
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-surface text-ink active:bg-surface-2",
                )}
              >
                <span
                  className={clsx(
                    "text-[10px] font-semibold tracking-wider uppercase",
                    month ? "text-brand" : "invisible",
                  )}
                >
                  {format(day, "MMM")}
                </span>
                <span className="mt-0.5 text-[12px] font-medium text-ink-muted">
                  {today ? "Today" : isTomorrow(day) ? "Tmrw" : format(day, "EEE")}
                </span>
                <span className="text-[22px] leading-tight font-semibold tabular-nums">
                  {day.getDate()}
                </span>
                <span className="mt-1 flex h-[6px] items-center gap-[3px]">
                  {Array.from({ length: Math.min(3, counts[i]) }, (_, n) => (
                    <span key={n} className="h-[5px] w-[5px] rounded-full bg-ink-faint" />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
