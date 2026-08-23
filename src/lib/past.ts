"use client";

import { useEffect, useState } from "react";
import type { CalendarEvent } from "./types";

/**
 * How something that has already happened should look.
 *
 * Not "done": an appointment that took place needs no tick, because nothing
 * was ever owed. It should simply stop competing for attention with the things
 * still ahead of you — so past events keep their colour and their upright
 * text, and lose some of their contrast. Nothing new is introduced.
 *
 * Grey and italic are deliberately not used. Both already mean somebody else's
 * private time, everywhere in the calendar, and a second meaning for the same
 * signal makes both of them useless.
 *
 * The exception is the one that matters: a list with things still unticked is
 * not finished just because its date has gone by. Fading those would hide
 * exactly what still needs doing, so they stay at full strength and say so.
 */

export function isPast(event: CalendarEvent, now: Date = new Date()) {
  return new Date(event.end).getTime() < now.getTime();
}

/** A list that outlived its event with things still on it. */
export function hasUnfinishedList(event: CalendarEvent) {
  return Boolean(event.items?.length) && event.items!.some((item) => !item.done);
}

/** True when this should recede. */
export function isSpent(event: CalendarEvent, now: Date = new Date()) {
  return isPast(event, now) && !hasUnfinishedList(event);
}

/** How many things are still outstanding on an overdue list. */
export function outstanding(event: CalendarEvent) {
  return event.items?.filter((item) => !item.done).length ?? 0;
}

/**
 * The clock, at a minute's resolution. Reading the time during render is not
 * allowed — the same render would produce different output twice — so it is
 * held in state and moved on by a timer, which is also what makes an event
 * fade the moment it finishes rather than at the next reload.
 */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Whether this event should recede, kept current as the clock moves. */
export function useIsSpent(event: CalendarEvent) {
  return isSpent(event, useNow());
}
