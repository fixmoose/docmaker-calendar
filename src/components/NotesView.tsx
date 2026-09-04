"use client";

import clsx from "clsx";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import {
  CalendarDays,
  Check,
  Lock,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Send,
  ShoppingCart,
  StickyNote,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorVar } from "@/lib/colors";
import { localDay, useStore } from "@/lib/store";
import type { Note, ShoppingItem } from "@/lib/types";
import { Avatar, Button, controlClass } from "./ui";

/**
 * A shared sheet of paper. Notes are kept as a stream — who wrote what, and
 * when — rather than one document people take turns overwriting, because two
 * people writing at once is the normal case here, not the exception.
 *
 * Which sheet you are on is the sharing model: your own, or one per group.
 */

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE d MMMM");
}

function NoteCard({ note }: { note: Note }) {
  const store = useStore();
  const author = store.personById(note.createdBy);
  const mine = note.createdBy === store.currentUserId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  /** Stamped when the picker opens, so ordering does not read the clock mid-render. */
  const [openedAt, setOpenedAt] = useState(0);

  const attached = note.eventIds
    .map((id) => store.visibleEvents.find((e) => e.id === id))
    .filter((e) => e !== undefined);

  // Upcoming first: a note is almost always about something still to come.
  const candidates = useMemo(() => {
    const now = openedAt;
    const term = search.trim().toLowerCase();
    return store.visibleEvents
      .filter((e) => !e.masked && !note.eventIds.includes(e.id))
      .filter((e) => (term ? e.title.toLowerCase().includes(term) : true))
      .sort((a, b) => {
        const at = new Date(a.start).getTime();
        const bt = new Date(b.start).getTime();
        // Still to come first; anything past falls below it.
        return (at < now ? 1 : 0) - (bt < now ? 1 : 0) || at - bt;
      })
      .slice(0, 40);
  }, [store.visibleEvents, search, note.eventIds, openedAt]);

  return (
    <div className={clsx("flex gap-2.5", mine && "flex-row-reverse")}>
      {author ? (
        <Avatar
          person={author}
          size={28}
          status={store.presenceOf(author.id)}
          className="mt-1"
        />
      ) : (
        <span className="mt-1 h-7 w-7 shrink-0 rounded-full bg-surface-2" />
      )}

      <div className={clsx("relative max-w-[78%] min-w-0", mine && "text-right")}>
        <div
          className={clsx(
            "flex items-baseline gap-2 text-[11px] text-ink-faint",
            mine && "flex-row-reverse",
          )}
        >
          <span className="font-medium text-ink-muted">
            {mine ? "You" : (author?.name ?? "Someone")}
          </span>
          <span>{format(new Date(note.createdAt), "HH:mm")}</span>
          {note.updatedAt !== note.createdAt && <span>· edited</span>}
        </div>

        <div
          style={colorVar(note.color)}
          className={clsx(
            "group relative mt-1 rounded-2xl border px-3.5 py-2.5 text-left",
            mine
              ? "cc-tint cc-tint-border rounded-tr-sm"
              : "rounded-tl-sm border-line bg-surface",
            note.pinned && "ring-2 ring-[var(--c)]",
          )}
        >
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(2, draft.split("\n").length)}
                className={`${controlClass} w-full resize-none text-left text-[14px]`}
                autoFocus
              />
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  className="h-7 text-[12px]"
                  onClick={() => {
                    setDraft(note.body);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="h-7 text-[12px]"
                  onClick={() => {
                    if (draft.trim()) store.editNote(note.id, draft.trim());
                    setEditing(false);
                  }}
                >
                  <Check size={13} /> Save
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
              {note.body}
            </p>
          )}

          {note.pinned && (
            <Pin
              size={12}
              className="absolute -top-1.5 -left-1.5 rotate-[-20deg] text-[var(--c)]"
            />
          )}

          {/* The handshake: pin this note to something in the calendar. */}
          {mine && !editing && (
            <button
              type="button"
              title={attached ? "Change which event this belongs to" : "Attach this note to an event"}
              onClick={() => {
                setOpenedAt(Date.now());
                setPicking((v) => !v);
              }}
              className={clsx(
                "absolute top-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-ink-faint transition hover:border-brand hover:text-brand",
                mine ? "-left-2.5" : "-right-2.5",
              )}
            >
              <Plus size={12} />
            </button>
          )}

          {mine && !editing && (
            <div
              className={clsx(
                "absolute -top-2 flex gap-0.5 rounded-lg border border-line bg-surface p-0.5 opacity-0 shadow-[var(--shadow-sm)] transition group-hover:opacity-100",
                mine ? "-left-2" : "-right-2",
              )}
            >
              <button
                type="button"
                title={note.pinned ? "Unpin" : "Pin to the top"}
                onClick={() => store.pinNote(note.id, !note.pinned)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink"
              >
                {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
              </button>
              <button
                type="button"
                title="Edit"
                onClick={() => setEditing(true)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => store.removeNote(note.id)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-[#d1443c]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        {/* The day it is about, when it is about a day. */}
        {note.day && (
          <div className={clsx("mt-1 flex", mine && "justify-end")}>
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("cc:go-to-day", { detail: note.day }),
                  )
                }
                className="flex min-w-0 items-center gap-1.5 transition hover:text-brand"
              >
                <CalendarDays size={11} className="shrink-0" />
                <span className="truncate">
                  {format(parseISO(note.day), "EEE d MMM")}
                </span>
              </button>
              {mine && (
                <button
                  type="button"
                  title="Not about that day after all"
                  onClick={() => store.setNoteDay(note.id, undefined)}
                  className="shrink-0 opacity-60 transition hover:opacity-100"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          </div>
        )}

        {/* What it is pinned to, both ways round. */}
        {attached.length > 0 && (
          <div className={clsx("mt-1 flex flex-wrap gap-1", mine && "justify-end")}>
            {attached.map((event) => (
              <span
                key={event.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted"
              >
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("cc:open-event", { detail: event.id }),
                    )
                  }
                  className="flex min-w-0 items-center gap-1.5 transition hover:text-brand"
                >
                  <CalendarDays size={11} className="shrink-0" />
                  <span className="truncate">
                    {event.title} · {format(new Date(event.start), "d MMM")}
                  </span>
                </button>
                {mine && (
                  <button
                    type="button"
                    title="Unpin from this event"
                    onClick={() => store.unpinNoteFrom(note.id, event.id)}
                    className="shrink-0 opacity-60 transition hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {picking && (
          <div
            onMouseLeave={() => setPicking(false)}
            className={clsx(
              "cc-pop absolute z-20 mt-1 w-[280px] rounded-xl border border-line bg-surface p-1 text-left shadow-[var(--shadow-md)]",
              mine ? "right-0" : "left-0",
            )}
          >
            {/*
              * Not everything worth writing down is about an event. "Took the
              * subway" belongs to a Tuesday, not to whatever happened to be in
              * the diary that Tuesday.
              */}
            <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
              <CalendarDays size={13} className="shrink-0 text-ink-faint" />
              <input
                type="date"
                value={note.day ?? ""}
                onChange={(e) => store.setNoteDay(note.id, e.target.value || undefined)}
                className={`${controlClass} w-full py-1 text-[12px]`}
              />
            </div>
            <div className="mx-2 mb-1 h-px bg-line" />

            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Which event?"
              className={`${controlClass} mb-1 w-full py-1.5 text-[13px]`}
            />
            <p className="px-2 pt-0.5 pb-1.5 text-[11px] text-ink-faint">
              A day, an event, or both — pin to as many as you like.
            </p>
            <div className="cc-scroll max-h-[220px] overflow-y-auto">
              {candidates.length === 0 && (
                <p className="px-2 py-3 text-center text-[12px] text-ink-faint">
                  {attached.length ? "Pinned to everything available." : "Nothing to pin it to yet."}
                </p>
              )}
              {candidates.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    store.pinNoteTo(note.id, event.id);
                    setSearch("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {event.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">
                    {format(new Date(event.start), "d MMM")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function NotesPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const store = useStore();
  const [board, setBoard] = useState<string>("me");
  const [text, setText] = useState("");
  /** The day the next note is about, when it was started from the calendar. */
  const [dayFor, setDayFor] = useState<string | undefined>();
  const bottom = useRef<HTMLDivElement>(null);

  const boards = useMemo(
    () => [
      { id: "me", name: "Personal notes", icon: Lock, count: 0 },
      ...store.groups.map((g) => ({ id: g.id, name: g.name, icon: Users, count: 0 })),
      // A list is not a note — it is worked rather than read — so it gets its
      // own sheet rather than being written into the middle of a conversation.
      { id: SHOPPING, name: "Shopping list", icon: ShoppingCart, count: 0 },
    ],
    [store.groups],
  );

  const notes = useMemo(() => {
    const wanted = board === "me" ? undefined : board;
    return store.notes
      .filter((n) => n.groupId === wanted)
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }, [store.notes, board]);

  // Opened from a mark in the calendar: land on the sheet it came from.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const wanted = (e as CustomEvent<string>).detail;
      if (wanted) setBoard(wanted);
    };
    const onDay = (e: Event) => setDayFor((e as CustomEvent<string>).detail);
    window.addEventListener("cc:open-notes", onOpen);
    window.addEventListener("cc:note-for-day", onDay);
    return () => {
      window.removeEventListener("cc:open-notes", onOpen);
      window.removeEventListener("cc:note-for-day", onDay);
    };
  }, []);

  // A new note should bring the paper to where it landed.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [notes.length]);

  const write = () => {
    const body = text.trim();
    if (!body) return;
    store.addNote({
      body,
      groupId: board === "me" ? undefined : board,
      color: board === "me" ? "amber" : "teal",
      day: dayFor,
    });
    setText("");
    setDayFor(undefined);
  };

  const group = store.groups.find((g) => g.id === board);

  if (!open) return null;

  return (
    <>
      {/* On a phone the paper covers the calendar; on a desk it lies beside it. */}
      <button
        type="button"
        aria-label="Close notes"
        onClick={onClose}
        className="cc-fade fixed inset-0 z-40 bg-black/25 md:hidden"
      />

      <div
        className={clsx(
          "cc-pop fixed z-40 flex flex-col overflow-hidden border-line bg-surface shadow-[var(--shadow-lg)]",
          // Half the desk, and never so wide that the calendar is lost.
          "md:top-14 md:right-0 md:bottom-0 md:w-[min(560px,45vw)] md:border-l",
          "max-md:inset-x-0 max-md:bottom-0 max-md:top-[15vh] max-md:rounded-t-2xl max-md:border-t",
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <StickyNote size={15} className="shrink-0 text-brand" />
          <div className="cc-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {boards.map(({ id, name, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setBoard(id)}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition",
                  board === id
                    ? "bg-brand-soft font-medium text-brand"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon size={13} />
                {name}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close notes"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {board !== SHOPPING && (
          <p className="border-b border-line px-4 py-1.5 text-[11px] text-ink-faint">
            {group
              ? `Everyone in ${group.name} can read and add to this — ${group.memberIds.length} people.`
              : "Only you can see these, wherever you pin them."}
          </p>
        )}

        {board === SHOPPING && <ShoppingBoard />}

        {board !== SHOPPING && (
        <div className="cc-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {notes.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[15px] font-medium text-ink">A blank piece of paper</p>
              <p className="max-w-[280px] text-[13px] leading-relaxed text-ink-muted">
                {group
                  ? `Write something for ${group.name} — a shopping thought, a reminder to each other, anything that is not an event.`
                  : "Write anything down. Nobody else sees this one."}
              </p>
            </div>
          )}

          {notes.map((note, i) => {
            const previous = notes[i - 1];
            const newDay =
              !previous ||
              new Date(previous.createdAt).toDateString() !==
                new Date(note.createdAt).toDateString();

            return (
              <div key={note.id} className="space-y-4">
                {newDay && (
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[11px] font-medium text-ink-faint">
                      {dayLabel(note.createdAt)}
                    </span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <NoteCard note={note} />
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
        )}

        {board !== SHOPPING && (
        <div className="border-t border-line p-3">
          {dayFor && (
            <div className="mb-2 flex">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                <CalendarDays size={11} />
                About {format(parseISO(dayFor), "EEE d MMM")}
                <button
                  type="button"
                  title="Just a note, not about that day"
                  onClick={() => setDayFor(undefined)}
                  className="opacity-70 transition hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </span>
            </div>
          )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                write();
              }
            }}
            rows={1}
            placeholder={group ? `Write a note for ${group.name}…` : "Write a note…"}
            className={`${controlClass} max-h-[140px] min-h-[42px] w-full resize-y text-[14px]`}
          />
          <Button
            variant="primary"
            onClick={write}
            disabled={!text.trim()}
            className="h-[42px] shrink-0"
            title="Add the note (⌘/Ctrl + Enter)"
          >
            <Send size={15} />
          </Button>
        </div>
        </div>
        )}
      </div>
    </>
  );
}

/** The id of the sheet that is a list rather than a conversation. */
const SHOPPING = "cc-shopping";

/**
 * The shopping.
 *
 * One list per sheet is open at a time and it follows the day it was last
 * worked on, so the calendar shows where the shopping stands rather than where
 * it started. Finishing a list leaves it on its day for good and the next one
 * begins with the next shopping — which is how the month fills up with the
 * days somebody actually went out.
 */
function ShoppingBoard() {
  const store = useStore();
  const [sheet, setSheet] = useState<string>("me");
  const [text, setText] = useState("");
  const groupId = sheet === "me" ? undefined : sheet;
  const today = localDay(new Date());

  const lists = useMemo(
    () =>
      store.shoppingLists
        .filter((l) => (l.groupId ?? "me") === (groupId ?? "me"))
        .sort((a, b) => b.day.localeCompare(a.day)),
    [store.shoppingLists, groupId],
  );

  const open = lists.find((l) => !l.done);
  const finished = lists.filter((l) => l.done);

  const add = () => {
    const body = text.trim();
    if (!body) return;
    store.addShoppingItem(groupId, body);
    setText("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {store.groups.length > 0 && (
        <div className="cc-scroll flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
          {[{ id: "me", name: "Just me" }, ...store.groups.map((g) => ({ id: g.id, name: g.name }))].map(
            (option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSheet(option.id)}
                className={clsx(
                  "shrink-0 rounded-lg px-2.5 py-1 text-[12px] transition",
                  sheet === option.id
                    ? "bg-brand-soft font-medium text-brand"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {option.name}
              </button>
            ),
          )}
        </div>
      )}

      <div className="cc-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!open && finished.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-[15px] font-medium text-ink">Nothing on the list</p>
            <p className="max-w-[280px] text-[13px] leading-relaxed text-ink-muted">
              Write the first thing below. The list lands on today, and moves with
              you while it is open.
            </p>
          </div>
        )}

        {open && (
          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex items-center gap-2">
              <ShoppingCart size={14} className="shrink-0 text-brand" />
              <span className="text-[13px] font-semibold text-ink">
                {open.day === today ? "Today" : format(parseISO(open.day), "EEE d MMM")}
              </span>
              <span className="text-[11px] text-ink-faint">
                {open.items.filter((i) => !i.done).length} to get
              </span>
              <button
                type="button"
                onClick={() => store.finishShoppingList(open.id, true)}
                className="ml-auto rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:text-ink"
                title="Leave it on its day and start a new one next time"
              >
                Finish it
              </button>
            </div>

            {open.day !== today && (
              <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
                Still open from {format(parseISO(open.day), "EEEE")}. Adding
                something moves it to today; finish it to leave it where it is.
              </p>
            )}

            <ul className="space-y-0.5">
              {open.items.map((item) => (
                <Line key={item.id} listId={open.id} item={item} />
              ))}
            </ul>
          </div>
        )}

        {finished.map((list) => (
          <div key={list.id} className="rounded-2xl border border-line bg-surface-2/50 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <ShoppingCart size={13} className="shrink-0 text-ink-faint" />
              <span className="text-[12px] font-medium text-ink-muted">
                {format(parseISO(list.day), "EEE d MMM")}
              </span>
              <span className="text-[11px] text-ink-faint">
                {list.items.length} thing{list.items.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => store.finishShoppingList(list.id, false)}
                className="ml-auto text-[11px] text-ink-faint transition hover:text-brand"
              >
                Reopen
              </button>
              <button
                type="button"
                title="Delete this list"
                onClick={() => store.removeShoppingList(list.id)}
                className="text-ink-faint transition hover:text-[#d1443c]"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <ul className="space-y-0.5 opacity-70">
              {list.items.map((item) => (
                <Line key={item.id} listId={list.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 border-t border-line p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Milk, bread, batteries…"
          className={`${controlClass} h-[42px] w-full text-[14px]`}
        />
        <Button
          variant="primary"
          onClick={add}
          disabled={!text.trim()}
          className="h-[42px] shrink-0"
          title="Add it to the list"
        >
          <Plus size={15} />
        </Button>
      </div>
    </div>
  );
}

/** One thing to get: ticked where you are standing, so it is a button first. */
function Line({ listId, item }: { listId: string; item: ShoppingItem }) {
  const store = useStore();
  return (
    <li className="group flex items-center gap-2">
      <button
        type="button"
        onClick={() => store.tickShoppingItem(listId, item.id, !item.done)}
        className={clsx(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition",
          item.done
            ? "border-brand bg-brand text-white"
            : "border-line text-transparent hover:border-brand",
        )}
      >
        <Check size={12} />
      </button>
      <span
        className={clsx(
          "min-w-0 flex-1 truncate py-1 text-[13px]",
          item.done ? "text-ink-faint line-through" : "text-ink",
        )}
      >
        {item.text}
      </span>
      <button
        type="button"
        title="Take it off the list"
        onClick={() => store.removeShoppingItem(listId, item.id)}
        className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-[#d1443c]"
      >
        <X size={12} />
      </button>
    </li>
  );
}
