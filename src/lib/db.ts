"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { COLOR_KEYS } from "./colors";
import type {
  AppNotification,
  Attachment,
  EventItem,
  EventSubscription,
  Calendar,
  CalendarEvent,
  ColorKey,
  EventDraft,
  Feed,
  Group,
  Importance,
  Invite,
  ListKind,
  Note,
  DeletedEvent,
  Person,
  Privacy,
  Reminder,
  ReminderDraft,
  JoinRequest,
} from "./types";

/**
 * Every query the app makes, in one place.
 *
 * Reads of events go through the `cc_calendar_feed` view, never `cc_events`:
 * the view is what applies the busy masking, so anything the viewer may only
 * see as "busy" arrives already stripped of its details. Writes go to the
 * tables, where row level security decides what is allowed.
 */

export const ATTACHMENT_BUCKET = "cc_attachments";

type Client = SupabaseClient;

const asColor = (value: string | null): ColorKey =>
  (COLOR_KEYS as string[]).includes(value ?? "") ? (value as ColorKey) : "slate";

/* ------------------------------------------------------------------ *
 * Row mappers
 * ------------------------------------------------------------------ */

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  shared_busy?: boolean;
}

const toPerson = (row: ProfileRow): Person => ({
  id: row.id,
  name: row.display_name,
  email: row.email,
  avatarColor: asColor(row.avatar_color),
  avatarUrl: row.avatar_url ?? undefined,
  sharedBusy: row.shared_busy ?? true,
});

interface CalendarRow {
  id: string;
  name: string;
  kind: "personal" | "shared";
  color: string;
  owner_id: string;
  group_id: string | null;
  privacy: Privacy;
}

const toCalendar = (row: CalendarRow, visible: boolean): Calendar => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  color: asColor(row.color),
  ownerId: row.owner_id,
  groupId: row.group_id ?? undefined,
  privacy: row.privacy,
  visible,
});

/** A row of cc_calendar_feed: one event, as this viewer may see it. */
interface EventRow {
  id: string;
  calendar_id: string;
  owner_id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  color: string | null;
  privacy: Privacy | null;
  importance: Importance;
  created_by: string;
  feed_id: string | null;
  list_kind: ListKind | null;
  masked: boolean;
  rrule?: string | null;
}

interface AttachmentRow {
  id: string;
  event_id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  name: row.name,
  size: Number(row.size_bytes),
  type: row.mime_type,
  uploadedBy: row.uploaded_by,
  uploadedAt: row.created_at,
  path: row.storage_path,
});

interface InviteRow {
  id: string;
  email: string;
  token: string;
  invited_by: string;
  group_id: string | null;
  event_id: string | null;
  status: Invite["status"];
  error: string | null;
  created_at: string;
}

const toInvite = (row: InviteRow): Invite => ({
  id: row.id,
  email: row.email,
  token: row.token,
  invitedBy: row.invited_by,
  groupId: row.group_id ?? undefined,
  eventId: row.event_id ?? undefined,
  status: row.status,
  error: row.error ?? undefined,
  createdAt: row.created_at,
});

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

export interface Workspace {
  people: Person[];
  groups: Group[];
  calendars: Calendar[];
  events: CalendarEvent[];
  invites: Invite[];
  feeds: Feed[];
  notifications: AppNotification[];
  /** "<reminder id>:<occurrence ISO>" for everything already answered. */
  acknowledged: string[];
  notes: Note[];
  /** People every new event of mine is shared with automatically. */
  autoShare: string[];
  /** Who the groups have been asked to let in. */
  joinRequests: JoinRequest[];
  /** Occurrences of repeating events that are not happening. */
  skippedOccurrences: string[];
  /** Tables the database does not have yet, so the UI can say which. */
  missing: string[];
}

interface FeedRow {
  id: string;
  calendar_id: string;
  name: string;
  url: string;
  mode: "once" | "auto";
  interval_minutes: number;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  event_count: number;
}

const toFeed = (row: FeedRow): Feed => ({
  id: row.id,
  calendarId: row.calendar_id,
  name: row.name,
  url: row.url,
  mode: row.mode,
  intervalMinutes: row.interval_minutes,
  lastSyncedAt: row.last_synced_at ?? undefined,
  lastStatus: row.last_status ?? undefined,
  lastError: row.last_error ?? undefined,
  eventCount: row.event_count,
});

interface ReminderRow {
  id: string;
  event_id: string;
  minutes_before: number;
  channel: "browser" | "email";
  user_id: string | null;
}

const toReminder = (row: ReminderRow): Reminder => ({
  id: row.id,
  eventId: row.event_id,
  minutesBefore: row.minutes_before,
  channel: row.channel,
  userId: row.user_id ?? undefined,
});

/**
 * Replaces the reminders this user is allowed to set — their own, plus the
 * event-wide ones if they can edit the event. Other people's personal
 * reminders are invisible here and left alone.
 */
export async function setReminders(
  supabase: Client,
  eventId: string,
  reminders: ReminderDraft[],
  userId: string,
) {
  const { error: clearError } = await supabase
    .from("cc_event_reminders")
    .delete()
    .eq("event_id", eventId)
    .or(`user_id.eq.${userId},user_id.is.null`);
  if (clearError) throw clearError;

  if (!reminders.length) return;
  const { error } = await supabase.from("cc_event_reminders").insert(
    reminders.map((r) => ({
      event_id: eventId,
      minutes_before: r.minutesBefore,
      channel: r.channel,
      user_id: r.forEveryone ? null : userId,
    })),
  );
  if (error) throw error;
}

interface NotificationRow {
  id: string;
  kind: AppNotification["kind"];
  title: string;
  body: string | null;
  event_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

const toNotification = (row: NotificationRow): AppNotification => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body ?? undefined,
  eventId: row.event_id ?? undefined,
  actorId: row.actor_id ?? undefined,
  readAt: row.read_at ?? undefined,
  createdAt: row.created_at,
});

interface ItemRow {
  id: string;
  event_id: string;
  text: string;
  quantity: string | null;
  assigned_to: string | null;
  done: boolean;
  done_by: string | null;
  position: number;
}

const toItem = (row: ItemRow): EventItem => ({
  id: row.id,
  eventId: row.event_id,
  text: row.text,
  quantity: row.quantity ?? undefined,
  assignedTo: row.assigned_to ?? undefined,
  done: row.done,
  doneBy: row.done_by ?? undefined,
  position: row.position,
});

export async function insertItem(
  supabase: Client,
  eventId: string,
  item: { text: string; quantity?: string; assignedTo?: string; position: number },
) {
  const { error } = await supabase.from("cc_event_items").insert({
    event_id: eventId,
    text: item.text,
    quantity: item.quantity ?? null,
    assigned_to: item.assignedTo ?? null,
    position: item.position,
  });
  if (error) throw error;
}

export async function patchItem(
  supabase: Client,
  id: string,
  changes: Record<string, unknown>,
) {
  const { error } = await supabase.from("cc_event_items").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteItem(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_event_items").delete().eq("id", id);
  if (error) throw error;
}

/**
 * An answered reminder, keyed by occurrence. Written once and seen by every
 * device, so a reminder confirmed on a phone stops asking on the laptop.
 */
export async function acknowledgeReminder(
  supabase: Client,
  reminderId: string,
  dueAt: string,
) {
  const { error } = await supabase
    .from("cc_reminder_acks")
    .upsert(
      { reminder_id: reminderId, due_at: dueAt },
      { onConflict: "reminder_id,user_id,due_at" },
    );
  if (error) throw error;
}

/** The viewer's own delivery choice for one event. */
export async function setSubscription(
  supabase: Client,
  eventId: string,
  patch: Partial<EventSubscription>,
) {
  const { error } = await supabase
    .from("cc_event_subscriptions")
    .upsert(
      { event_id: eventId, email: false, mobile: false, ...patch },
      { onConflict: "event_id,user_id" },
    );
  if (error) throw error;
}

interface NoteRow {
  id: string;
  group_id: string | null;
  body: string;
  color: string;
  pinned: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  groupId: row.group_id ?? undefined,
  eventIds: [],
  body: row.body,
  color: asColor(row.color),
  pinned: row.pinned,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function insertNote(
  supabase: Client,
  note: { body: string; groupId?: string; color: ColorKey; eventId?: string },
) {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("cc_notes").insert({
    id,
    body: note.body,
    group_id: note.groupId ?? null,
    color: note.color,
  });
  if (error) throw error;

  if (note.eventId) await pinNoteToEvent(supabase, id, note.eventId);
  return id;
}

export async function pinNoteToEvent(supabase: Client, noteId: string, eventId: string) {
  const { error } = await supabase
    .from("cc_note_events")
    .upsert({ note_id: noteId, event_id: eventId }, { onConflict: "note_id,event_id" });
  if (error) throw error;
}

export async function unpinNoteFromEvent(
  supabase: Client,
  noteId: string,
  eventId: string,
) {
  const { error } = await supabase
    .from("cc_note_events")
    .delete()
    .eq("note_id", noteId)
    .eq("event_id", eventId);
  if (error) throw error;
}

export async function patchNote(
  supabase: Client,
  id: string,
  changes: Record<string, unknown>,
) {
  const { error } = await supabase.from("cc_notes").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteNote(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_notes").delete().eq("id", id);
  if (error) throw error;
}

/** Whether events shared with me mark me busy to my groups. */
export async function setSharedBusy(supabase: Client, on: boolean) {
  const { error } = await supabase
    .from("cc_profiles")
    .update({ shared_busy: on })
    .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");
  if (error) throw error;
}

export async function markNotificationsRead(supabase: Client, ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase
    .from("cc_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

export async function clearNotifications(supabase: Client, ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("cc_notifications").delete().in("id", ids);
  if (error) throw error;
}

/** Subscribing to a calendar creates the calendar it lands in, then the feed. */
export async function insertFeed(
  supabase: Client,
  input: {
    name: string;
    url: string;
    color: ColorKey;
    mode: "once" | "auto";
    intervalMinutes: number;
  },
) {
  const calendarId = await insertCalendar(supabase, {
    name: input.name,
    color: input.color,
    privacy: "busy",
  });

  const { data, error } = await supabase
    .from("cc_calendar_feeds")
    .insert({
      calendar_id: calendarId,
      name: input.name,
      url: input.url,
      mode: input.mode,
      interval_minutes: input.intervalMinutes,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function deleteFeed(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_calendar_feeds").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Makes sure this app has a profile and a starter calendar for the signed-in
 * user. Cheap and idempotent, so it runs on every load rather than relying on
 * a trigger against the shared auth.users table.
 */
export async function bootstrapMe(supabase: Client) {
  const { error } = await supabase.rpc("cc_bootstrap_me");
  if (error) throw error;
}

/** The columns the event feed has always had. */
const FEED_COLUMNS =
  "id,calendar_id,owner_id,title,notes,location,starts_at,ends_at,all_day,color,privacy,importance,created_by,feed_id,list_kind,masked";

/**
 * The events, asking for the repeat rule but not depending on it.
 *
 * A deploy and a schema change are never simultaneous, and the feed is the one
 * thing the calendar cannot do without: asking for a column that is not there
 * yet would empty somebody's calendar until they ran a file. So the new column
 * is requested, and its absence costs only repeating events.
 */
async function loadFeed(supabase: Client) {
  const withRule = await supabase.from("cc_calendar_feed").select(`${FEED_COLUMNS},rrule`);
  // 42703: the column does not exist yet — the view predates delta-repeat.sql.
  if (withRule.error?.code !== "42703") return withRule;
  return supabase.from("cc_calendar_feed").select(FEED_COLUMNS);
}

/** Everything the calendar needs, in one round of parallel queries. */
export async function loadWorkspace(
  supabase: Client,
  hiddenCalendarIds: Set<string>,
  userId: string,
): Promise<Workspace> {
  const [profiles, groups, members, calendars, feed, guests, attachments, invites, reminders, subscriptions, acks, items, notifications, notes, noteLinks, feeds, autoShare, joinRequests, joinVotes, exceptions] =
    await Promise.all([
      supabase
        .from("cc_profiles")
        .select("id,email,display_name,avatar_color,avatar_url,shared_busy"),
      supabase.from("cc_groups").select("id,name,owner_id"),
      supabase.from("cc_group_members").select("group_id,user_id"),
      supabase
        .from("cc_calendars")
        .select("id,name,kind,color,owner_id,group_id,privacy")
        .order("created_at"),
      loadFeed(supabase),
      supabase.from("cc_event_guests").select("event_id,user_id"),
      supabase
        .from("cc_attachments")
        .select("id,event_id,name,size_bytes,mime_type,storage_path,uploaded_by,created_at"),
      supabase
        .from("cc_invitations")
        .select("id,email,token,invited_by,group_id,event_id,status,error,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("cc_event_reminders")
        .select("id,event_id,minutes_before,channel,user_id"),
      supabase.from("cc_event_subscriptions").select("event_id,email,mobile"),
      supabase
        .from("cc_reminder_acks")
        .select("reminder_id,due_at")
        .gte("due_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
      supabase
        .from("cc_event_items")
        .select("id,event_id,text,quantity,assigned_to,done,done_by,position")
        .order("position"),
      supabase
        .from("cc_notifications")
        .select("id,kind,title,body,event_id,actor_id,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("cc_notes")
        .select("id,group_id,body,color,pinned,created_by,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("cc_note_events").select("note_id,event_id"),
      supabase
        .from("cc_calendar_feeds")
        .select(
          "id,calendar_id,name,url,mode,interval_minutes,last_synced_at,last_status,last_error,event_count",
        )
        .order("created_at"),
      supabase.from("cc_auto_share").select("owner_id,user_id"),
      supabase
        .from("cc_group_join_requests")
        .select("id,group_id,invitee_id,email,proposed_by,status,created_at")
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false }),
      supabase.from("cc_group_join_votes").select("request_id,user_id,approve"),
      supabase.from("cc_event_exceptions").select("event_id,occurrence_start,override_id"),
    ]);

  /**
   * A table that has not been created yet should cost its own feature, not the
   * whole calendar: a schema update is usually a few minutes behind a deploy.
   * The essentials still fail loudly, because without them there is nothing to
   * show.
   */
  const essential = { profiles, calendars, feed };
  for (const [name, result] of Object.entries(essential)) {
    if (result.error) throw Object.assign(result.error, { table: name });
  }

  const optional: Record<string, { error: { code?: string } | null }> = {
    cc_groups: groups,
    cc_group_members: members,
    cc_event_guests: guests,
    cc_attachments: attachments,
    cc_invitations: invites,
    cc_event_reminders: reminders,
    cc_event_subscriptions: subscriptions,
    cc_reminder_acks: acks,
    cc_event_items: items,
    cc_notifications: notifications,
    cc_notes: notes,
    cc_note_events: noteLinks,
    cc_calendar_feeds: feeds,
    cc_auto_share: autoShare,
    cc_group_join_requests: joinRequests,
    cc_group_join_votes: joinVotes,
    cc_event_exceptions: exceptions,
  };

  const missing: string[] = [];
  for (const [name, result] of Object.entries(optional)) {
    if (!result.error) continue;
    // PGRST205 / 42P01: the table is not there yet.
    if (result.error.code === "PGRST205" || result.error.code === "42P01") {
      missing.push(name);
      continue;
    }
    throw result.error;
  }

  const memberships = new Map<string, string[]>();
  for (const row of (members.data ?? []) as { group_id: string; user_id: string }[]) {
    memberships.set(row.group_id, [...(memberships.get(row.group_id) ?? []), row.user_id]);
  }

  const sharesByEvent = new Map<string, string[]>();
  for (const row of (guests.data ?? []) as { event_id: string; user_id: string }[]) {
    sharesByEvent.set(row.event_id, [...(sharesByEvent.get(row.event_id) ?? []), row.user_id]);
  }

  const remindersByEvent = new Map<string, Reminder[]>();
  for (const row of (reminders.data ?? []) as ReminderRow[]) {
    remindersByEvent.set(row.event_id, [
      ...(remindersByEvent.get(row.event_id) ?? []),
      toReminder(row),
    ]);
  }

  const subscriptionByEvent = new Map<string, EventSubscription>();
  for (const row of (subscriptions.data ?? []) as {
    event_id: string;
    email: boolean;
    mobile: boolean;
  }[]) {
    subscriptionByEvent.set(row.event_id, { email: row.email, mobile: row.mobile });
  }

  const itemsByEvent = new Map<string, EventItem[]>();
  for (const row of (items.data ?? []) as ItemRow[]) {
    itemsByEvent.set(row.event_id, [...(itemsByEvent.get(row.event_id) ?? []), toItem(row)]);
  }

  const filesByEvent = new Map<string, Attachment[]>();
  for (const row of (attachments.data ?? []) as AttachmentRow[]) {
    filesByEvent.set(row.event_id, [
      ...(filesByEvent.get(row.event_id) ?? []),
      toAttachment(row),
    ]);
  }

  return {
    people: ((profiles.data ?? []) as ProfileRow[]).map(toPerson),
    groups: ((groups.data ?? []) as { id: string; name: string; owner_id: string }[]).map(
      (row) => ({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        memberIds: memberships.get(row.id) ?? [row.owner_id],
      }),
    ),
    calendars: ((calendars.data ?? []) as CalendarRow[]).map((row) =>
      toCalendar(row, !hiddenCalendarIds.has(row.id)),
    ),
    events: ((feed.data ?? []) as unknown as EventRow[]).map((row) => ({
      id: row.id,
      calendarId: row.calendar_id,
      title: row.title,
      notes: row.notes ?? undefined,
      location: row.location ?? undefined,
      start: row.starts_at,
      end: row.ends_at,
      allDay: row.all_day,
      color: row.color ? asColor(row.color) : undefined,
      privacy: row.privacy ?? undefined,
      importance: row.importance === "urgent" ? "urgent" : undefined,
      createdBy: row.created_by,
      sharedWith: sharesByEvent.get(row.id) ?? [],
      attachments: filesByEvent.get(row.id),
      feedId: row.feed_id ?? undefined,
      reminders: remindersByEvent.get(row.id),
      subscription: subscriptionByEvent.get(row.id),
      listKind: (row.list_kind ?? "todo") as ListKind,
      items: itemsByEvent.get(row.id),
      masked: row.masked || undefined,
      rrule: row.rrule ?? undefined,
    })),
    invites: ((invites.data ?? []) as InviteRow[]).map(toInvite),
    feeds: ((feeds.data ?? []) as unknown as FeedRow[]).map(toFeed),
    notifications: ((notifications.data ?? []) as NotificationRow[]).map(toNotification),
    acknowledged: ((acks.data ?? []) as { reminder_id: string; due_at: string }[]).map(
      (row) => `${row.reminder_id}:${new Date(row.due_at).toISOString()}`,
    ),
    notes: ((notes.data ?? []) as NoteRow[]).map((row) => ({
      ...toNote(row),
      eventIds: ((noteLinks.data ?? []) as { note_id: string; event_id: string }[])
        .filter((l) => l.note_id === row.id)
        .map((l) => l.event_id),
    })),
    // Only my own standing arrangements — the table also holds rows naming me,
    // which are somebody else's decision to share with me.
    autoShare: ((autoShare.data ?? []) as { owner_id: string; user_id: string }[])
      .filter((row) => row.owner_id === userId)
      .map((row) => row.user_id),
    joinRequests: ((joinRequests.data ?? []) as JoinRequestRow[]).map((row) => ({
      id: row.id,
      groupId: row.group_id,
      inviteeId: row.invitee_id ?? undefined,
      email: row.email ?? undefined,
      proposedBy: row.proposed_by,
      status: row.status,
      votes: ((joinVotes.data ?? []) as VoteRow[])
        .filter((v) => v.request_id === row.id)
        .map((v) => ({ userId: v.user_id, approve: v.approve })),
      createdAt: row.created_at,
    })),
    // "<event id>::<occurrence ISO>" for the occurrences that are not
    // happening — skipped outright, or moved and living as their own event.
    skippedOccurrences: (
      (exceptions.data ?? []) as { event_id: string; occurrence_start: string }[]
    ).map((row) => `${row.event_id}::${new Date(row.occurrence_start).toISOString()}`),
    missing,
  };
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

/** created_by is filled by the database from the session — see the schema. */
const eventPayload = (draft: EventDraft) => ({
  calendar_id: draft.calendarId,
  title: draft.title.trim() || "(no title)",
  notes: draft.notes.trim() || null,
  location: draft.location.trim() || null,
  starts_at: draft.start.toISOString(),
  ends_at: draft.end.toISOString(),
  all_day: draft.allDay,
  privacy: draft.privacy ?? null,
  importance: draft.importance ?? "normal",
  rrule: draft.rrule ?? null,
});

/** Names the step that failed, so a refusal says which write was refused. */
async function step<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e && typeof e === "object") {
      (e as { message?: string }).message = `${what}: ${(e as { message?: string }).message ?? e}`;
    }
    throw e;
  }
}

export async function insertEvent(
  supabase: Client,
  draft: EventDraft,
  userId: string,
  /** Of those shares, which are the standing arrangement rather than a choice. */
  automatic: string[] = [],
) {
  // The id is chosen here rather than asked for back. Requesting the inserted
  // row means INSERT ... RETURNING, which forces the select policy to judge a
  // row that is still being written — and no read policy can see it yet.
  const eventId = crypto.randomUUID();

  await step("creating the event", async () => {
    const payload = { id: eventId, ...eventPayload(draft) };
    const { error } = await supabase.from("cc_events").insert(payload);
    if (error) {
      (error as { attempted?: unknown }).attempted = {
        calendar_id: payload.calendar_id,
        keys: Object.keys(payload),
        titleLength: payload.title?.length ?? 0,
      };
      throw error;
    }
  });

  await step("sharing it", () =>
    setShares(supabase, eventId, draft.sharedWith, userId, automatic),
  );
  await step("attaching files", () =>
    linkAttachments(supabase, eventId, draft.attachments ?? [], userId),
  );
  await step("saving reminders", () =>
    setReminders(supabase, eventId, draft.reminders ?? [], userId),
  );
  return eventId;
}

export async function updateEvent(
  supabase: Client,
  id: string,
  draft: EventDraft,
  userId: string,
  automatic: string[] = [],
) {
  await step("updating the event", async () => {
    const { error } = await supabase
      .from("cc_events")
      .update(eventPayload(draft))
      .eq("id", id);
    if (error) throw error;
  });

  await step("sharing it", () =>
    setShares(supabase, id, draft.sharedWith, userId, automatic),
  );
  await step("attaching files", () =>
    linkAttachments(supabase, id, draft.attachments ?? [], userId),
  );
  await step("saving reminders", () =>
    setReminders(supabase, id, draft.reminders ?? [], userId),
  );
}

export async function patchEvent(
  supabase: Client,
  id: string,
  changes: Record<string, unknown>,
) {
  const { error } = await supabase.from("cc_events").update(changes).eq("id", id);
  if (error) throw error;
}

/** Deleting keeps the row so it can come back; see restoreEvent. */
export async function deleteEvent(supabase: Client, id: string) {
  const { error } = await supabase
    .from("cc_events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreEvent(supabase: Client, id: string) {
  const { error } = await supabase
    .from("cc_events")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}

export async function purgeEvent(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_events").delete().eq("id", id);
  if (error) throw error;
}

/** What is in the bin: deleted events this person can still write. */
export async function loadDeleted(supabase: Client): Promise<DeletedEvent[]> {
  const { data, error } = await supabase
    .from("cc_events")
    .select("id,title,starts_at,ends_at,all_day,calendar_id,deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return ((data ?? []) as {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    calendar_id: string;
    deleted_at: string;
  }[]).map((row) => ({
    id: row.id,
    title: row.title,
    start: row.starts_at,
    end: row.ends_at,
    allDay: row.all_day,
    calendarId: row.calendar_id,
    deletedAt: row.deleted_at,
  }));
}

export async function duplicateEvent(supabase: Client, id: string, userId: string) {
  const { data, error } = await supabase
    .from("cc_events")
    .select("calendar_id,title,notes,location,starts_at,ends_at,all_day,color,privacy,importance")
    .eq("id", id)
    .single();
  if (error) throw error;

  const copyId = crypto.randomUUID();
  const { error: insertError } = await supabase
    .from("cc_events")
    .insert({ ...data, id: copyId, title: `${data.title} (copy)`, created_by: userId });
  if (insertError) throw insertError;
  return copyId;
}

/** Replaces the guest list with exactly these people. */
export async function setShares(
  supabase: Client,
  eventId: string,
  userIds: string[],
  sharedBy: string,
  /** Who is on this event by standing arrangement rather than by decision. */
  automatic: string[] = [],
) {
  const { error: clearError } = await supabase
    .from("cc_event_shares")
    .delete()
    .eq("event_id", eventId);
  if (clearError) throw clearError;

  if (!userIds.length) return;
  const { error } = await supabase.from("cc_event_shares").insert(
    userIds.map((user_id) => ({
      event_id: eventId,
      user_id,
      shared_by: sharedBy,
      automatic: automatic.includes(user_id),
    })),
  );
  if (error) throw error;
}

interface JoinRequestRow {
  id: string;
  group_id: string;
  invitee_id: string | null;
  email: string | null;
  proposed_by: string;
  status: JoinRequest["status"];
  created_at: string;
}

interface VoteRow {
  request_id: string;
  user_id: string;
  approve: boolean;
}

/* ------------------------------------------------------------------ *
 * Repeating events
 * ------------------------------------------------------------------ */

/**
 * Takes one occurrence out of a series — the bins that were not collected,
 * the payment that did not go out. The rule is untouched; this is the
 * exception to it.
 */
export async function skipOccurrence(
  supabase: Client,
  eventId: string,
  occurrenceStart: Date,
  overrideId?: string,
) {
  const { error } = await supabase.from("cc_event_exceptions").upsert(
    {
      event_id: eventId,
      occurrence_start: occurrenceStart.toISOString(),
      override_id: overrideId ?? null,
    },
    { onConflict: "event_id,occurrence_start" },
  );
  if (error) throw error;
}

export async function unskipOccurrence(
  supabase: Client,
  eventId: string,
  occurrenceStart: Date,
) {
  const { error } = await supabase
    .from("cc_event_exceptions")
    .delete()
    .eq("event_id", eventId)
    .eq("occurrence_start", occurrenceStart.toISOString());
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * Letting somebody into a group
 * ------------------------------------------------------------------ */

/** Ask the group to admit somebody. Returns the request id. */
export async function proposeMember(
  supabase: Client,
  groupId: string,
  who: { email?: string; userId?: string },
) {
  const { data, error } = await supabase.rpc("cc_propose_member", {
    p_group: groupId,
    p_email: who.email ?? null,
    p_invitee: who.userId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function voteOnJoinRequest(
  supabase: Client,
  requestId: string,
  approve: boolean,
) {
  const { data, error } = await supabase.rpc("cc_vote_join_request", {
    p_request: requestId,
    p_approve: approve,
  });
  if (error) throw error;
  return data as string;
}

export async function withdrawJoinRequest(supabase: Client, requestId: string) {
  const { error } = await supabase.rpc("cc_withdraw_join_request", {
    p_request: requestId,
  });
  if (error) throw error;
}

/** The newcomer's own answer, once the group has agreed. */
export async function answerGroupInvite(
  supabase: Client,
  requestId: string,
  accept: boolean,
) {
  const { error } = await supabase.rpc("cc_join_from_request", {
    p_request: requestId,
    p_accept: accept,
  });
  if (error) throw error;
}

/**
 * Turns requests the group has agreed to into real invitations and posts them.
 * Only ever creates the invitation through the database function, so a client
 * cannot mint one carrying a group of its own accord.
 */
export async function sendApprovedGroupInvites(
  supabase: Client,
  fromName: string,
  linkFor: (token: string) => string,
) {
  const { data } = await supabase.rpc("cc_pending_group_invites");
  const pending = (data ?? []) as { request_id: string; group_id: string; email: string }[];
  if (!pending.length) return 0;

  const posted: { email: string; token: string; link: string }[] = [];

  for (const row of pending) {
    const token = crypto.randomUUID().replace(/-/g, "");
    const { data: invitationId, error } = await supabase.rpc("cc_record_group_invitation", {
      p_request: row.request_id,
      p_token: token,
    });
    if (error || !invitationId) continue;
    posted.push({ email: row.email, token, link: linkFor(token) });
  }

  if (!posted.length) return 0;

  // The invitation rows exist whatever happens next, so a mail failure leaves
  // something the sidebar can resend rather than losing the decision.
  await fetch("/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invites: posted, fromName }),
  }).catch(() => {});

  return posted.length;
}

/* ------------------------------------------------------------------ *
 * Always share with
 * ------------------------------------------------------------------ */

export async function setAutoShare(supabase: Client, userIds: string[], ownerId: string) {
  const { error: clearError } = await supabase
    .from("cc_auto_share")
    .delete()
    .eq("owner_id", ownerId);
  if (clearError) throw clearError;
  if (!userIds.length) return;
  const { error } = await supabase
    .from("cc_auto_share")
    .insert(userIds.map((user_id) => ({ owner_id: ownerId, user_id })));
  if (error) throw error;
}

/**
 * Puts the people you always share with onto the events you already have —
 * offered when the arrangement is first made, because "Ellen sees everything"
 * that starts from today is not what anybody means by it.
 */
export async function backfillAutoShare(
  supabase: Client,
  userIds: string[],
  ownerId: string,
): Promise<number> {
  if (!userIds.length) return 0;

  const { data: calendars } = await supabase
    .from("cc_calendars")
    .select("id")
    .eq("owner_id", ownerId);
  const calendarIds = (calendars ?? []).map((c) => c.id as string);
  if (!calendarIds.length) return 0;

  const { data: events } = await supabase
    .from("cc_events")
    .select("id")
    .in("calendar_id", calendarIds)
    .is("deleted_at", null);
  const eventIds = (events ?? []).map((e) => e.id as string);
  if (!eventIds.length) return 0;

  const rows = eventIds.flatMap((event_id) =>
    userIds.map((user_id) => ({ event_id, user_id, shared_by: ownerId, automatic: true })),
  );

  // Anything already shared stays as it is — including a deliberate share,
  // which must not be quietly downgraded to an automatic one.
  const { error } = await supabase
    .from("cc_event_shares")
    .upsert(rows, { onConflict: "event_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
  return eventIds.length;
}

/** What has been changed on an event, newest first. */
export async function loadEventChanges(supabase: Client, eventId: string) {
  const { data } = await supabase
    .from("cc_event_changes")
    .select("id,actor_id,summary,created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as {
    id: string;
    actor_id: string | null;
    summary: string;
    created_at: string;
  }[];
}

/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ */

/**
 * Uploads into the caller's own prefix. Files are uploaded before the event
 * exists (drop-to-create), which is why the storage policy keys on the user
 * folder and the database row does the linking afterwards.
 */
export async function uploadAttachment(
  supabase: Client,
  file: File,
  userId: string,
): Promise<Attachment> {
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(-80);
  const path = `${userId}/${id}-${safeName}`;

  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw error;

  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    uploadedBy: userId,
    uploadedAt: new Date().toISOString(),
    path,
  };
}

/** Writes rows for any attachment that is not recorded against the event yet. */
export async function linkAttachments(
  supabase: Client,
  eventId: string,
  attachments: Attachment[],
  userId: string,
) {
  if (!attachments.length) return;
  const { error } = await supabase.from("cc_attachments").upsert(
    attachments.map((a) => ({
      id: a.id,
      event_id: eventId,
      name: a.name,
      size_bytes: a.size,
      mime_type: a.type,
      storage_path: a.path!,
      uploaded_by: a.uploadedBy || userId,
    })),
    { onConflict: "id" },
  );
  if (error) throw error;
}

export async function removeAttachment(supabase: Client, attachment: Attachment) {
  const { error } = await supabase.from("cc_attachments").delete().eq("id", attachment.id);
  if (error) throw error;
  if (attachment.path) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.path]);
  }
}

/** Short-lived URL for previewing or downloading a private file. */
export async function attachmentUrl(supabase: Client, attachment: Attachment) {
  if (!attachment.path) return null;
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

/* ------------------------------------------------------------------ *
 * Calendars, groups, invitations
 * ------------------------------------------------------------------ */

export async function insertCalendar(
  supabase: Client,
  input: { name: string; color: ColorKey; groupId?: string; privacy: Privacy },
) {
  const { data, error } = await supabase
    .from("cc_calendars")
    .insert({
      name: input.name.trim() || "Untitled calendar",
      kind: input.groupId ? "shared" : "personal",
      color: input.color,
      group_id: input.groupId ?? null,
      privacy: input.privacy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function patchCalendar(
  supabase: Client,
  id: string,
  changes: Record<string, unknown>,
) {
  const { error } = await supabase.from("cc_calendars").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteCalendar(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_calendars").delete().eq("id", id);
  if (error) throw error;
}

export async function insertGroup(
  supabase: Client,
  name: string,
  memberIds: string[],
  userId: string,
) {
  const { data, error } = await supabase
    .from("cc_groups")
    .insert({ name: name.trim() || "New group" })
    .select("id")
    .single();
  if (error) throw error;

  const groupId = data.id as string;
  await setGroupMembers(supabase, groupId, memberIds, userId, []);
  return groupId;
}

export async function setGroupMembers(
  supabase: Client,
  groupId: string,
  memberIds: string[],
  ownerId: string,
  /** Who is in it now, so newcomers can be told apart from the rest. */
  currentIds: string[] = [],
) {
  const wanted = new Set([ownerId, ...memberIds]);

  // Taking somebody out is immediate: nobody's calendar is exposed by it.
  const removing = currentIds.filter((id) => !wanted.has(id) && id !== ownerId);
  if (removing.length) {
    const { error } = await supabase
      .from("cc_group_members")
      .delete()
      .eq("group_id", groupId)
      .in("user_id", removing);
    if (error) throw error;
  }

  // You may always put yourself in a group you own.
  if (!currentIds.includes(ownerId)) {
    const { error } = await supabase
      .from("cc_group_members")
      .insert({ group_id: groupId, user_id: ownerId, role: "owner" });
    if (error) throw error;
  }

  // Everybody else is a question for the group — which a group of one answers
  // on the spot, so making a group and naming people still feels like one act.
  for (const id of memberIds) {
    if (id === ownerId || currentIds.includes(id)) continue;
    await proposeMember(supabase, groupId, { userId: id });
  }
}

export async function patchGroup(
  supabase: Client,
  id: string,
  changes: Record<string, unknown>,
) {
  const { error } = await supabase.from("cc_groups").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteGroup(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_groups").delete().eq("id", id);
  if (error) throw error;
}

export async function insertInvites(
  supabase: Client,
  rows: { email: string; token: string; groupId?: string; eventId?: string }[],
) {
  const { data, error } = await supabase
    .from("cc_invitations")
    .insert(
      rows.map((row) => ({
        email: row.email,
        token: row.token,
        group_id: row.groupId ?? null,
        event_id: row.eventId ?? null,
        status: "pending",
      })),
    )
    .select("id,email,token,invited_by,group_id,event_id,status,error,created_at");
  if (error) throw error;
  return ((data ?? []) as InviteRow[]).map(toInvite);
}

export async function patchInvite(
  supabase: Client,
  id: string,
  changes: Record<string, unknown>,
) {
  const { error } = await supabase.from("cc_invitations").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteInvite(supabase: Client, id: string) {
  const { error } = await supabase.from("cc_invitations").delete().eq("id", id);
  if (error) throw error;
}

export async function acceptInvitation(supabase: Client, token: string) {
  const { data, error } = await supabase.rpc("cc_accept_invitation", { p_token: token });
  if (error) throw error;
  return data;
}
