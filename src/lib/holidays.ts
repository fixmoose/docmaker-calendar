import { addDays, endOfDay, startOfDay } from "date-fns";
import type { CalendarEvent } from "./types";

/**
 * National holidays, worked out here rather than fetched.
 *
 * They are the same every year by rule — a date, an nth weekday of a month, or
 * a count from Easter — so a subscription to somebody else's server would be a
 * network call, an account, and a thing to go wrong, in exchange for arithmetic
 * we can do in a millisecond. Nothing is stored either: these are not events on
 * anybody's calendar, they are the days themselves, and they appear only while
 * the setting asks for them.
 *
 * What is listed is the *national* holiday: the days a country keeps as a
 * whole. Regional ones — a state's own Monday, a canton's saint — are not here,
 * because there is no honest way to guess which region somebody means.
 */

/** Nobody wants a calendar of everybody's holidays. */
export const MAX_HOLIDAY_COUNTRIES = 3;

/** The calendar these belong to, which exists nowhere but on screen. */
const HOLIDAY_CALENDAR = "cc-holidays";

/** 0 = Sunday, as Date.getDay() has it. */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type Rule =
  /** The same date every year. */
  | { on: "date"; month: number; day: number; name: string; sundayBack?: true }
  /** The nth weekday of a month; -1 for the last. */
  | { on: "nth"; month: number; weekday: Weekday; nth: 1 | 2 | 3 | 4 | -1; name: string }
  /** The last weekday before a date — Victoria Day and its kind. */
  | { on: "before"; month: number; day: number; weekday: Weekday; name: string }
  /** Days from Easter Sunday, west of the Orthodox world. */
  | { on: "easter"; days: number; name: string }
  /** Days from Orthodox Pascha, which follows the Julian reckoning. */
  | { on: "pascha"; days: number; name: string };

/**
 * What a country does when a fixed date lands on a weekend.
 *
 * "us" moves it to the nearer weekday, Saturday back to Friday and Sunday on to
 * Monday. "uk" gives a substitute day after it, and if that Monday is already
 * spoken for — Christmas and Boxing Day, most years — the next free weekday.
 */
type Observed = "none" | "us" | "uk";

export interface HolidayCountry {
  code: string;
  name: string;
  observed: Observed;
  rules: Rule[];
}

const CHRISTMAS: Rule = { on: "date", month: 12, day: 25, name: "Christmas Day" };
const BOXING: Rule = { on: "date", month: 12, day: 26, name: "Boxing Day" };
const NEW_YEAR: Rule = { on: "date", month: 1, day: 1, name: "New Year's Day" };
const GOOD_FRIDAY: Rule = { on: "easter", days: -2, name: "Good Friday" };
const EASTER_MONDAY: Rule = { on: "easter", days: 1, name: "Easter Monday" };

/**
 * The countries on offer, in the order they are shown.
 *
 * Every one of these keeps its holidays by rule. Countries whose days follow a
 * lunar calendar or an astronomical event — India, Japan, much of the Middle
 * East — are deliberately absent rather than approximated: a holiday on the
 * wrong day is worse than no holiday at all.
 */
export const HOLIDAY_COUNTRIES: HolidayCountry[] = [
  {
    code: "US",
    name: "United States",
    observed: "us",
    rules: [
      NEW_YEAR,
      { on: "nth", month: 1, weekday: 1, nth: 3, name: "Martin Luther King Jr. Day" },
      { on: "nth", month: 2, weekday: 1, nth: 3, name: "Presidents' Day" },
      { on: "nth", month: 5, weekday: 1, nth: -1, name: "Memorial Day" },
      { on: "date", month: 6, day: 19, name: "Juneteenth" },
      { on: "date", month: 7, day: 4, name: "Independence Day" },
      { on: "nth", month: 9, weekday: 1, nth: 1, name: "Labor Day" },
      { on: "nth", month: 10, weekday: 1, nth: 2, name: "Columbus Day" },
      { on: "date", month: 11, day: 11, name: "Veterans Day" },
      { on: "nth", month: 11, weekday: 4, nth: 4, name: "Thanksgiving" },
      CHRISTMAS,
    ],
  },
  {
    code: "CA",
    name: "Canada",
    observed: "none",
    rules: [
      NEW_YEAR,
      GOOD_FRIDAY,
      { on: "before", month: 5, day: 25, weekday: 1, name: "Victoria Day" },
      { on: "date", month: 7, day: 1, name: "Canada Day" },
      { on: "nth", month: 9, weekday: 1, nth: 1, name: "Labour Day" },
      {
        on: "date",
        month: 9,
        day: 30,
        name: "National Day for Truth and Reconciliation",
      },
      { on: "nth", month: 10, weekday: 1, nth: 2, name: "Thanksgiving" },
      { on: "date", month: 11, day: 11, name: "Remembrance Day" },
      CHRISTMAS,
      BOXING,
    ],
  },
  {
    code: "MX",
    name: "Mexico",
    observed: "none",
    rules: [
      NEW_YEAR,
      { on: "nth", month: 2, weekday: 1, nth: 1, name: "Constitution Day" },
      { on: "nth", month: 3, weekday: 1, nth: 3, name: "Benito Juárez's Birthday" },
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "date", month: 9, day: 16, name: "Independence Day" },
      { on: "nth", month: 11, weekday: 1, nth: 3, name: "Revolution Day" },
      CHRISTMAS,
    ],
  },
  {
    code: "BR",
    name: "Brazil",
    observed: "none",
    rules: [
      NEW_YEAR,
      { on: "easter", days: -48, name: "Carnival Monday" },
      { on: "easter", days: -47, name: "Carnival" },
      GOOD_FRIDAY,
      { on: "date", month: 4, day: 21, name: "Tiradentes' Day" },
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "easter", days: 60, name: "Corpus Christi" },
      { on: "date", month: 9, day: 7, name: "Independence Day" },
      { on: "date", month: 10, day: 12, name: "Our Lady of Aparecida" },
      { on: "date", month: 11, day: 2, name: "All Souls' Day" },
      { on: "date", month: 11, day: 15, name: "Republic Day" },
      { on: "date", month: 11, day: 20, name: "Black Consciousness Day" },
      CHRISTMAS,
    ],
  },
  {
    code: "GB",
    name: "United Kingdom",
    observed: "uk",
    rules: [
      NEW_YEAR,
      GOOD_FRIDAY,
      EASTER_MONDAY,
      { on: "nth", month: 5, weekday: 1, nth: 1, name: "Early May Bank Holiday" },
      { on: "nth", month: 5, weekday: 1, nth: -1, name: "Spring Bank Holiday" },
      { on: "nth", month: 8, weekday: 1, nth: -1, name: "Summer Bank Holiday" },
      CHRISTMAS,
      BOXING,
    ],
  },
  {
    code: "IE",
    name: "Ireland",
    observed: "uk",
    rules: [
      NEW_YEAR,
      { on: "nth", month: 2, weekday: 1, nth: 1, name: "St Brigid's Day" },
      { on: "date", month: 3, day: 17, name: "St Patrick's Day" },
      EASTER_MONDAY,
      { on: "nth", month: 5, weekday: 1, nth: 1, name: "May Day" },
      { on: "nth", month: 6, weekday: 1, nth: 1, name: "June Bank Holiday" },
      { on: "nth", month: 8, weekday: 1, nth: 1, name: "August Bank Holiday" },
      { on: "nth", month: 10, weekday: 1, nth: -1, name: "October Bank Holiday" },
      CHRISTMAS,
      { on: "date", month: 12, day: 26, name: "St Stephen's Day" },
    ],
  },
  {
    code: "FR",
    name: "France",
    observed: "none",
    rules: [
      NEW_YEAR,
      EASTER_MONDAY,
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "date", month: 5, day: 8, name: "Victory in Europe Day" },
      { on: "easter", days: 39, name: "Ascension Day" },
      { on: "easter", days: 50, name: "Whit Monday" },
      { on: "date", month: 7, day: 14, name: "Bastille Day" },
      { on: "date", month: 8, day: 15, name: "Assumption of Mary" },
      { on: "date", month: 11, day: 1, name: "All Saints' Day" },
      { on: "date", month: 11, day: 11, name: "Armistice Day" },
      CHRISTMAS,
    ],
  },
  {
    code: "DE",
    name: "Germany",
    observed: "none",
    rules: [
      NEW_YEAR,
      GOOD_FRIDAY,
      EASTER_MONDAY,
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "easter", days: 39, name: "Ascension Day" },
      { on: "easter", days: 50, name: "Whit Monday" },
      { on: "date", month: 10, day: 3, name: "German Unity Day" },
      CHRISTMAS,
      { on: "date", month: 12, day: 26, name: "Second Day of Christmas" },
    ],
  },
  {
    code: "NL",
    name: "Netherlands",
    observed: "none",
    rules: [
      NEW_YEAR,
      GOOD_FRIDAY,
      { on: "easter", days: 0, name: "Easter Sunday" },
      EASTER_MONDAY,
      // Never on a Sunday: the day before it, when it falls there.
      { on: "date", month: 4, day: 27, name: "King's Day", sundayBack: true },
      { on: "date", month: 5, day: 5, name: "Liberation Day" },
      { on: "easter", days: 39, name: "Ascension Day" },
      { on: "easter", days: 49, name: "Whit Sunday" },
      { on: "easter", days: 50, name: "Whit Monday" },
      CHRISTMAS,
      { on: "date", month: 12, day: 26, name: "Second Day of Christmas" },
    ],
  },
  {
    code: "ES",
    name: "Spain",
    observed: "none",
    rules: [
      NEW_YEAR,
      { on: "date", month: 1, day: 6, name: "Epiphany" },
      GOOD_FRIDAY,
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "date", month: 8, day: 15, name: "Assumption of Mary" },
      { on: "date", month: 10, day: 12, name: "National Day" },
      { on: "date", month: 11, day: 1, name: "All Saints' Day" },
      { on: "date", month: 12, day: 6, name: "Constitution Day" },
      { on: "date", month: 12, day: 8, name: "Immaculate Conception" },
      CHRISTMAS,
    ],
  },
  {
    code: "IT",
    name: "Italy",
    observed: "none",
    rules: [
      NEW_YEAR,
      { on: "date", month: 1, day: 6, name: "Epiphany" },
      { on: "easter", days: 0, name: "Easter Sunday" },
      EASTER_MONDAY,
      { on: "date", month: 4, day: 25, name: "Liberation Day" },
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "date", month: 6, day: 2, name: "Republic Day" },
      { on: "date", month: 8, day: 15, name: "Ferragosto" },
      { on: "date", month: 11, day: 1, name: "All Saints' Day" },
      { on: "date", month: 12, day: 8, name: "Immaculate Conception" },
      CHRISTMAS,
      { on: "date", month: 12, day: 26, name: "St Stephen's Day" },
    ],
  },
  {
    code: "PL",
    name: "Poland",
    observed: "none",
    rules: [
      NEW_YEAR,
      { on: "date", month: 1, day: 6, name: "Epiphany" },
      { on: "easter", days: 0, name: "Easter Sunday" },
      EASTER_MONDAY,
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "date", month: 5, day: 3, name: "Constitution Day" },
      { on: "easter", days: 49, name: "Pentecost" },
      { on: "easter", days: 60, name: "Corpus Christi" },
      { on: "date", month: 8, day: 15, name: "Assumption of Mary" },
      { on: "date", month: 11, day: 1, name: "All Saints' Day" },
      { on: "date", month: 11, day: 11, name: "Independence Day" },
      CHRISTMAS,
      { on: "date", month: 12, day: 26, name: "Second Day of Christmas" },
    ],
  },
  {
    code: "RS",
    name: "Serbia",
    observed: "none",
    rules: [
      NEW_YEAR,
      { on: "date", month: 1, day: 2, name: "New Year's Holiday" },
      { on: "date", month: 1, day: 7, name: "Orthodox Christmas" },
      { on: "date", month: 2, day: 15, name: "Statehood Day" },
      { on: "date", month: 2, day: 16, name: "Statehood Day" },
      { on: "pascha", days: -2, name: "Orthodox Good Friday" },
      { on: "pascha", days: 0, name: "Orthodox Easter" },
      { on: "pascha", days: 1, name: "Orthodox Easter Monday" },
      { on: "date", month: 5, day: 1, name: "Labour Day" },
      { on: "date", month: 5, day: 2, name: "Labour Day Holiday" },
      { on: "date", month: 11, day: 11, name: "Armistice Day" },
    ],
  },
  {
    code: "AU",
    name: "Australia",
    observed: "uk",
    rules: [
      NEW_YEAR,
      { on: "date", month: 1, day: 26, name: "Australia Day" },
      GOOD_FRIDAY,
      EASTER_MONDAY,
      { on: "date", month: 4, day: 25, name: "Anzac Day" },
      CHRISTMAS,
      BOXING,
    ],
  },
];

export const countryByCode = (code: string) =>
  HOLIDAY_COUNTRIES.find((c) => c.code === code);

/* --- the arithmetic ------------------------------------------------------ */

/** Easter Sunday, by the Gregorian computus (Meeus/Jones/Butcher). */
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Orthodox Pascha. Reckoned on the Julian calendar and then carried across to
 * ours, which through this century is thirteen days.
 */
function pascha(year: number) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return addDays(new Date(year, month - 1, day), 13);
}

function nthWeekday(year: number, month: number, weekday: Weekday, nth: number) {
  if (nth > 0) {
    const first = new Date(year, month - 1, 1);
    const forward = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month - 1, 1 + forward + (nth - 1) * 7);
  }
  const last = new Date(year, month, 0);
  const back = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month - 1, last.getDate() - back);
}

/** The last such weekday strictly before the given date. */
function weekdayBefore(year: number, month: number, day: number, weekday: Weekday) {
  const target = new Date(year, month - 1, day);
  const back = (target.getDay() - weekday + 7) % 7 || 7;
  return new Date(year, month - 1, day - back);
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Day {
  date: Date;
  name: string;
}

/** Every holiday a country keeps in one year, in order. */
function holidaysIn(country: HolidayCountry, year: number): Day[] {
  const days: Day[] = country.rules.map((rule) => {
    switch (rule.on) {
      case "date": {
        const date = new Date(year, rule.month - 1, rule.day);
        return {
          name: rule.name,
          date: rule.sundayBack && date.getDay() === 0 ? addDays(date, -1) : date,
        };
      }
      case "nth":
        return { name: rule.name, date: nthWeekday(year, rule.month, rule.weekday, rule.nth) };
      case "before":
        return {
          name: rule.name,
          date: weekdayBefore(year, rule.month, rule.day, rule.weekday),
        };
      case "easter":
        return { name: rule.name, date: addDays(easterSunday(year), rule.days) };
      case "pascha":
        return { name: rule.name, date: addDays(pascha(year), rule.days) };
    }
  });

  if (country.observed === "none") return days;

  /*
   * A holiday on a Saturday is a holiday nobody gets, so countries move it.
   * Which way they move it is the whole difference between the two rules here,
   * and the moved day is named as moved: an office shut on the Friday wants to
   * see the Friday, not the Fourth.
   */
  const taken = new Set(days.map((d) => key(d.date)));
  return days.map((day) => {
    if (!isWeekend(day.date)) return day;

    if (country.observed === "us") {
      const moved = addDays(day.date, day.date.getDay() === 6 ? -1 : 1);
      return { name: `${day.name} (observed)`, date: moved };
    }

    let moved = day.date;
    do {
      moved = addDays(moved, 1);
    } while (isWeekend(moved) || taken.has(key(moved)));
    taken.add(key(moved));
    return { name: `${day.name} (substitute day)`, date: moved };
  });
}

/* --- what the calendar shows --------------------------------------------- */

/** Marks the events this file makes, which nothing may edit or delete. */
export const isHoliday = (event: CalendarEvent) =>
  Boolean(event.feedId?.startsWith("holiday:"));

/**
 * The holidays falling between two dates, as events the views can draw.
 *
 * They are given the viewer as their author so that nothing offers to share
 * them or shows them as somebody else's, and a feed id so that nothing offers
 * to edit them: a public holiday is not yours to move.
 */
export function holidayEvents(
  codes: string[],
  from: Date,
  to: Date,
  viewerId: string,
): CalendarEvent[] {
  const countries = codes
    .slice(0, MAX_HOLIDAY_COUNTRIES)
    .map(countryByCode)
    .filter((c): c is HolidayCountry => Boolean(c));
  if (!countries.length) return [];

  const events: CalendarEvent[] = [];
  for (const country of countries) {
    for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
      for (const day of holidaysIn(country, year)) {
        if (day.date < from || day.date > to) continue;
        events.push({
          id: `holiday:${country.code}:${key(day.date)}:${day.name}`,
          calendarId: HOLIDAY_CALENDAR,
          feedId: `holiday:${country.code}`,
          // Whose holiday it is, said only when more than one country is on:
          // two identical "New Year's Day" pills read as a fault.
          title: countries.length > 1 ? `${day.name} (${country.code})` : day.name,
          start: startOfDay(day.date).toISOString(),
          end: endOfDay(day.date).toISOString(),
          allDay: true,
          color: "slate",
          createdBy: viewerId,
          sharedWith: [],
        });
      }
    }
  }
  return events;
}
