/**
 * Domain model for DocMaker Calendar.
 *
 * These types deliberately mirror the shape we will store in Supabase
 * (tables prefixed `CC_`), so moving from the local store to the database
 * is a swap of the store implementation, not a rewrite of the UI.
 */

/** Named palette entries — a calendar picks one, events inherit it. */
export type ColorKey =
  | "orange"
  | "teal"
  | "violet"
  | "rose"
  | "blue"
  | "green"
  | "amber"
  | "slate";

export interface Person {
  id: string;
  name: string;
  email: string;
  /** Initials shown in avatars when there is no image. */
  avatarColor: ColorKey;
  /** Google profile picture, when the account came from OAuth. */
  avatarUrl?: string;
  /** Whether events shared with them mark them busy to their groups. */
  sharedBusy?: boolean;
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
}

export type CalendarKind =
  /** Belongs to one person. */
  | "personal"
  /** Belongs to a group; every member reads and writes it. */
  | "shared";

export interface Calendar {
  id: string;
  name: string;
  kind: CalendarKind;
  color: ColorKey;
  ownerId: string;
  /** Set when kind === "shared". */
  groupId?: string;
  /** Toggled by the sidebar checkboxes — a view concern we persist per user. */
  visible: boolean;
  /** What people who share a group with the owner get to see. */
  privacy: Privacy;
}

/**
 * The owner's choice, per calendar (and overridable per event):
 * - "details" — group members see the event exactly as the owner does.
 * - "busy"    — they see an anonymous grey block: the time is taken, nothing more.
 * - "hidden"  — they see nothing at all.
 */
export type Privacy = "details" | "busy" | "hidden";

/** A file dropped onto the calendar: prescription, ticket, invoice, photo. */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  /** MIME type, used to decide between a preview and an icon. */
  type: string;
  uploadedBy: string;
  uploadedAt: string;
  /** Set once the file lives in Supabase Storage; local files use IndexedDB. */
  path?: string;
}

export interface CalendarEvent {
  /** An RRULE, when this event repeats. One row, many occurrences. */
  rrule?: string;
  /**
   * Set on an expanded occurrence: the series it belongs to, and which one.
   * Absent on an ordinary event, where `id` is the row itself.
   */
  seriesId?: string;
  occurrenceStart?: string;
  id: string;
  calendarId: string;
  title: string;
  notes?: string;
  location?: string;
  /** ISO strings. For all-day events the time part is ignored. */
  start: string;
  end: string;
  allDay: boolean;
  /** Overrides the calendar colour when set. */
  color?: ColorKey;
  createdBy: string;
  /**
   * People this event was pushed to individually (the right-click → "Add to
   * someone's calendar" flow). Distinct from sharing a whole calendar.
   */
  sharedWith: string[];
  /** Overrides the calendar's privacy for this one event. */
  privacy?: Privacy;
  /** Flagged by whoever created it, and called out to everyone who sees it. */
  importance?: Importance;
  /** Files dropped onto this event. Never exposed on a masked event. */
  attachments?: Attachment[];
  /** Set when the event was imported from a subscribed calendar. */
  feedId?: string;
  /** When to remind everyone who can see this event. */
  reminders?: Reminder[];
  /** The viewer's own delivery choice for this event. */
  subscription?: EventSubscription;
  /** What the attached list is: things to do, to buy, or to pack. */
  listKind?: ListKind;
  items?: EventItem[];
  /**
   * Set by the store when the viewer may only see that this time is taken.
   * Masked events carry no details — see maskEvent() in lib/access.ts.
   */
  masked?: boolean;
}

export type Importance = "normal" | "urgent";

export type CalendarView = "month" | "week" | "day" | "agenda";

/**
 * A note on a shared piece of paper. Private when it has no group, shared with
 * everyone in the group when it has one — the same rule as a calendar.
 */
export interface Note {
  id: string;
  groupId?: string;
  /** The events this note is pinned to. A note can serve several. */
  eventIds: string[];
  body: string;
  color: ColorKey;
  pinned: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Draft used by the event dialog before an id exists. */
export interface EventDraft {
  id?: string;
  /** An RRULE, when the event repeats. */
  rrule?: string;
  calendarId: string;
  title: string;
  notes: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  sharedWith: string[];
  /** Addresses with no account yet — they get an emailed invitation. */
  inviteEmails?: string[];
  /** Per-event override of the calendar's privacy; undefined = inherit. */
  privacy?: Privacy;
  importance?: Importance;
  attachments?: Attachment[];
  /** Ids are assigned when saved. */
  reminders?: ReminderDraft[];
}

export type ReminderChannel = "browser" | "email";

/**
 * A reminder is either personal or shared:
 *   userId set   → only that person is reminded, and only they can change it
 *   userId unset → everyone who can see the event is reminded
 * New events start with the creator's own, so nobody inherits somebody else's
 * alarms without choosing to.
 */
export interface Reminder {
  id: string;
  eventId: string;
  minutesBefore: number;
  channel: ReminderChannel;
  /** Undefined means everyone who can see the event. */
  userId?: string;
}

/** A row in the bin: enough to recognise it and put it back. */
export interface DeletedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
  deletedAt: string;
}

export type ListKind = "todo" | "shopping" | "packing";

/** One line on an event's list: a thing to do, buy or pack. */
export interface EventItem {
  id: string;
  eventId: string;
  text: string;
  /** Free text — "2 ×", "500g", "a case of". */
  quantity?: string;
  assignedTo?: string;
  done: boolean;
  doneBy?: string;
  position: number;
}

/** How one person wants to hear about one event. In-app is always on. */
export interface EventSubscription {
  email: boolean;
  mobile: boolean;
}

/** A message waiting in the bell menu. */
export interface AppNotification {
  id: string;
  kind: "share" | "update" | "cancel" | "invite" | "note";
  title: string;
  body?: string;
  eventId?: string;
  actorId?: string;
  readAt?: string;
  createdAt: string;
}

/** What a new event starts with: the creator's own, nobody else's. */
export const DEFAULT_REMINDERS: ReminderDraft[] = [
  { minutesBefore: 24 * 60, channel: "browser", forEveryone: false },
  { minutesBefore: 2 * 60, channel: "browser", forEveryone: false },
];

export interface ReminderDraft {
  minutesBefore: number;
  channel: ReminderChannel;
  /** Off means "just me"; on means everyone the event reaches. */
  forEveryone: boolean;
}

/** A Google or Outlook calendar we mirror by its iCal address. */
export interface Feed {
  id: string;
  calendarId: string;
  name: string;
  url: string;
  mode: "once" | "auto";
  intervalMinutes: number;
  lastSyncedAt?: string;
  lastStatus?: string;
  lastError?: string;
  eventCount: number;
}

/** An emailed invitation to join DocMaker Calendar. */
/** Somebody a group has been asked to let in, and where that has got to. */
export interface JoinRequest {
  id: string;
  groupId: string;
  inviteeId?: string;
  email?: string;
  proposedBy: string;
  status: "pending" | "approved" | "denied" | "withdrawn";
  /** Who has answered, and how. Only the group can see this. */
  votes: { userId: string; approve: boolean }[];
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string;
  invitedBy: string;
  groupId?: string;
  /** Set when the invitation is about one event rather than a group. */
  eventId?: string;
  status: "pending" | "sent" | "failed" | "accepted";
  createdAt: string;
  /** Token that ends up in the invite link. */
  token: string;
  error?: string;
}
