"use client";

import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  formatISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Copy,
  CalendarOff,
  CopyPlus,
  Plus,
  Eye,
  EyeOff,
  Lock,
  Palette,
  Pencil,
  Share2,
  SquarePen,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { colorVar, COLOR_KEYS, COLORS } from "@/lib/colors";
import { weekDays } from "@/lib/date";
import { uploadAttachment } from "@/lib/db";
import { MAX_FILE_BYTES, formatBytes, titleFromFileName } from "@/lib/files";
import { useIsMobile } from "@/lib/media";
import { useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import {
  DEFAULT_REMINDERS,
  type Calendar,
  type CalendarEvent,
  type CalendarView,
  type EventDraft,
  type Group,
} from "@/lib/types";
import { AgendaView } from "./AgendaView";
import { CalendarDialog } from "./CalendarDialog";
import { ContextMenu, type MenuItem, type MenuState } from "./ContextMenu";
import { DayPanel } from "./DayPanel";
import { EventDialog } from "./EventDialog";
import { FocusBar } from "./FocusBar";
import { GroupDialog } from "./GroupDialog";
import { InviteDialog } from "./InviteDialog";
import { NotesPanel } from "./NotesView";
import { NotificationPopout } from "./NotificationPopout";
import { PersonPanel } from "./PersonPanel";
import { ReminderWatcher } from "./ReminderWatcher";
import { SettingsDialog } from "./SettingsDialog";
import { TrashDialog } from "./TrashDialog";
import { SubscribeDialog } from "./SubscribeDialog";
import { MonthView } from "./MonthView";
import { Sidebar } from "./Sidebar";
import { TimeGridView } from "./TimeGridView";
import { BusyDialog } from "./BusyDialog";
import { PhoneTour, TOUR_SEEN_KEY } from "./PhoneTour";
import { TopBar } from "./TopBar";
import { Avatar, Toast, UndoBar } from "./ui";
import type { ViewHandlers } from "./view-types";

type Dialog =
  | { kind: "event"; draft: EventDraft; event?: CalendarEvent }
  | { kind: "calendar"; calendar?: Calendar; groupId?: string }
  | { kind: "group"; group?: Group }
  | null;

const VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];

/** The view and date live in the URL, so a reload (or a shared link) lands you back. */
function readUrl(): { view: CalendarView | null; date: Date } {
  if (typeof window === "undefined") return { view: null, date: new Date() };
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") as CalendarView | null;
  const raw = params.get("date");
  const parsed = raw ? new Date(`${raw}T00:00:00`) : null;
  return {
    view: view && VIEWS.includes(view) ? view : null,
    date: parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(),
  };
}

export function CalendarApp() {
  const store = useStore();
  const [date, setDate] = useState(() => readUrl().date);
  const settings = useSettings();
  const [view, setView] = useState<CalendarView>(
    () => readUrl().view ?? settings.defaultView,
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  /** Whether we have been anywhere else, so Back can be offered honestly. */
  const [canGoBack, setCanGoBack] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  /** Looking at one group's world, or one calendar, rather than everything. */
  const [focus, setFocus] = useState<
    { kind: "group" | "calendar"; id: string } | null
  >(null);
  const isMobile = useIsMobile();

  /*
   * The walkthrough, first time on a phone only. Read lazily rather than in an
   * effect so it is decided before the first paint, and never on the server.
   */
  /**
   * Where a phone has been panned to. Only the title reads it: moving the date
   * itself would rebuild the strip under the finger doing the moving.
   *
   * Stamped with the date it was panned from, so arriving somewhere new by any
   * other route drops it without an effect having to notice.
   */
  const [busy, setBusy] = useState<CalendarEvent | null>(null);
  const [panned, setPanned] = useState<{ from: number; day: Date } | null>(null);
  const shownDate = panned?.from === date.getTime() ? panned.day : date;

  const [tourDone, setTourDone] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(TOUR_SEEN_KEY) === "1";
    } catch {
      return true;
    }
  });
  const tourOpen = isMobile && !tourDone;
  /** The slot a plain left click picked — what "New event" then uses. */
  const [slot, setSlot] = useState<{ start: string; end: string; allDay: boolean } | null>(
    null,
  );

  const events = useMemo(() => {
    // Focusing a group is a calendar within the calendar: same views, only
    // what that group is involved in.
    const base = !focus
      ? store.visibleEvents
      : focus.kind === "group"
        ? store.eventsInGroup(focus.id).filter((e) => store.visibleEvents.includes(e))
        : store.visibleEvents.filter((e) => e.calendarId === focus.id);

    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((e) =>
      [e.title, e.location, e.notes].some((field) =>
        field?.toLowerCase().includes(q),
      ),
    );
  }, [store, focus, query]);

  const defaultCalendarId =
    store.myCalendars.find((c) => c.visible)?.id ??
    store.myCalendars[0]?.id ??
    store.sharedCalendars[0]?.id ??
    "";

  const openEventDialog = useCallback(
    (start: Date, end: Date, allDay: boolean) =>
      setDialog({
        kind: "event",
        draft: {
          calendarId: defaultCalendarId,
          title: "",
          notes: "",
          location: "",
          start,
          end,
          allDay,
          // Whoever you always share with is already in the field, visible and
          // removable — a default you can see beats one that happens to you.
          sharedWith: [...store.autoShare],
          inviteEmails: [],
          reminders: [...DEFAULT_REMINDERS],
        },
      }),
    [defaultCalendarId, store.autoShare],
  );

  const editEvent = useCallback((event: CalendarEvent) => {
    /*
     * A busy block holds no details, but it does hold a person and a time,
     * which is enough to ask about. Opening nothing at all was the calendar
     * refusing to acknowledge something plainly on the screen.
     */
    if (event.masked) {
      setBusy(event);
      return;
    }
    setSelectedId(event.id);
    const series = event.seriesId ? store.eventById(event.seriesId) : undefined;
    setDialog({
      kind: "event",
      event,
      draft: {
        id: series?.id ?? event.id,
        rrule: event.rrule,
        calendarId: event.calendarId,
        title: event.title,
        notes: event.notes ?? "",
        location: event.location ?? "",
        start: new Date(series?.start ?? event.start),
        end: new Date(series?.end ?? event.end),
        allDay: event.allDay,
        sharedWith: event.sharedWith,
        inviteEmails: [],
        privacy: event.privacy,
        importance: event.importance,
        reminders: (event.reminders ?? []).map((r) => ({
          minutesBefore: r.minutesBefore,
          channel: r.channel,
          forEveryone: !r.userId,
        })),
      },
    });
  }, [store]);

  /** People I share a group with — the audience for per-event sharing. */
  const contacts = useMemo(() => {
    const ids = new Set(
      store.groups
        .filter((g) => g.memberIds.includes(store.currentUserId))
        .flatMap((g) => g.memberIds),
    );
    ids.delete(store.currentUserId);
    return [...ids].map((id) => store.personById(id)).filter((p) => p !== undefined);
  }, [store]);

  /**
   * A shared event lives on the other person's calendar, so it never makes you
   * look busy to your own groups and you cannot edit it. This puts your own
   * copy beside it, which does both.
   */
  const copyToMyCalendar = useCallback(
    (event: CalendarEvent) => {
      const target = store.myCalendars.find((c) => c.visible) ?? store.myCalendars[0];
      if (!target) return;
      store.createEvent({
        calendarId: target.id,
        title: event.title,
        notes: event.notes ?? "",
        location: event.location ?? "",
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay,
        sharedWith: [],
        inviteEmails: [],
        reminders: [...DEFAULT_REMINDERS],
      });
      setNotice(`Your own copy of “${event.title}” is on your calendar — yours to edit.`);
    },
    [store],
  );

  const eventMenu = useCallback(
    (e: React.MouseEvent, event: CalendarEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(event.id);

      // A busy block carries no details, so there is nothing to act on.
      if (event.masked) {
        const owner = store.personById(event.createdBy);
        setMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { kind: "heading", label: `${owner?.name ?? "Someone"} is busy` },
            {
              label: "Details are private",
              icon: <EyeOff size={13} />,
              disabled: true,
              onSelect: () => {},
            },
            { kind: "separator" },
            {
              label: "Hide their busy times",
              icon: <EyeOff size={13} />,
              onSelect: () => store.togglePersonBusy(event.createdBy),
            },
          ],
        });
        return;
      }

      const editable = store.canEditEvent(event);
      const items: MenuItem[] = [
        {
          label: editable ? "Open" : "Open (read only)",
          icon: <SquarePen size={13} />,
          onSelect: () => editEvent(event),
        },
        {
          label: "Duplicate",
          icon: <Copy size={13} />,
          onSelect: () => store.duplicateEvent(event.id),
        },
        ...(editable
          ? []
          : [
              {
                label: "Make my own editable copy",
                icon: <CopyPlus size={13} />,
                onSelect: () => copyToMyCalendar(event),
              } as MenuItem,
            ]),
        { kind: "separator" },
        { kind: "heading", label: "Share" },
        {
          kind: "submenu",
          label: "Add to their calendar",
          icon: <Share2 size={13} />,
          items:
            contacts.length > 0
              ? contacts.map((person) => ({
                  label: person.name,
                  checked: event.sharedWith.includes(person.id),
                  disabled: !editable,
                  icon: <Avatar person={person} size={16} />,
                  onSelect: () => store.toggleEventShare(event.id, person.id),
                }))
              : [
                  {
                    label: "No one to share with yet",
                    disabled: true,
                    onSelect: () => {},
                  },
                ],
        },
        {
          label:
            event.importance === "urgent" ? "Remove urgent flag" : "Mark as urgent",
          icon: <AlertTriangle size={13} />,
          checked: event.importance === "urgent",
          disabled: !editable,
          onSelect: () =>
            store.setEventImportance(
              event.id,
              event.importance === "urgent" ? "normal" : "urgent",
            ),
        },
        {
          kind: "submenu",
          label: "Who else can see it",
          icon: <Eye size={13} />,
          items: [
            {
              label: "Calendar default",
              checked: !event.privacy,
              disabled: !editable,
              onSelect: () => store.setEventPrivacy(event.id, undefined),
            },
            { kind: "separator" },
            {
              label: "Show details",
              icon: <Eye size={13} />,
              checked: event.privacy === "details",
              disabled: !editable,
              onSelect: () => store.setEventPrivacy(event.id, "details"),
            },
            {
              label: "Busy only",
              icon: <EyeOff size={13} />,
              checked: event.privacy === "busy",
              disabled: !editable,
              onSelect: () => store.setEventPrivacy(event.id, "busy"),
            },
            {
              label: "Hidden",
              icon: <Lock size={13} />,
              checked: event.privacy === "hidden",
              disabled: !editable,
              onSelect: () => store.setEventPrivacy(event.id, "hidden"),
            },
          ],
        },
        {
          kind: "submenu",
          label: "Move to calendar",
          icon: <CalendarDays size={13} />,
          items: [...store.myCalendars, ...store.sharedCalendars].map((c) => ({
            label: c.name,
            checked: c.id === event.calendarId,
            disabled: !editable,
            icon: (
              <span style={colorVar(c.color)} className="cc-dot h-2.5 w-2.5 rounded-full" />
            ),
            onSelect: () => store.moveEventToCalendar(event.id, c.id),
          })),
        },
        {
          kind: "submenu",
          label: "Colour",
          icon: <Palette size={13} />,
          items: [
            {
              label: "Calendar colour",
              checked: !event.color,
              onSelect: () => store.setEventColor(event.id, undefined),
            },
            { kind: "separator" },
            ...COLOR_KEYS.map((key) => ({
              label: COLORS[key].label,
              checked: event.color === key,
              disabled: !editable,
              icon: (
                <span style={colorVar(key)} className="cc-dot h-2.5 w-2.5 rounded-full" />
              ),
              onSelect: () => store.setEventColor(event.id, key),
            })),
          ],
        },
        { kind: "separator" },
        ...(event.seriesId
          ? [
              {
                label: "Skip just this one",
                icon: <CalendarOff size={13} />,
                disabled: !editable,
                onSelect: () => store.deleteEvent(event.id, "one"),
              },
              {
                label: "Delete every one of these",
                icon: <Trash2 size={13} />,
                danger: true,
                disabled: !editable,
                onSelect: () => store.deleteEvent(event.id, "all"),
              },
            ]
          : [
              {
                label: "Delete",
                icon: <Trash2 size={13} />,
                danger: true,
                disabled: !editable,
                onSelect: () => store.deleteEvent(event.id),
              },
            ]),
      ];

      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [contacts, copyToMyCalendar, editEvent, store],
  );

  const slotMenu = useCallback(
    (e: React.MouseEvent, at: Date, allDay: boolean) => {
      e.preventDefault();
      /*
       * The menu names no hour. It read "New event at 12 AM" over a month
       * cell, which is not an offer anybody wants and reads as a mistake —
       * the day was picked, not midnight. The editor asks for the time, and
       * that is where it belongs.
       *
       * Where a day was picked rather than a time — a month cell, or the
       * all-day strip — a timed event starts at 9am, as one made from the
       * button does.
       */
      const start = allDay ? addHours(startOfDay(at), 9) : at;
      const items: MenuItem[] = [
        {
          label: "New event",
          icon: <CalendarPlus size={13} />,
          onSelect: () => openEventDialog(start, addHours(start, 1), false),
        },
        {
          label: "New all-day event",
          icon: <CalendarDays size={13} />,
          onSelect: () => openEventDialog(startOfDay(at), startOfDay(at), true),
        },
        { kind: "separator" },
        {
          label: "Go to this day",
          icon: <CalendarDays size={13} />,
          onSelect: () => {
            setDate(at);
            setView("day");
          },
        },
        {
          label: "New calendar…",
          icon: <Pencil size={13} />,
          onSelect: () => setDialog({ kind: "calendar" }),
        },
        {
          label: "New group…",
          icon: <Users size={13} />,
          onSelect: () => setDialog({ kind: "group" }),
        },
      ];
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [openEventDialog],
  );

  /** Uploads to Storage, reporting anything too large or rejected. */
  const upload = useCallback(
    async (files: File[]) => {
      const stored = [];
      const failed: string[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          failed.push(`${file.name} (over ${formatBytes(MAX_FILE_BYTES)})`);
          continue;
        }
        try {
          stored.push(await uploadAttachment(store.supabase, file, store.currentUserId));
        } catch {
          failed.push(file.name);
        }
      }
      return { stored, failed };
    },
    [store.supabase, store.currentUserId],
  );

  /**
   * Drop a file on a time slot: store it, then open the editor pre-filled with
   * that slot and the file attached, so times, notes and sharing get set in one
   * pass rather than a second trip through the UI.
   */
  const dropFiles = useCallback(
    async (files: File[], start: Date, end: Date, allDay: boolean) => {
      setUploading(files.length);
      const { stored, failed } = await upload(files);
      setUploading(0);
      if (failed.length) setNotice(`Could not attach: ${failed.join(", ")}`);
      if (!stored.length) return;

      setDialog({
        kind: "event",
        draft: {
          calendarId: defaultCalendarId,
          title: titleFromFileName(stored[0].name),
          notes: "",
          location: "",
          start,
          end,
          allDay,
          sharedWith: [...store.autoShare],
          inviteEmails: [],
          attachments: stored,
          reminders: [...DEFAULT_REMINDERS],
        },
      });
    },
    [defaultCalendarId, store.autoShare, upload],
  );

  const dropFilesOnEvent = useCallback(
    async (files: File[], event: CalendarEvent) => {
      if (event.masked || !store.canEditEvent(event)) {
        setNotice("You can only attach files to events you can edit.");
        return;
      }
      setUploading(files.length);
      const { stored, failed } = await upload(files);
      setUploading(0);
      if (failed.length) setNotice(`Could not attach: ${failed.join(", ")}`);
      if (stored.length) {
        store.attachToEvent(event.id, stored);
        setNotice(
          `${stored.length} file${stored.length === 1 ? "" : "s"} added to “${event.title}”`,
        );
      }
    },
    [store, upload],
  );

  const handlers: ViewHandlers = useMemo(
    () => ({
      selectedId,
      selectedSlot: slot,
      onSelectSlot: (start, end, allDay) => {
        setSelectedId(null);
        setSlot({ start: start.toISOString(), end: end.toISOString(), allDay });
      },
      onDropFiles: dropFiles,
      onDropFilesOnEvent: dropFilesOnEvent,
      onOpenEvent: editEvent,
      onEventMenu: eventMenu,
      onCreate: openEventDialog,
      onSlotMenu: slotMenu,
      onNavigate: (next, nextView) => {
        setDate(next);
        setView(nextView);
      },
    }),
    [
      dropFiles,
      dropFilesOnEvent,
      editEvent,
      eventMenu,
      openEventDialog,
      selectedId,
      slot,
      slotMenu,
    ],
  );

  /** New event on the picked slot, or at 9am on the day in view. */
  const newEventHere = useCallback(() => {
    if (slot) {
      openEventDialog(new Date(slot.start), new Date(slot.end), slot.allDay);
      return;
    }
    const start = new Date(date);
    start.setHours(9, 0, 0, 0);
    openEventDialog(start, addHours(start, 1), false);
  }, [date, openEventDialog, slot]);

  useEffect(() => {
    const from = new Date(date);
    from.setMonth(from.getMonth() - 2, 1);
    const to = new Date(date);
    to.setMonth(to.getMonth() + 4, 1);
    store.ensureRange(from, to);
  }, [date, store]);

  const step = useCallback(
    (direction: 1 | -1) =>
      setDate((current) => {
        if (view === "month") return addMonths(startOfMonth(current), direction);
        if (view === "week")
          return isMobile ? addDays(current, direction * 3) : addWeeks(current, direction);
        if (view === "day") return addDays(current, direction);
        return addDays(current, direction * 7);
      }),
    [view, isMobile],
  );

  /**
   * Every move writes a history entry, so the browser's Back button — and the
   * one in the top bar — return you to where you were looking. Rapid moves
   * (holding the arrow) collapse into one entry rather than filling history.
   */
  const lastNavigation = useRef(0);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    params.set("date", formatISO(date, { representation: "date" }));
    const url = `?${params.toString()}`;
    if (url === `?${new URLSearchParams(window.location.search).toString()}`) return;

    const now = Date.now();
    const rapid = now - lastNavigation.current < 700;
    lastNavigation.current = now;
    window.history[rapid ? "replaceState" : "pushState"](null, "", url);
    if (!rapid) queueMicrotask(() => setCanGoBack(true));
  }, [view, date]);

  /**
   * Arriving from a notification: ?event=<id> opens it once the calendar has
   * loaded, then the parameter is dropped so a refresh does not reopen it.
   */
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || !store.ready) return;
    const wanted = new URLSearchParams(window.location.search).get("event");
    if (!wanted) return;

    const event = store.visibleEvents.find((e) => e.id === wanted);
    if (!event) return;

    openedFromLink.current = true;
    queueMicrotask(() => {
      setDate(new Date(event.start));
      editEvent(event);
    });

    const params = new URLSearchParams(window.location.search);
    params.delete("event");
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [store.ready, store.visibleEvents, editEvent]);

  // A reminder card asking to open its event.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const event = store.visibleEvents.find((x) => x.id === id);
      if (!event) return;
      setDate(new Date(event.start));
      editEvent(event);
    };
    window.addEventListener("cc:open-event", onOpen);
    return () => window.removeEventListener("cc:open-event", onOpen);
  }, [store.visibleEvents, editEvent]);

  // Following the browser's own back and forward.
  useEffect(() => {
    const onPop = () => {
      const next = readUrl();
      if (next.view) setView(next.view);
      setDate(next.date);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keyboard shortcuts, Google-Calendar style.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Cmd/Ctrl+Z is undo; other modified keys are the browser's business.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (!dialog && store.undoStack.length) {
          e.preventDefault();
          store.undoLast();
        }
        return;
      }
      if (
        dialog ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        target?.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "t") setDate(new Date());
      else if (key === "d" || key === "1") setView("day");
      else if (key === "w" || key === "2") setView("week");
      else if (key === "m" || key === "3") setView("month");
      else if (key === "a" || key === "4") setView("agenda");
      else if (key === "5") setNotesOpen((v) => !v);
      else if (key === "n" || key === "c") newEventHere();
      else if (key === "arrowleft" || key === "k") step(-1);
      else if (key === "arrowright" || key === "j") step(1);
      else if (key === "z" && store.undoStack.length) store.undoLast();
      else if (key === "escape") {
        setSelectedId(null);
        setSlot(null);
      }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, newEventHere, setDate, step, store]);

  if (!store.ready) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-[13px] text-ink-faint">
        Loading your calendar…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-bg">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        selected={date}
        onSelectDate={(d) => {
          setDate(d);
          setMenuOpen(false);
        }}
        onNewEvent={() => newEventHere()}
        onNewCalendar={(groupId) => setDialog({ kind: "calendar", groupId })}
        onEditCalendar={(calendar) => setDialog({ kind: "calendar", calendar })}
        onNewGroup={() => setDialog({ kind: "group" })}
        onEditGroup={(group) => setDialog({ kind: "group", group })}
        focus={focus}
        onFocus={(next) => {
          setFocus((current) =>
            current && next && current.kind === next.kind && current.id === next.id
              ? null
              : next,
          );
          setMenuOpen(false);
        }}
        onInvite={() => setInviting(true)}
        onSubscribe={() => setSubscribing(true)}
        onOpenPerson={setPerson}
        openMenu={setMenu}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {focus && (
          <FocusBar focus={focus} count={events.length} onClear={() => setFocus(null)} />
        )}

        <TopBar
          date={shownDate}
          view={view}
          query={query}
          onQuery={setQuery}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => setDate(new Date())}
          onView={setView}
          onOpenEvent={(event) => {
            setDate(new Date(event.start));
            editEvent(event);
          }}
          onMenu={() => setMenuOpen((v) => !v)}
          notesOpen={notesOpen}
          onNotes={() => setNotesOpen((v) => !v)}
          onSettings={() => setSettingsOpen(true)}
          onTrash={() => setTrashOpen(true)}
          canGoBack={canGoBack}
          onBack={() => window.history.back()}
        />

        {view === "month" && (
          <MonthView date={date} events={events} handlers={handlers} />
        )}
        {view === "week" && (
          <TimeGridView
            /*
             * Seven columns on a phone leaves about 45px each — every title
             * truncates to a letter and an ellipsis. Three are shown at a
             * time; the strip carries three weeks of them so the days can be
             * panned through rather than paged.
             */
            days={
              isMobile
                ? Array.from({ length: 21 }, (_, i) => addDays(date, i - 3))
                : weekDays(date)
            }
            anchorDay={date}
            onVisibleDayChange={(day) => setPanned({ from: date.getTime(), day })}
            events={events}
            handlers={handlers}
          />
        )}
        {view === "day" &&
          (isMobile ? (
            // Today's list first: on a phone that is the whole question.
            <div className="flex min-h-0 flex-1 flex-col">
              <DayPanel date={date} events={events} handlers={handlers} mobile />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <TimeGridView days={[date]} events={events} handlers={handlers} />
              <DayPanel date={date} events={events} handlers={handlers} />
            </div>
          ))}
        {view === "agenda" && (
          <AgendaView date={date} events={events} handlers={handlers} />
        )}

        {/*
         * A phone has no right-click, which is how everything gets created on
         * a desktop. Without this there is no way to add an event at all once
         * the day has something in it.
         */}
        {isMobile && (
          <button
            type="button"
            onClick={newEventHere}
            aria-label="New event"
            data-tour="create"
            className="fixed right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-[var(--shadow-lg)] transition active:scale-95"
            style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <Plus size={26} />
          </button>
        )}
      </main>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}

      {person && (
        <PersonPanel
          personId={person}
          onClose={() => setPerson(null)}
          onOpenEvent={(event) => {
            setPerson(null);
            setDate(new Date(event.start));
            editEvent(event);
          }}
        />
      )}

      <NotesPanel open={notesOpen} onClose={() => setNotesOpen(false)} />

      {tourOpen && (
        <PhoneTour
          onDone={() => {
            setTourDone(true);
            try {
              localStorage.setItem(TOUR_SEEN_KEY, "1");
            } catch {
              /* private browsing: the tour simply runs again */
            }
          }}
        />
      )}

      {busy && <BusyDialog event={busy} onClose={() => setBusy(null)} />}

      <ReminderWatcher />

      <NotificationPopout
        onOpenEvent={(event) => {
          setDate(new Date(event.start));
          editEvent(event);
        }}
      />

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}

      {subscribing && <SubscribeDialog onClose={() => setSubscribing(false)} />}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onAddSubscription={() => {
            setSettingsOpen(false);
            setSubscribing(true);
          }}
        />
      )}

      {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} />}

      {store.undoStack.length > 0 && !store.error && (
        <UndoBar
          label={store.undoStack[0].label}
          onUndo={store.undoLast}
          key={store.undoStack[0].id}
        />
      )}

      <Toast
        message={
          uploading > 0
            ? `Uploading ${uploading} file${uploading === 1 ? "" : "s"}…`
            : (store.error ?? notice)
        }
        busy={uploading > 0}
        sticky={Boolean(store.error)}
        onDismiss={() => {
          setNotice(null);
          store.clearError();
        }}
      />

      {dialog?.kind === "event" && (
        <EventDialog
          draft={dialog.draft}
          event={dialog.event}
          onClose={() => setDialog(null)}
          onSaved={(start) => {
            // Land on the week the event is in, so it is visible rather than
            // saved somewhere you are not looking.
            setDate(start);
            setSlot(null);
          }}
        />
      )}
      {dialog?.kind === "calendar" && (
        <CalendarDialog
          calendar={dialog.calendar}
          defaultGroupId={dialog.groupId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "group" && (
        <GroupDialog group={dialog.group} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
