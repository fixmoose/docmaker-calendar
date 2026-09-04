"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { canEdit, participantIds } from "./access";
import * as db from "./db";
import { inviteToEvent } from "./invites";
import { usePresence, type Presence } from "./presence";
import { deliverNow } from "./push";
import { expandRepeats, splitOccurrenceId } from "./repeat";
import { publicUrl } from "./site";
import { createClient, ensureSession } from "./supabase/client";
import type {
  Attachment,
  DeletedEvent,
  Calendar,
  CalendarEvent,
  ColorKey,
  EventDraft,
  EventItem,
  Group,
  Importance,
  ListKind,
  Invite,
  JoinRequest,
  Note,
  Person,
  Privacy,
  ReminderDraft,
  ShoppingList,
} from "./types";

/**
 * Single source of truth for the calendar, backed by Supabase.
 *
 * Reads come from `cc_calendar_feed`, which has already masked anything the
 * viewer may only see as busy — the client never receives details it is not
 * entitled to. Writes are optimistic: local state changes immediately so
 * dragging stays smooth, the query runs behind it, and a failure reloads the
 * truth rather than leaving the UI lying about what was saved.
 *
 * Which calendars are ticked and whose busy times are hidden are per-device
 * view preferences, so they live in localStorage rather than the database.
 */

const VIEW_PREFS_KEY = "cc.view.v1";

interface ViewPrefs {
  hiddenCalendars: string[];
  busyHidden: string[];
}

function readPrefs(userId: string): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(`${VIEW_PREFS_KEY}.${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ViewPrefs>;
      return {
        hiddenCalendars: parsed.hiddenCalendars ?? [],
        busyHidden: parsed.busyHidden ?? [],
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { hiddenCalendars: [], busyHidden: [] };
}

function writePrefs(userId: string, prefs: ViewPrefs) {
  try {
    window.localStorage.setItem(`${VIEW_PREFS_KEY}.${userId}`, JSON.stringify(prefs));
  } catch {
    /* private mode — preferences just will not persist */
  }
}

/** yyyy-mm-dd where the person is, not where the server is. */
export function localDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The list still being written for one sheet: the newest unfinished one. */
function openListFor(lists: ShoppingList[], groupId: string | undefined) {
  return lists
    .filter((l) => !l.done && (l.groupId ?? undefined) === groupId)
    .sort((a, b) => b.day.localeCompare(a.day))[0];
}

interface Data extends db.Workspace {
  busyHidden: string[];
}

interface StoreValue extends Data {
  currentUserId: string;
  me: Person;
  ready: boolean;
  /** Last write error, surfaced by the app shell. */
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  calendarById: (id: string) => Calendar | undefined;
  personById: (id: string) => Person | undefined;
  myCalendars: Calendar[];
  sharedCalendars: Calendar[];
  contacts: Person[];
  togglePersonBusy: (personId: string) => void;
  visibleEvents: CalendarEvent[];
  /** The stored row behind an id — the series itself, not an occurrence. */
  eventById: (id: string) => CalendarEvent | undefined;
  participantsOf: (event: CalendarEvent) => Person[];
  canEditEvent: (event: CalendarEvent) => boolean;
  sharedWithMe: { person: Person; count: number }[];
  iShareWith: { person: Person; count: number }[];
  /** How many items have travelled each way with one person. */
  trafficWith: (personId: string) => { from: number; to: number };
  itemsWith: (personId: string) => { fromThem: CalendarEvent[]; toThem: CalendarEvent[] };
  /**
   * Everything a group is involved in: what sits on its own calendars, and
   * anything shared with or by its members. A group is people, so "the group's
   * events" has to mean more than one calendar.
   */
  eventsInGroup: (groupId: string) => CalendarEvent[];
  createEvent: (draft: EventDraft) => void;
  updateEvent: (draft: EventDraft & { id: string }) => void;
  rescheduleEvent: (id: string, start: Date, end: Date, allDay?: boolean) => void;
  /**
   * "one" takes a single occurrence out of a repeating event; "all" removes
   * the event itself. Meaningless for an event that does not repeat, where
   * both do the same thing.
   */
  deleteEvent: (id: string, scope?: "one" | "all") => void;
  restoreEvent: (id: string) => void;
  purgeEvent: (id: string) => void;
  loadDeleted: () => Promise<DeletedEvent[]>;
  /** The last few reversible things you did, newest first. */
  undoStack: { id: string; label: string }[];
  undoLast: () => void;
  duplicateEvent: (id: string) => void;
  toggleEventShare: (eventId: string, personId: string) => void;
  moveEventToCalendar: (eventId: string, calendarId: string) => void;
  setEventColor: (eventId: string, color: ColorKey | undefined) => void;
  setEventPrivacy: (eventId: string, privacy: Privacy | undefined) => void;
  setEventImportance: (eventId: string, importance: Importance) => void;
  setEventReminders: (eventId: string, reminders: ReminderDraft[]) => void;
  /** Answer a reminder for one occurrence, on every device at once. */
  acknowledgeReminder: (reminderId: string, dueAt: string) => void;
  /** The list attached to an event — anyone who can see it may work it. */
  setListKind: (eventId: string, kind: ListKind) => void;
  addItem: (
    eventId: string,
    item: { text: string; quantity?: string; assignedTo?: string },
  ) => void;
  updateItem: (
    eventId: string,
    itemId: string,
    changes: Partial<Pick<EventItem, "text" | "quantity" | "assignedTo" | "done">>,
  ) => void;
  removeItem: (eventId: string, itemId: string) => void;
  /** Bell menu. */
  unreadNotifications: number;
  markNotificationsRead: (ids: string[]) => void;
  /** How the viewer wants to hear about one event. */
  /** Whether events shared with me mark me busy to my groups. */
  setSharedBusy: (on: boolean) => void;
  /**
   * People every new event of mine goes to without my saying so. A standing
   * arrangement about future events, not access to the calendar.
   */
  autoShare: string[];
  setAutoShare: (userIds: string[]) => void;
  /** Puts those people on the events I already have. Returns how many. */
  backfillAutoShare: () => Promise<number>;
  /** Who else has arranged to see everything of mine — and I of theirs. */
  autoShareWithMe: string[];
  /** Shared notes: yours, and your groups'. */
  addNote: (note: {
    body: string;
    groupId?: string;
    color: ColorKey;
    eventId?: string;
    /** yyyy-mm-dd, when the note is about a day rather than an event. */
    day?: string;
  }) => void;
  /** Pin a note to a day, or take it off one. */
  setNoteDay: (noteId: string, day?: string) => void;
  /**
   * Add to the open list for a sheet — yours, or a group's — starting one
   * dated today if there is none. An open list follows the day it was last
   * added to or ticked off, so the calendar shows where the shopping stands.
   */
  addShoppingItem: (groupId: string | undefined, text: string) => void;
  tickShoppingItem: (listId: string, itemId: string, done: boolean) => void;
  removeShoppingItem: (listId: string, itemId: string) => void;
  /** Finish a list, or reopen it. A finished list stays on its day for good. */
  finishShoppingList: (listId: string, done: boolean) => void;
  removeShoppingList: (listId: string) => void;
  /** Pin a note to an event, or take it off one. A note may serve several. */
  pinNoteTo: (noteId: string, eventId: string) => void;
  unpinNoteFrom: (noteId: string, eventId: string) => void;
  /** The notes pinned to one event, as far as this viewer may see them. */
  notesFor: (eventId: string) => Note[];
  editNote: (id: string, body: string) => void;
  pinNote: (id: string, pinned: boolean) => void;
  removeNote: (id: string) => void;
  setEventSubscription: (
    eventId: string,
    patch: Partial<{ email: boolean; mobile: boolean }>,
  ) => void;
  clearNotifications: (ids: string[]) => void;
  attachToEvent: (eventId: string, attachments: Attachment[]) => void;
  removeAttachment: (eventId: string, attachmentId: string) => void;
  toggleCalendar: (id: string) => void;
  showOnlyCalendar: (id: string) => void;
  createCalendar: (input: {
    name: string;
    color: ColorKey;
    groupId?: string;
    privacy?: Privacy;
  }) => void;
  renameCalendar: (id: string, name: string) => void;
  setCalendarColor: (id: string, color: ColorKey) => void;
  setCalendarPrivacy: (id: string, privacy: Privacy) => void;
  updateCalendarGroup: (id: string, groupId: string | undefined) => void;
  deleteCalendar: (id: string) => void;
  createGroup: (
    name: string,
    memberIds: string[],
    withCalendar?: boolean,
  ) => Promise<string | undefined>;
  setGroupMembers: (groupId: string, memberIds: string[]) => void;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  /** Subscribe to a Google/Outlook iCal address; syncs immediately. */
  addFeed: (input: {
    name: string;
    url: string;
    color: ColorKey;
    mode: "once" | "auto";
    intervalMinutes: number;
  }) => Promise<{ error?: string }>;
  syncFeed: (id: string) => Promise<void>;
  removeFeed: (id: string) => void;
  createInvites: (emails: string[], groupId?: string) => Promise<Invite[]>;
  /**
   * Letting somebody into a group. Joining exposes every member's busy times
   * to the newcomer and the newcomer's to them, so it is a proposal the group
   * answers rather than something one person does — and the newcomer accepts
   * for themselves once the group has agreed.
   */
  joinRequests: JoinRequest[];
  /** Waiting on my answer: a group I am in has been asked to admit somebody. */
  pendingForMe: JoinRequest[];
  /** Groups that have agreed to admit me, waiting for me to say yes. */
  invitationsForMe: JoinRequest[];
  proposeMember: (groupId: string, who: { email?: string; userId?: string }) => Promise<void>;
  voteOnJoin: (requestId: string, approve: boolean) => Promise<void>;
  withdrawJoin: (requestId: string) => void;
  answerGroupInvite: (requestId: string, accept: boolean) => Promise<void>;
  updateInvite: (id: string, patch: Partial<Invite>) => void;
  cancelInvite: (id: string) => void;
  /** Who is looking at their calendar right now. */
  presenceOf: (personId: string) => Presence | undefined;
  myPresence: Presence;
  /**
   * Tells the store which stretch of time is being looked at, so repeating
   * events are worked out far enough ahead. Widening only; it never shrinks
   * mid-session, because something just scrolled past should not vanish.
   */
  ensureRange: (from: Date, to: Date) => void;
  /** Exposed so attachment previews can mint signed URLs. */
  supabase: SupabaseClient;
}

const StoreContext = createContext<StoreValue | null>(null);

const EMPTY: Data = {
  people: [],
  groups: [],
  calendars: [],
  events: [],
  invites: [],
  feeds: [],
  notifications: [],
  acknowledged: [],
  notes: [],
  shoppingLists: [],
  autoShare: [],
  joinRequests: [],
  skippedOccurrences: [],
  missing: [],
  busyHidden: [],
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Data | null>(null);

  /**
   * The stretch of time occurrences are worked out for. It follows what is
   * being looked at rather than covering all of history, so a daily event does
   * not become ten thousand objects on the first paint.
   */
  /** Bumped to build a fresh channel after the old one gave up. */
  const [resubscribe, setResubscribe] = useState(0);

  const [horizon, setHorizon] = useState(() => {
    const from = new Date();
    from.setMonth(from.getMonth() - 6, 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 30);
    return { from, to };
  });
  const [error, setError] = useState<string | null>(null);
  const prefs = useRef<ViewPrefs>({ hiddenCalendars: [], busyHidden: [] });
  /**
   * Recently undoable actions, newest first. Kept in memory for this session;
   * anything older lives in the bin, which survives a reload.
   */
  const undoRef = useRef<{ id: string; label: string; undo: () => Promise<void> }[]>([]);
  const [undo, setUndo] = useState<{ id: string; label: string }[]>([]);

  const pushUndo = useCallback(
    (entry: { label: string; undo: () => Promise<void> }) => {
      const item = { id: crypto.randomUUID(), ...entry };
      undoRef.current = [item, ...undoRef.current].slice(0, 20);
      setUndo(undoRef.current.map(({ id, label }) => ({ id, label })));
    },
    [],
  );

  const load = useCallback(
    async (userId: string) => {
      prefs.current = readPrefs(userId);
      // Creates this app's profile and first calendar if they are missing.
      await db.bootstrapMe(supabase);
      const workspace = await db.loadWorkspace(
        supabase,
        new Set(prefs.current.hiddenCalendars),
        userId,
      );
      setData({ ...workspace, busyHidden: prefs.current.busyHidden });

      // Everything still works; the features behind these tables simply sit
      // idle until the schema catches up.
      if (workspace.missing.length) {
        setError(
          `Waiting on a database update — run ${deltaFor(workspace.missing)} in the Supabase SQL editor. Missing: ${workspace.missing.join(", ")}.`,
        );
      }
    },
    [supabase],
  );

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!alive || !user) return;
      setUser(user);
      load(user.id).catch((e) => {
        setError(describe(e));
        setData(EMPTY);
      });
    });
    return () => {
      alive = false;
    };
  }, [supabase, load]);

  /**
   * Live updates. Supabase applies row level security to realtime too, so we
   * are only told about rows we could have read anyway. Rather than patching
   * state from the payload we re-read, which keeps busy masking correct — the
   * masking lives in the cc_calendar_feed view, not in the raw row.
   *
   * The socket is not the whole answer, though. A tab left open overnight
   * comes back to a channel that quietly died — the laptop slept, the wifi
   * moved, the access token rotated underneath it — and a dead channel looks
   * exactly like a calendar where nothing has happened. So the connection is
   * watched and rebuilt when it fails, and coming back to the tab or back
   * online re-reads once. No timer: nothing polls while you are away, and
   * what you are shown is right the moment you look at it.
   */
  useEffect(() => {
    if (!user) return;
    let timer: number | null = null;
    let retry: number | null = null;
    let attempts = 0;
    let alive = true;

    const reload = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load(user.id).catch(() => {});
      }, 400);
    };

    const channel = supabase
      .channel("cc-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cc_notifications", filter: `user_id=eq.${user.id}` },
        reload,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_events" }, reload)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cc_event_items" },
        reload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cc_reminder_acks", filter: `user_id=eq.${user.id}` },
        reload,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_notes" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_note_events" }, reload)
      // Ticking something off should reach whoever is standing in the aisle.
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_shopping_lists" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_shopping_items" }, reload)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cc_event_shares" },
        reload,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Anything that happened while the channel was down is caught here.
          attempts = 0;
          reload();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!alive || retry) return;
          // Backing off rather than hammering a connection that is refusing.
          const wait = Math.min(30_000, 1000 * 2 ** attempts++);
          retry = window.setTimeout(() => {
            retry = null;
            if (!alive) return;
            void supabase.removeChannel(channel);
            setResubscribe((n) => n + 1);
          }, wait);
        }
      });

    /** Coming back to the tab, or back online, is worth one fresh read. */
    const onWake = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", reload);
    window.addEventListener("focus", onWake);

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      if (retry) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", reload);
      window.removeEventListener("focus", onWake);
      void supabase.removeChannel(channel);
    };
  }, [supabase, user, load, resubscribe]);

  // Sessions refresh in the background; follow them rather than reading once.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setData(EMPTY);
        return;
      }
      if (event === "TOKEN_REFRESHED" && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
      if (session?.user) setUser((current) => current ?? session.user);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      await load(user.id);
    } catch (e) {
      setError(describe(e));
    }
  }, [load, user]);

  /**
   * Applies the optimistic change, then runs the write. On failure the local
   * guess is discarded in favour of whatever the database actually holds.
   */
  const write = useCallback(
    (optimistic: (d: Data) => Data, query: () => Promise<unknown>) => {
      setData((current) => (current ? optimistic(current) : current));
      void (async () => {
        // A write with no session is refused by the database in a way that
        // reads like a permissions fault, so check before sending.
        if (!(await ensureSession(supabase))) {
          setError("You are signed out — reload the page and sign in again.");
          return;
        }
        await query().catch(async (e) => {
          setError(describe(e, await sessionNote(supabase)));
          void report(supabase, e);
          void refresh();
        });
      })();
    },
    [refresh, supabase],
  );

  const savePrefs = useCallback(
    (next: Partial<ViewPrefs>) => {
      if (!user) return;
      prefs.current = { ...prefs.current, ...next };
      writePrefs(user.id, prefs.current);
    },
    [user],
  );

  const presence = usePresence(supabase, user?.id);

  const value = useMemo<StoreValue>(() => {
    const d = data ?? EMPTY;
    const userId = user?.id ?? "";
    const mapEvents =
      (fn: (e: CalendarEvent) => CalendarEvent) =>
      (s: Data): Data => ({ ...s, events: s.events.map(fn) });

    const calendarById = (id: string) => d.calendars.find((c) => c.id === id);
    const personById = (id: string) => d.people.find((p) => p.id === id);

    const myCalendars = d.calendars.filter(
      (c) => c.kind === "personal" && c.ownerId === userId,
    );
    const sharedCalendars = d.calendars.filter((c) => c.kind === "shared");
    const mine = new Set([...myCalendars, ...sharedCalendars].map((c) => c.id));
    const busyHidden = new Set(d.busyHidden);
    const contacts = d.people.filter((p) => p.id !== userId);

    /*
     * A repeating event arrives as one row with a rule on it. Everything
     * downstream — the grids, the agenda, search, reminders — works in
     * occurrences, so they are worked out here, once, for a window around
     * whatever is being looked at. Nothing about the expansion is stored.
     */
    const events = expandRepeats(
      d.events,
      horizon.from,
      horizon.to,
      new Set(d.skippedOccurrences),
    );

    // The feed already decided what may be seen; this applies only the
    // viewer's own show/hide switches.
    const visibleEvents = events.filter((event) => {
      if (event.masked) return !busyHidden.has(event.createdBy);
      const calendar = calendarById(event.calendarId);
      if (calendar && mine.has(calendar.id)) return calendar.visible;
      if (event.sharedWith.includes(userId)) return true;
      return !busyHidden.has(event.createdBy);
    });

    const me: Person =
      d.people.find((p) => p.id === userId) ??
      ({
        id: userId,
        name:
          (user?.user_metadata?.full_name as string) ??
          user?.email?.split("@")[0] ??
          "You",
        email: user?.email ?? "",
        avatarColor: "orange",
        avatarUrl: user?.user_metadata?.avatar_url as string | undefined,
      } satisfies Person);

    /** Emails typed into the share box belong to people with no account yet. */
    const sendInvites = async (eventId: string, draft: EventDraft) => {
      if (!draft.inviteEmails?.length) return;
      await inviteToEvent(
        supabase,
        draft.inviteEmails,
        {
          id: eventId,
          title: draft.title,
          start: draft.start,
          end: draft.end,
          allDay: draft.allDay,
          location: draft.location,
          notes: draft.notes,
        },
        { name: me.name, email: me.email },
      );
    };

    /** Does this event reach that person at all? */
    const reaches = (event: CalendarEvent, personId: string) => {
      if (event.sharedWith.includes(personId)) return true;
      const calendar = calendarById(event.calendarId);
      if (calendar?.kind !== "shared") return false;
      const group = d.groups.find((g) => g.id === calendar.groupId);
      return Boolean(group?.memberIds.includes(personId));
    };

    const value: StoreValue = {
      ...d,
      supabase,
      presenceOf: (personId) => presence.people[personId],
      myPresence: presence.mine,
      currentUserId: userId,
      me,
      ready: data !== null,
      error,
      clearError: () => setError(null),
      refresh,
      calendarById,
      personById,
      myCalendars,
      sharedCalendars,
      contacts,
      visibleEvents,

      participantsOf: (event) =>
        participantIds(event, calendarById(event.calendarId), d.groups)
          .map((id) => d.people.find((p) => p.id === id))
          .filter((p) => p !== undefined),

      // Imported events belong to the calendar they came from; editing them
      // here would be undone by the next sync.
      canEditEvent: (event) =>
        !event.masked &&
        !event.feedId &&
        (canEdit(calendarById(event.calendarId), userId, d.groups) ||
          // A share is not a read-only copy: whoever is on the event can fix
          // the time on it, and the change is recorded against their name.
          (event.sharedWith?.includes(userId) ?? false)),

      sharedWithMe: contacts
        .map((person) => ({
          person,
          count: events.filter((e) => !e.masked && e.createdBy === person.id).length,
        }))
        .filter((row) => row.count > 0),

      iShareWith: contacts
        .map((person) => ({
          person,
          count: events.filter(
            (e) => !e.masked && e.createdBy === userId && reaches(e, person.id),
          ).length,
        }))
        .filter((row) => row.count > 0),

      trafficWith: (personId) => ({
        from: events.filter((e) => !e.masked && e.createdBy === personId).length,
        to: events.filter(
          (e) => !e.masked && e.createdBy === userId && reaches(e, personId),
        ).length,
      }),

      eventsInGroup: (groupId) => {
        const group = d.groups.find((g) => g.id === groupId);
        if (!group) return [];
        const members = new Set(group.memberIds);
        const groupCalendars = new Set(
          d.calendars.filter((c) => c.groupId === groupId).map((c) => c.id),
        );

        return events.filter((event) => {
          if (groupCalendars.has(event.calendarId)) return true;
          if (event.masked) return members.has(event.createdBy);
          // Anything passing between these people, wherever it lives.
          return (
            members.has(event.createdBy) ||
            event.sharedWith.some((id) => members.has(id))
          );
        });
      },

      itemsWith: (personId) => ({
        fromThem: events.filter((e) => !e.masked && e.createdBy === personId),
        toThem: events.filter(
          (e) => !e.masked && e.createdBy === userId && reaches(e, personId),
        ),
      }),

      /* ---------------- events ---------------- */

      createEvent: (draft) =>
        write(
          (s) => ({
            ...s,
            events: [
              ...s.events,
              {
                id: `tmp_${crypto.randomUUID()}`,
                calendarId: draft.calendarId,
                title: draft.title.trim() || "(no title)",
                notes: draft.notes || undefined,
                location: draft.location || undefined,
                start: draft.start.toISOString(),
                end: draft.end.toISOString(),
                allDay: draft.allDay,
                privacy: draft.privacy,
                importance: draft.importance,
                createdBy: userId,
                sharedWith: draft.sharedWith,
                attachments: draft.attachments,
              },
            ],
          }),
          async () => {
            const id = await db.insertEvent(supabase, draft, userId, d.autoShare);
            await sendInvites(id, draft);
            await pushFreshShares(supabase, id);
            await refresh();
          },
        ),

      updateEvent: (draft) =>
        write(
          mapEvents((e) =>
            e.id === draft.id
              ? {
                  ...e,
                  calendarId: draft.calendarId,
                  title: draft.title.trim() || "(no title)",
                  notes: draft.notes || undefined,
                  location: draft.location || undefined,
                  start: draft.start.toISOString(),
                  end: draft.end.toISOString(),
                  allDay: draft.allDay,
                  privacy: draft.privacy,
                  importance: draft.importance,
                  sharedWith: draft.sharedWith,
                  attachments: draft.attachments,
                }
              : e,
          ),
          async () => {
            await db.updateEvent(supabase, draft.id, draft, userId, d.autoShare);
            await sendInvites(draft.id, draft);
            await pushFreshShares(supabase, draft.id);
            await refresh();
          },
        ),

      rescheduleEvent: (id, start, end, allDay) => {
        const { eventId, start: occurrence } = splitOccurrenceId(id);

        /*
         * Dragging one occurrence of a repeating event moves that one, not the
         * series: the occurrence is lifted out and left standing on its own.
         * Moving the whole series is done from the dialog, where it can say so.
         */
        if (occurrence) {
          const series = d.events.find((e) => e.id === eventId);
          if (!series) return;
          void (async () => {
            try {
              const copy = await db.insertEvent(
                supabase,
                {
                  calendarId: series.calendarId,
                  title: series.title,
                  notes: series.notes ?? "",
                  location: series.location ?? "",
                  start,
                  end,
                  allDay: allDay ?? series.allDay,
                  sharedWith: series.sharedWith,
                  inviteEmails: [],
                  privacy: series.privacy,
                  importance: series.importance,
                  reminders: series.reminders?.map((r) => ({
                    minutesBefore: r.minutesBefore,
                    channel: r.channel,
                    forEveryone: !r.userId,
                  })),
                },
                userId,
                d.autoShare,
              );
              await db.skipOccurrence(supabase, eventId, occurrence, copy);
              await refresh();
            } catch (e) {
              setError(describe(e, "moving that one"));
            }
          })();
          return;
        }

        const before = d.events.find((e) => e.id === eventId);
        if (before) {
          pushUndo({
            label: `Moved “${before.title}”`,
            undo: async () => {
              await db.patchEvent(supabase, eventId, {
                starts_at: before.start,
                ends_at: before.end,
                all_day: before.allDay,
              });
              await refresh();
            },
          });
        }
        return write(
          mapEvents((e) =>
            e.id === eventId
              ? {
                  ...e,
                  start: start.toISOString(),
                  end: end.toISOString(),
                  allDay: allDay ?? e.allDay,
                }
              : e,
          ),
          () =>
            db.patchEvent(supabase, eventId, {
              starts_at: start.toISOString(),
              ends_at: end.toISOString(),
              ...(allDay === undefined ? {} : { all_day: allDay }),
            }),
        );
      },

      deleteEvent: (id, scope = "all") => {
        const { eventId, start: occurrence } = splitOccurrenceId(id);
        const event = d.events.find((e) => e.id === eventId);

        // Just this Tuesday: the series stays, with a hole in it.
        if (occurrence && scope === "one") {
          write(
            (s) => ({
              ...s,
              skippedOccurrences: [
                ...s.skippedOccurrences,
                `${eventId}::${occurrence.toISOString()}`,
              ],
            }),
            async () => {
              await db.skipOccurrence(supabase, eventId, occurrence);
              pushUndo({
                label: `Skipped one “${event?.title ?? "event"}”`,
                undo: async () => {
                  await db.unskipOccurrence(supabase, eventId, occurrence);
                  await refresh();
                },
              });
            },
          );
          return;
        }

        write(
          (s) => ({ ...s, events: s.events.filter((e) => e.id !== eventId) }),
          async () => {
            await db.deleteEvent(supabase, eventId);
            pushUndo({
              label: `Deleted “${event?.title ?? "event"}”`,
              undo: async () => {
                await db.restoreEvent(supabase, eventId);
                await refresh();
              },
            });
          },
        );
      },

      restoreEvent: (id) =>
        write(
          (s) => s,
          async () => {
            await db.restoreEvent(supabase, id);
            await refresh();
          },
        ),

      purgeEvent: (id) =>
        write(
          (s) => s,
          async () => {
            await db.purgeEvent(supabase, id);
            await refresh();
          },
        ),

      loadDeleted: () => db.loadDeleted(supabase),

      undoStack: undo,

      undoLast: () => {
        const last = undoRef.current[0];
        if (!last) return;
        undoRef.current = undoRef.current.slice(1);
        setUndo(undoRef.current.map(({ id, label }) => ({ id, label })));
        void last.undo().catch((e) => setError(describe(e)));
      },

      duplicateEvent: (id) =>
        write(
          (s) => s,
          async () => {
            await db.duplicateEvent(supabase, id, userId);
            await refresh();
          },
        ),

      toggleEventShare: (eventId, personId) => {
        const event = d.events.find((e) => e.id === eventId);
        if (!event) return;
        const next = event.sharedWith.includes(personId)
          ? event.sharedWith.filter((p) => p !== personId)
          : [...event.sharedWith, personId];
        write(
          mapEvents((e) => (e.id === eventId ? { ...e, sharedWith: next } : e)),
          async () => {
            await db.setShares(supabase, eventId, next, userId);
            await pushFreshShares(supabase, eventId);
          },
        );
      },

      moveEventToCalendar: (eventId, calendarId) =>
        write(
          mapEvents((e) => (e.id === eventId ? { ...e, calendarId } : e)),
          () => db.patchEvent(supabase, eventId, { calendar_id: calendarId }),
        ),

      setEventColor: (eventId, color) =>
        write(
          mapEvents((e) => (e.id === eventId ? { ...e, color } : e)),
          () => db.patchEvent(supabase, eventId, { color: color ?? null }),
        ),

      setEventPrivacy: (eventId, privacy) =>
        write(
          mapEvents((e) => (e.id === eventId ? { ...e, privacy } : e)),
          () => db.patchEvent(supabase, eventId, { privacy: privacy ?? null }),
        ),

      setEventImportance: (eventId, importance) =>
        write(
          mapEvents((e) =>
            e.id === eventId
              ? { ...e, importance: importance === "urgent" ? "urgent" : undefined }
              : e,
          ),
          () => db.patchEvent(supabase, eventId, { importance }),
        ),

      setEventReminders: (eventId, reminders) =>
        write(
          mapEvents((e) =>
            e.id === eventId
              ? {
                  ...e,
                  reminders: reminders.map((r, i) => ({
                    id: e.reminders?.[i]?.id ?? `tmp_${i}`,
                    eventId,
                    minutesBefore: r.minutesBefore,
                    channel: r.channel,
                    userId: r.forEveryone ? undefined : userId,
                  })),
                }
              : e,
          ),
          async () => {
            await db.setReminders(supabase, eventId, reminders, userId);
            await refresh();
          },
        ),

      acknowledgeReminder: (reminderId, dueAt) =>
        write(
          (s) => ({
            ...s,
            acknowledged: [...s.acknowledged, `${reminderId}:${dueAt}`],
          }),
          () => db.acknowledgeReminder(supabase, reminderId, dueAt),
        ),

      setListKind: (eventId, kind) =>
        write(
          mapEvents((e) => (e.id === eventId ? { ...e, listKind: kind } : e)),
          () => db.patchEvent(supabase, eventId, { list_kind: kind }),
        ),

      addItem: (eventId, item) => {
        const existing = d.events.find((e) => e.id === eventId)?.items ?? [];
        const position = existing.length
          ? Math.max(...existing.map((i) => i.position)) + 1
          : 0;
        write(
          mapEvents((e) =>
            e.id === eventId
              ? {
                  ...e,
                  items: [
                    ...(e.items ?? []),
                    {
                      id: `tmp_${crypto.randomUUID()}`,
                      eventId,
                      done: false,
                      position,
                      ...item,
                    },
                  ],
                }
              : e,
          ),
          async () => {
            await db.insertItem(supabase, eventId, { ...item, position });
            await refresh();
          },
        );
      },

      updateItem: (eventId, itemId, changes) =>
        write(
          mapEvents((e) =>
            e.id === eventId
              ? {
                  ...e,
                  items: (e.items ?? []).map((i) =>
                    i.id === itemId ? { ...i, ...changes } : i,
                  ),
                }
              : e,
          ),
          () =>
            db.patchItem(supabase, itemId, {
              ...(changes.text !== undefined ? { text: changes.text } : {}),
              ...(changes.quantity !== undefined
                ? { quantity: changes.quantity || null }
                : {}),
              ...(changes.assignedTo !== undefined
                ? { assigned_to: changes.assignedTo || null }
                : {}),
              ...(changes.done !== undefined
                ? {
                    done: changes.done,
                    done_by: changes.done ? userId : null,
                    done_at: changes.done ? new Date().toISOString() : null,
                  }
                : {}),
            }),
        ),

      removeItem: (eventId, itemId) =>
        write(
          mapEvents((e) =>
            e.id === eventId
              ? { ...e, items: (e.items ?? []).filter((i) => i.id !== itemId) }
              : e,
          ),
          () => db.deleteItem(supabase, itemId),
        ),

      attachToEvent: (eventId, attachments) =>
        write(
          mapEvents((e) =>
            e.id === eventId
              ? { ...e, attachments: [...(e.attachments ?? []), ...attachments] }
              : e,
          ),
          () => db.linkAttachments(supabase, eventId, attachments, userId),
        ),

      removeAttachment: (eventId, attachmentId) => {
        const attachment = d.events
          .find((e) => e.id === eventId)
          ?.attachments?.find((a) => a.id === attachmentId);
        write(
          mapEvents((e) =>
            e.id === eventId
              ? {
                  ...e,
                  attachments: (e.attachments ?? []).filter((a) => a.id !== attachmentId),
                }
              : e,
          ),
          () =>
            attachment ? db.removeAttachment(supabase, attachment) : Promise.resolve(),
        );
      },

      /* ---------------- calendars ---------------- */

      toggleCalendar: (id) => {
        const hidden = new Set(prefs.current.hiddenCalendars);
        if (hidden.has(id)) hidden.delete(id);
        else hidden.add(id);
        savePrefs({ hiddenCalendars: [...hidden] });
        setData((s) =>
          s
            ? {
                ...s,
                calendars: s.calendars.map((c) =>
                  c.id === id ? { ...c, visible: !hidden.has(c.id) } : c,
                ),
              }
            : s,
        );
      },

      showOnlyCalendar: (id) => {
        const hidden = d.calendars.filter((c) => c.id !== id).map((c) => c.id);
        savePrefs({ hiddenCalendars: hidden });
        setData((s) =>
          s
            ? { ...s, calendars: s.calendars.map((c) => ({ ...c, visible: c.id === id })) }
            : s,
        );
      },

      createCalendar: (input) =>
        write(
          (s) => s,
          async () => {
            await db.insertCalendar(supabase, {
              ...input,
              privacy: input.privacy ?? (input.groupId ? "details" : "busy"),
            });
            await refresh();
          },
        ),

      renameCalendar: (id, name) =>
        write(
          (s) => ({
            ...s,
            calendars: s.calendars.map((c) =>
              c.id === id ? { ...c, name: name.trim() || c.name } : c,
            ),
          }),
          () => db.patchCalendar(supabase, id, { name: name.trim() }),
        ),

      setCalendarColor: (id, color) =>
        write(
          (s) => ({
            ...s,
            calendars: s.calendars.map((c) => (c.id === id ? { ...c, color } : c)),
          }),
          () => db.patchCalendar(supabase, id, { color }),
        ),

      setCalendarPrivacy: (id, privacy) =>
        write(
          (s) => ({
            ...s,
            calendars: s.calendars.map((c) => (c.id === id ? { ...c, privacy } : c)),
          }),
          () => db.patchCalendar(supabase, id, { privacy }),
        ),

      updateCalendarGroup: (id, groupId) =>
        write(
          (s) => ({
            ...s,
            calendars: s.calendars.map((c) =>
              c.id === id ? { ...c, groupId, kind: groupId ? "shared" : "personal" } : c,
            ),
          }),
          async () => {
            await db.patchCalendar(supabase, id, {
              group_id: groupId ?? null,
              kind: groupId ? "shared" : "personal",
            });
            await refresh();
          },
        ),

      deleteCalendar: (id) =>
        write(
          (s) => ({
            ...s,
            calendars: s.calendars.filter((c) => c.id !== id),
            events: s.events.filter((e) => e.calendarId !== id),
          }),
          () => db.deleteCalendar(supabase, id),
        ),

      /* ---------------- groups ---------------- */

      createGroup: async (name, memberIds, withCalendar = false) => {
        try {
          const groupId = await db.insertGroup(supabase, name, memberIds, userId);
          await sendAgreedInvites(supabase, d.people.find((x) => x.id === userId)?.name ?? "Somebody");
          if (withCalendar) {
            await db.insertCalendar(supabase, {
              name: name.trim() || "Shared",
              color: "violet",
              groupId,
              privacy: "details",
            });
          }
          await refresh();
          return groupId;
        } catch (e) {
          setError(describe(e));
          return undefined;
        }
      },

      setGroupMembers: (groupId, memberIds) =>
        write(
          (s) => ({
            ...s,
            groups: s.groups.map((g) =>
              g.id === groupId
                ? { ...g, memberIds: [...new Set([userId, ...memberIds])] }
                : g,
            ),
          }),
          async () => {
            await db.setGroupMembers(
              supabase,
              groupId,
              memberIds,
              userId,
              d.groups.find((g) => g.id === groupId)?.memberIds ?? [],
            );
            await sendAgreedInvites(supabase, d.people.find((x) => x.id === userId)?.name ?? "Somebody");
            await refresh();
          },
        ),

      renameGroup: (groupId, name) =>
        write(
          (s) => ({
            ...s,
            groups: s.groups.map((g) =>
              g.id === groupId ? { ...g, name: name.trim() || g.name } : g,
            ),
          }),
          () => db.patchGroup(supabase, groupId, { name: name.trim() }),
        ),

      deleteGroup: (groupId) =>
        write(
          (s) => ({ ...s, groups: s.groups.filter((g) => g.id !== groupId) }),
          async () => {
            await db.deleteGroup(supabase, groupId);
            await refresh();
          },
        ),

      /* ---------------- invitations ---------------- */

      addFeed: async (input) => {
        try {
          const id = await db.insertFeed(supabase, input);
          // Pull it in straight away so the calendar is not empty on return.
          const response = await fetch("/api/feeds/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedId: id }),
          });
          const result = await response.json().catch(() => ({}));
          await refresh();
          return response.ok ? {} : { error: result.error ?? "Could not read that calendar." };
        } catch (e) {
          const message = describe(e);
          setError(message);
          return { error: message };
        }
      },

      syncFeed: async (id) => {
        try {
          const response = await fetch("/api/feeds/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedId: id }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) setError(result.error ?? "Could not read that calendar.");
          await refresh();
        } catch {
          setError("Could not reach the sync service.");
        }
      },

      removeFeed: (id) =>
        write(
          (s) => ({ ...s, feeds: s.feeds.filter((f) => f.id !== id) }),
          async () => {
            await db.deleteFeed(supabase, id);
            await refresh();
          },
        ),

      joinRequests: d.joinRequests,

      pendingForMe: d.joinRequests.filter(
        (r) =>
          r.status === "pending" &&
          d.groups.some((g) => g.id === r.groupId && g.memberIds.includes(userId)) &&
          !r.votes.some((v) => v.userId === userId),
      ),

      invitationsForMe: d.joinRequests.filter(
        (r) => r.status === "approved" && r.inviteeId === userId,
      ),

      proposeMember: async (groupId, who) => {
        try {
          const myName = d.people.find((x) => x.id === userId)?.name ?? "Somebody";
          const requestId = await db.proposeMember(supabase, groupId, who);
          // A group of one agrees on the spot, so the invitation can go now.
          await sendAgreedInvites(supabase, myName);
          // Whoever now has to answer — the group, or the newcomer if the
          // group was only you — is told outside the app as well.
          const fresh = await db.joinRequestById(supabase, requestId);
          if (fresh) await mailAboutRequest(fresh, d.people, d.groups, userId, myName);
          await refresh();
        } catch (e) {
          setError(describe(e, "asking the group"));
        }
      },

      voteOnJoin: async (requestId, approve) => {
        try {
          const myName = d.people.find((x) => x.id === userId)?.name ?? "Somebody";
          const outcome = await db.voteOnJoinRequest(supabase, requestId, approve);
          if (outcome === "approved") {
            await sendAgreedInvites(supabase, myName);
            // The last yes is the newcomer's cue, and they are not sitting in
            // the app waiting for it.
            const fresh = await db.joinRequestById(supabase, requestId);
            if (fresh) await mailAboutRequest(fresh, d.people, d.groups, userId, myName);
          }
          await refresh();
        } catch (e) {
          setError(describe(e, "answering"));
        }
      },

      withdrawJoin: (requestId) =>
        write(
          (s) => ({
            ...s,
            joinRequests: s.joinRequests.filter((r) => r.id !== requestId),
          }),
          () => db.withdrawJoinRequest(supabase, requestId),
        ),

      answerGroupInvite: async (requestId, accept) => {
        try {
          await db.answerGroupInvite(supabase, requestId, accept);
          await refresh();
        } catch (e) {
          setError(describe(e, "joining"));
        }
      },

      createInvites: async (emails, groupId) => {
        const known = new Set(
          d.people
            .map((p) => p.email.toLowerCase())
            .concat(
              d.invites
                .filter((i) => i.status !== "failed")
                .map((i) => i.email.toLowerCase()),
            ),
        );
        const rows = [...new Set(emails.map((e) => e.trim().toLowerCase()))]
          .filter((email) => email.includes("@") && !known.has(email))
          .map((email) => ({
            email,
            token: crypto.randomUUID().replace(/-/g, ""),
            groupId,
          }));
        if (!rows.length) return [];

        try {
          const created = await db.insertInvites(supabase, rows);
          setData((s) => (s ? { ...s, invites: [...created, ...s.invites] } : s));
          return created;
        } catch (e) {
          setError(describe(e));
          return [];
        }
      },

      updateInvite: (id, patch) =>
        write(
          (s) => ({
            ...s,
            invites: s.invites.map((i) => (i.id === id ? { ...i, ...patch } : i)),
          }),
          () =>
            db.patchInvite(supabase, id, {
              ...(patch.status ? { status: patch.status } : {}),
              ...(patch.error !== undefined ? { error: patch.error ?? null } : {}),
            }),
        ),

      cancelInvite: (id) =>
        write(
          (s) => ({ ...s, invites: s.invites.filter((i) => i.id !== id) }),
          () => db.deleteInvite(supabase, id),
        ),

      unreadNotifications: d.notifications.filter((n) => !n.readAt).length,

      setEventSubscription: (eventId, patch) =>
        write(
          mapEvents((e) =>
            e.id === eventId
              ? {
                  ...e,
                  subscription: {
                    email: false,
                    mobile: false,
                    ...e.subscription,
                    ...patch,
                  },
                }
              : e,
          ),
          () =>
            db.setSubscription(supabase, eventId, {
              email: false,
              mobile: false,
              ...d.events.find((e) => e.id === eventId)?.subscription,
              ...patch,
            }),
        ),

      addNote: (note) =>
        write(
          (s) => ({
            ...s,
            notes: [
              {
                id: `tmp_${crypto.randomUUID()}`,
                body: note.body,
                groupId: note.groupId,
                day: note.day,
                eventIds: note.eventId ? [note.eventId] : [],
                color: note.color,
                pinned: false,
                createdBy: userId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...s.notes,
            ],
          }),
          async () => {
            await db.insertNote(supabase, note);
            await refresh();
          },
        ),

      setNoteDay: (noteId, day) =>
        write(
          (s) => ({
            ...s,
            notes: s.notes.map((n) => (n.id === noteId ? { ...n, day } : n)),
          }),
          () => db.patchNote(supabase, noteId, { day: day ?? null }),
        ),

      /*
       * The shopping.
       *
       * One list per sheet is open at a time, and it follows the day it was
       * last worked on, so the calendar shows where the shopping stands rather
       * than where it started. Finishing a list leaves it on its day for good
       * and the next one begins with the next shopping — which is how a month
       * fills up with the days somebody went out.
       */
      addShoppingItem: (groupId, text) => {
        const body = text.trim();
        if (!body) return;
        const today = localDay(new Date());
        const open = openListFor(d.shoppingLists, groupId);
        const listId = open?.id ?? crypto.randomUUID();
        const itemId = crypto.randomUUID();
        const position = open?.items.length ?? 0;

        write(
          (s) => ({
            ...s,
            shoppingLists: open
              ? s.shoppingLists.map((l) =>
                  l.id === listId
                    ? {
                        ...l,
                        day: today,
                        items: [
                          ...l.items,
                          {
                            id: itemId,
                            text: body,
                            done: false,
                            position,
                            createdBy: userId,
                          },
                        ],
                      }
                    : l,
                )
              : [
                  {
                    id: listId,
                    groupId,
                    day: today,
                    done: false,
                    createdBy: userId,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    items: [
                      { id: itemId, text: body, done: false, position, createdBy: userId },
                    ],
                  },
                  ...s.shoppingLists,
                ],
          }),
          async () => {
            if (!open) await db.insertShoppingList(supabase, { id: listId, groupId, day: today });
            else if (open.day !== today) {
              await db.patchShoppingList(supabase, listId, { day: today });
            }
            await db.insertShoppingItem(supabase, { id: itemId, listId, text: body, position });
          },
        );
      },

      tickShoppingItem: (listId, itemId, done) => {
        const today = localDay(new Date());
        const list = d.shoppingLists.find((l) => l.id === listId);
        // A finished list is a record of that day and does not move again.
        const moves = Boolean(list && !list.done && list.day !== today);

        write(
          (s) => ({
            ...s,
            shoppingLists: s.shoppingLists.map((l) =>
              l.id === listId
                ? {
                    ...l,
                    day: moves ? today : l.day,
                    items: l.items.map((item) =>
                      item.id === itemId
                        ? { ...item, done, doneBy: done ? userId : undefined }
                        : item,
                    ),
                  }
                : l,
            ),
          }),
          async () => {
            await db.patchShoppingItem(supabase, itemId, {
              done,
              done_by: done ? userId : null,
              done_at: done ? new Date().toISOString() : null,
            });
            if (moves) await db.patchShoppingList(supabase, listId, { day: today });
          },
        );
      },

      removeShoppingItem: (listId, itemId) =>
        write(
          (s) => ({
            ...s,
            shoppingLists: s.shoppingLists.map((l) =>
              l.id === listId
                ? { ...l, items: l.items.filter((item) => item.id !== itemId) }
                : l,
            ),
          }),
          () => db.deleteShoppingItem(supabase, itemId),
        ),

      finishShoppingList: (listId, done) =>
        write(
          (s) => ({
            ...s,
            shoppingLists: s.shoppingLists.map((l) => (l.id === listId ? { ...l, done } : l)),
          }),
          () => db.patchShoppingList(supabase, listId, { done }),
        ),

      removeShoppingList: (listId) =>
        write(
          (s) => ({
            ...s,
            shoppingLists: s.shoppingLists.filter((l) => l.id !== listId),
          }),
          () => db.deleteShoppingList(supabase, listId),
        ),

      pinNoteTo: (noteId, eventId) =>
        write(
          (s) => ({
            ...s,
            notes: s.notes.map((n) =>
              n.id === noteId && !n.eventIds.includes(eventId)
                ? { ...n, eventIds: [...n.eventIds, eventId] }
                : n,
            ),
          }),
          async () => {
            await db.pinNoteToEvent(supabase, noteId, eventId);
            // The trigger writes the notifications; this delivers them now
            // rather than whenever the cron next runs.
            await pushFreshShares(supabase, eventId);
          },
        ),

      unpinNoteFrom: (noteId, eventId) =>
        write(
          (s) => ({
            ...s,
            notes: s.notes.map((n) =>
              n.id === noteId
                ? { ...n, eventIds: n.eventIds.filter((id) => id !== eventId) }
                : n,
            ),
          }),
          () => db.unpinNoteFromEvent(supabase, noteId, eventId),
        ),

      notesFor: (eventId) => d.notes.filter((n) => n.eventIds.includes(eventId)),

      editNote: (id, body) =>
        write(
          (s) => ({
            ...s,
            notes: s.notes.map((n) => (n.id === id ? { ...n, body } : n)),
          }),
          () => db.patchNote(supabase, id, { body }),
        ),

      pinNote: (id, pinned) =>
        write(
          (s) => ({
            ...s,
            notes: s.notes.map((n) => (n.id === id ? { ...n, pinned } : n)),
          }),
          () => db.patchNote(supabase, id, { pinned }),
        ),

      removeNote: (id) =>
        write(
          (s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }),
          () => db.deleteNote(supabase, id),
        ),

      autoShare: d.autoShare,

      autoShareWithMe: [],

      setAutoShare: (userIds) =>
        write(
          (s) => ({ ...s, autoShare: userIds }),
          async () => {
            await db.setAutoShare(supabase, userIds, userId);
          },
        ),

      backfillAutoShare: async () => {
        const count = await db.backfillAutoShare(supabase, d.autoShare, userId);
        await refresh();
        return count;
      },

      eventById: (id) =>
        d.events.find((e) => e.id === splitOccurrenceId(id).eventId),

      ensureRange: (from, to) => {
        setHorizon((current) => {
          const wantFrom = from < current.from ? new Date(from) : current.from;
          const wantTo = to > current.to ? new Date(to) : current.to;
          if (wantFrom.getTime() === current.from.getTime()
              && wantTo.getTime() === current.to.getTime()) {
            return current;
          }
          // A year of slack, so paging month by month does not rebuild the
          // list on every step.
          if (from < current.from) wantFrom.setMonth(wantFrom.getMonth() - 12);
          if (to > current.to) wantTo.setMonth(wantTo.getMonth() + 12);
          return { from: wantFrom, to: wantTo };
        });
      },

      setSharedBusy: (on) =>
        write(
          (s) => ({
            ...s,
            people: s.people.map((p) =>
              p.id === userId ? { ...p, sharedBusy: on } : p,
            ),
          }),
          async () => {
            await db.setSharedBusy(supabase, on);
            await refresh();
          },
        ),

      markNotificationsRead: (ids) =>
        write(
          (s) => ({
            ...s,
            notifications: s.notifications.map((n) =>
              ids.includes(n.id) ? { ...n, readAt: new Date().toISOString() } : n,
            ),
          }),
          () => db.markNotificationsRead(supabase, ids),
        ),

      clearNotifications: (ids) =>
        write(
          (s) => ({
            ...s,
            notifications: s.notifications.filter((n) => !ids.includes(n.id)),
          }),
          () => db.clearNotifications(supabase, ids),
        ),

      togglePersonBusy: (personId) => {
        const hidden = new Set(prefs.current.busyHidden);
        if (hidden.has(personId)) hidden.delete(personId);
        else hidden.add(personId);
        savePrefs({ busyHidden: [...hidden] });
        setData((s) => (s ? { ...s, busyHidden: [...hidden] } : s));
      },
    };

    /*
     * Everything on screen works in occurrences, so an id arriving from a
     * click is "<row>::<when>" whenever the event repeats. These all act on
     * the row behind it — colouring the series, adding to its list, pinning a
     * note to it — so the id is normalised here rather than in each of them.
     *
     * The ones that need to know which occurrence they were given (skipping
     * just one, dragging one to another day) take the full id and are
     * deliberately absent from this list.
     */
    const series = (id: string) => splitOccurrenceId(id).eventId;

    return {
      ...value,
      toggleEventShare: (id, personId) => value.toggleEventShare(series(id), personId),
      moveEventToCalendar: (id, calendarId) =>
        value.moveEventToCalendar(series(id), calendarId),
      setEventColor: (id, color) => value.setEventColor(series(id), color),
      setEventPrivacy: (id, privacy) => value.setEventPrivacy(series(id), privacy),
      setEventImportance: (id, importance) =>
        value.setEventImportance(series(id), importance),
      setEventReminders: (id, reminders) =>
        value.setEventReminders(series(id), reminders),
      setListKind: (id, kind) => value.setListKind(series(id), kind),
      addItem: (id, item) => value.addItem(series(id), item),
      removeItem: (id, itemId) => value.removeItem(series(id), itemId),
      attachToEvent: (id, attachments) => value.attachToEvent(series(id), attachments),
      removeAttachment: (id, attachmentId) =>
        value.removeAttachment(series(id), attachmentId),
      setEventSubscription: (id, patch) => value.setEventSubscription(series(id), patch),
      notesFor: (id) => value.notesFor(series(id)),
      pinNoteTo: (noteId, id) => value.pinNoteTo(noteId, series(id)),
      unpinNoteFrom: (noteId, id) => value.unpinNoteFrom(noteId, series(id)),
    };
  }, [data, error, horizon, presence, pushUndo, refresh, savePrefs, supabase, undo, user, write]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/**
 * A share writes a notification by trigger; this asks the server to push it
 * out now, so the other person hears about it with the calendar closed rather
 * than whenever the cron next runs.
 *
 * We name the event and let the server find the notifications. They are
 * addressed to the other people, so this client cannot read them.
 */
async function pushFreshShares(_supabase: SupabaseClient, eventId: string) {
  await deliverNow({ eventId });
}

/** Sends a failed write to the server log, so it can be read from outside. */
async function report(supabase: SupabaseClient, e: unknown) {
  try {
    const error = e as {
      message?: string;
      code?: string;
      details?: string;
      attempted?: unknown;
    };
    const {
      data: { session },
    } = await supabase.auth.getSession();

    await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "write",
        code: error.code,
        message: error.message,
        detail: error.details,
        hasSession: Boolean(session),
        userId: session?.user.id,
        payload: error.attempted,
      }),
    });
  } catch {
    /* reporting must never make things worse */
  }
}

/**
 * A refusal usually means the request arrived without a session, so say so
 * rather than leaving somebody to guess at row level security.
 */
async function sessionNote(supabase: SupabaseClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return "You are signed out — reload the page and sign in again.";
  const expires = session.expires_at ? session.expires_at * 1000 : 0;
  if (expires && expires < Date.now()) {
    return "Your session has expired — reload the page.";
  }
  return `signed in as ${session.user.email ?? session.user.id.slice(0, 8)}`;
}

/** Which delta to paste, given which tables are missing. */
/** The link an invitation email points at — the same one the dialog builds. */
/**
 * The two moments in letting somebody in that have to leave the app.
 *
 * Being asked to agree is not news anybody goes looking for: the question sits
 * in a sidebar there is no reason to open, and the person who asked is left
 * thinking nothing happened. So the group is written to when it is asked, and
 * the newcomer when it has agreed. Everything else stays in the app.
 *
 * The mail is best-effort by design — the notifications are already written,
 * and a mail server having a bad afternoon must not undo a decision.
 */
async function mailAboutRequest(
  request: { group_id: string; invitee_id: string | null; email: string | null; status: string },
  people: Person[],
  groups: Group[],
  actorId: string,
  fromName: string,
) {
  const group = groups.find((g) => g.id === request.group_id);
  const personName =
    people.find((p) => p.id === request.invitee_id)?.name ?? request.email ?? "somebody";

  const to =
    request.status === "pending"
      ? (group?.memberIds ?? [])
          .filter((id) => id !== actorId)
          .map((id) => people.find((p) => p.id === id)?.email)
          .filter((email): email is string => Boolean(email))
      : request.status === "approved" && request.invitee_id
        ? [people.find((p) => p.id === request.invitee_id)?.email].filter(
            (email): email is string => Boolean(email),
          )
        : [];

  if (!to.length) return;

  await fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: request.status === "pending" ? "vote" : "join",
      to,
      fromName,
      personName,
      groupName: group?.name ?? "a group",
      link: `${publicUrl()}/calendar`,
    }),
  }).catch(() => {});
}

function sendAgreedInvites(supabase: SupabaseClient, fromName: string) {
  return db.sendApprovedGroupInvites(
    supabase,
    fromName,
    (token) => `${publicUrl()}/join/${token}`,
  );
}

function deltaFor(missing: string[]) {
  const files = new Set<string>();
  for (const table of missing) {
    if (table === "cc_reminder_acks") files.add("supabase/delta-reminder-acks.sql");
    else if (table === "cc_event_items") files.add("supabase/delta-lists.sql");
    else if (table === "cc_event_subscriptions") files.add("supabase/delta-realtime-notify.sql");
    else if (table === "cc_notifications") files.add("supabase/delta-reminders-v2.sql");
    else if (table === "cc_event_reminders") files.add("supabase/delta-reminders.sql");
    else if (table === "cc_calendar_feeds") files.add("supabase/delta-calendar-sync.sql");
    else if (table === "cc_notes") files.add("supabase/delta-notes.sql");
    else if (table === "cc_note_events") files.add("supabase/delta-note-events.sql");
    else if (table === "cc_auto_share" || table === "cc_event_changes")
      files.add("supabase/delta-always-share.sql");
    else if (table === "cc_group_join_requests" || table === "cc_group_join_votes")
      files.add("supabase/delta-group-consent.sql");
    else files.add("supabase/schema.sql");
  }
  return [...files].join(" and ");
}

/**
 * Turns a Postgres/PostgREST error into something a person can act on — while
 * still showing the underlying message, because a friendly summary alone made
 * a permissions problem impossible to diagnose.
 */
function describe(e: unknown, note?: string) {
  const suffix = note ? ` (${note})` : "";
  if (typeof e !== "object" || !e) return `Something went wrong.${suffix}`;

  const error = e as { message?: string; code?: string; details?: string; hint?: string };
  const message = String(error.message ?? "");
  const code = error.code ? ` [${error.code}]` : "";
  const detail = [error.details, error.hint].filter(Boolean).join(" · ");

  // 42703 is a column, 42P01 / PGRST205 a table. Saying "run schema.sql" for a
  // column the app should not have asked for sends somebody to the wrong place.
  if (error.code === "42703") {
    return `The app asked for something the database does not have${code}: ${message}`;
  }
  if (
    message.includes("schema cache") ||
    message.includes("Could not find the table") ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  ) {
    return `Database tables are missing — run supabase/schema.sql in the Supabase SQL editor.${code} ${message}`;
  }
  if (message.includes("row-level security")) {
    return `Refused by the database${code}: ${message}${detail ? ` — ${detail}` : ""}${suffix}`;
  }
  return `${message}${code}${detail ? ` — ${detail}` : ""}` || "Something went wrong.";
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
