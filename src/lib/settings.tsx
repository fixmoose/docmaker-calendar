"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CalendarView } from "./types";

/**
 * Per-device preferences: how the calendar looks and reads, rather than what
 * is in it. Kept in localStorage, because they belong to the screen you are
 * sitting at, not to the account.
 *
 * The pure date helpers cannot call a hook, so the values are also mirrored
 * into module state that src/lib/date.ts reads — see syncPreferences().
 */

export type ThemeChoice = "light" | "dark" | "system";

export interface Settings {
  theme: ThemeChoice;
  /** 13:00 or 1:00 pm. */
  hour12: boolean;
  /** 1 = Monday, 0 = Sunday. */
  weekStartsOn: 0 | 1;
  defaultView: CalendarView;
  /** Dim Saturday and Sunday in the grid. */
  highlightWeekends: boolean;
  /** Show national holidays alongside what is actually in the calendar. */
  holidays: boolean;
  /**
   * Whose holidays, by country code — at most MAX_HOLIDAY_COUNTRIES of them.
   * A calendar of everybody's national days is a calendar of nothing.
   */
  holidayCountries: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  hour12: false,
  weekStartsOn: 1,
  defaultView: "week",
  highlightWeekends: true,
  holidays: true,
  holidayCountries: ["US"],
};

const KEY = "cc.settings.v1";

/* --- module mirror, for the pure helpers in date.ts ---------------------- */

let current: Settings = DEFAULT_SETTINGS;

export const preferences = () => current;

function syncPreferences(next: Settings) {
  current = next;
}

/* --- theme --------------------------------------------------------------- */

function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try {
    if (choice === "system") window.localStorage.removeItem("cc.theme");
    else window.localStorage.setItem("cc.theme", choice);
  } catch {
    /* private mode */
  }
}

/* --- context ------------------------------------------------------------- */

interface SettingsValue extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function read(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    const theme = (window.localStorage.getItem("cc.theme") as ThemeChoice) ?? "system";
    return { ...DEFAULT_SETTINGS, theme, ...stored };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Read on the first client render rather than in an effect: the stored
  // values must be in place before the calendar formats a single time.
  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    const stored = read();
    syncPreferences(stored);
    return stored;
  });

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((previous) => {
      const next = { ...previous, [key]: value };
      syncPreferences(next);
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      if (key === "theme") applyTheme(value as ThemeChoice);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    syncPreferences(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* private mode */
    }
    applyTheme(DEFAULT_SETTINGS.theme);
  }, []);

  // Follow the system when that is what was chosen.
  useEffect(() => {
    if (settings.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settings.theme]);

  const value = useMemo<SettingsValue>(
    () => ({ ...settings, set, reset }),
    [settings, set, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
