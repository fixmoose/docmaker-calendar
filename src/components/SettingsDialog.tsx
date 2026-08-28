"use client";

import clsx from "clsx";
import { Clock, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/lib/media";
import { useSettings, type Settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import type { CalendarView } from "@/lib/types";
import { AutoShareField } from "./AutoShareField";
import { ExternalCalendars } from "./ExternalCalendars";
import { InstallHint } from "./InstallHint";
import { TOUR_SEEN_KEY } from "./PhoneTour";
import { PushToggle } from "./PushToggle";
import { Button, Field, Modal } from "./ui";

function Choice<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: typeof Sun }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition",
              option.value === value
                ? "border-brand/50 bg-brand-soft font-medium text-brand"
                : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {Icon && <Icon size={14} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Per-device preferences: how the calendar looks and reads. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const store = useStore();
  const sharedBusy = store.me.sharedBusy ?? true;
  const now = new Date();
  const sample = settings.hour12
    ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={settings.reset}>
            <RotateCcw size={15} /> Reset
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Appearance">
          <Choice<Settings["theme"]>
            value={settings.theme}
            onChange={(v) => settings.set("theme", v)}
            options={[
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "Match my device", icon: Monitor },
            ]}
          />
        </Field>

        <Field label="Clock">
          <Choice<boolean>
            value={settings.hour12}
            onChange={(v) => settings.set("hour12", v)}
            options={[
              { value: false, label: "24-hour" },
              { value: true, label: "12-hour (am/pm)" },
            ]}
          />
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Clock size={12} /> Times will read like {sample}
          </p>
        </Field>

        <Field label="Week starts on">
          <Choice<Settings["weekStartsOn"]>
            value={settings.weekStartsOn}
            onChange={(v) => settings.set("weekStartsOn", v)}
            options={[
              { value: 1, label: "Monday" },
              { value: 0, label: "Sunday" },
            ]}
          />
        </Field>

        <Field label="Open the calendar on">
          <Choice<CalendarView>
            value={settings.defaultView}
            onChange={(v) => settings.set("defaultView", v)}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "agenda", label: "Agenda" },
            ]}
          />
        </Field>

        <Field label="Weekends">
          <Choice<boolean>
            value={settings.highlightWeekends}
            onChange={(v) => settings.set("highlightWeekends", v)}
            options={[
              { value: true, label: "Shade them" },
              { value: false, label: "Same as weekdays" },
            ]}
          />
        </Field>

        <Field label="Always share what I create with">
          <AutoShareField />
        </Field>

        <Field label="When somebody shares an event with me, everyone else sees">
          <Choice<boolean>
            value={sharedBusy}
            onChange={(v) => store.setSharedBusy(v)}
            options={[
              { value: true, label: "That I am busy" },
              { value: false, label: "Nothing at all" },
            ]}
          />
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
            {sharedBusy
              ? "People in your groups get a grey block at that hour — never the title, the place, or who it is with. It stops them booking you for something else."
              : "Nobody sees that the hour is taken, so your groups may arrange something over the top of it."}
          </p>
          {/*
           * People kept asking for a third option here — let them see the
           * whole thing — which is the one choice that is not the viewer's to
           * make. The details belong to whoever created the event.
           */}
          <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
            There is no option to show them the event itself: it is not yours to
            pass on. Anybody actually on the event already sees it in full, and
            for your <em>own</em> events the same choice — details, busy, or
            nothing — sits on each calendar, under Privacy.
          </p>
        </Field>

        <Field label="Notifications on this device">
          <PushToggle />
        </Field>

        <Field label="Other calendars">
          <ExternalCalendars />
        </Field>

        <Field label="On your phone">
          <InstallHint />
          <ReplayTour />
        </Field>

        <p className="text-[12px] leading-relaxed text-ink-faint">
          These are kept on this device, so your phone and laptop can differ.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Runs the phone walkthrough again. Only offered on a phone, since that is the
 * only place it appears — forgetting the flag on a laptop would do nothing
 * visible and read as a broken button.
 */
function ReplayTour() {
  const isMobile = useIsMobile();
  const [replayed, setReplayed] = useState(false);
  if (!isMobile) return null;

  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.removeItem(TOUR_SEEN_KEY);
        } catch {
          /* nothing to forget */
        }
        setReplayed(true);
      }}
      className="mt-2 text-[13px] font-medium text-brand hover:underline"
    >
      {replayed ? "Close settings to see it" : "Show me around again"}
    </button>
  );
}
