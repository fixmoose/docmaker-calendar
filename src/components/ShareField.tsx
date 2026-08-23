"use client";

import clsx from "clsx";
import { Mail, Search, Send, Users, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar, controlClass } from "./ui";

/**
 * Who this event goes to, decided per event: individual people, a whole group
 * at once, or somebody who has no account yet — typed in as an email address
 * and invited when the event is saved.
 *
 * Picking a group expands to its members rather than storing the group, so
 * adding someone to the group later does not quietly hand them old events.
 */
export function ShareField({
  sharedWith,
  inviteEmails,
  onChange,
}: {
  sharedWith: string[];
  inviteEmails: string[];
  onChange: (next: { sharedWith: string[]; inviteEmails: string[] }) => void;
}) {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const chosen = sharedWith
    .map((id) => store.personById(id))
    .filter((p) => p !== undefined);

  const term = query.trim().toLowerCase();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim());

  const people = useMemo(
    () =>
      store.contacts.filter(
        (p) =>
          !sharedWith.includes(p.id) &&
          (!term ||
            p.name.toLowerCase().includes(term) ||
            p.email.toLowerCase().includes(term)),
      ),
    [store.contacts, sharedWith, term],
  );

  const groups = useMemo(
    () =>
      store.groups
        .map((group) => ({
          group,
          missing: group.memberIds.filter(
            (id) => id !== store.currentUserId && !sharedWith.includes(id),
          ),
        }))
        .filter(
          ({ group, missing }) =>
            missing.length > 0 && (!term || group.name.toLowerCase().includes(term)),
        ),
    [store.groups, store.currentUserId, sharedWith, term],
  );

  const alreadyKnown =
    looksLikeEmail &&
    store.people.some((p) => p.email.toLowerCase() === query.trim().toLowerCase());

  const add = (ids: string[]) => {
    onChange({
      sharedWith: [...new Set([...sharedWith, ...ids])],
      inviteEmails,
    });
    setQuery("");
    input.current?.focus();
  };

  const addEmail = () => {
    const email = query.trim().toLowerCase();
    const known = store.people.find((p) => p.email.toLowerCase() === email);
    if (known) return add([known.id]);
    if (!inviteEmails.includes(email)) {
      onChange({ sharedWith, inviteEmails: [...inviteEmails, email] });
    }
    setQuery("");
  };

  const hasSuggestions = people.length > 0 || groups.length > 0 || looksLikeEmail;

  return (
    <div className="space-y-2">
      {(chosen.length > 0 || inviteEmails.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((person) => (
            <span
              key={person.id}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-1.5 pl-1 text-[13px] text-ink"
            >
              <Avatar person={person} size={20} />
              {person.name}
              <button
                type="button"
                onClick={() =>
                  onChange({
                    sharedWith: sharedWith.filter((id) => id !== person.id),
                    inviteEmails,
                  })
                }
                className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          ))}

          {inviteEmails.map((email) => (
            <span
              key={email}
              title="Not on DocMaker Calendar yet — they will be emailed an invitation"
              className="flex items-center gap-1.5 rounded-full border border-dashed border-brand/50 bg-brand-soft py-1 pr-1.5 pl-2.5 text-[13px] text-brand"
            >
              <Mail size={13} />
              {email}
              <button
                type="button"
                onClick={() =>
                  onChange({
                    sharedWith,
                    inviteEmails: inviteEmails.filter((e) => e !== email),
                  })
                }
                className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand/10"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
        />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (looksLikeEmail) addEmail();
              else if (people.length) add([people[0].id]);
              else if (groups.length) add(groups[0].missing);
            }
          }}
          placeholder="Add a person, a group, or type an email address"
          className={`${controlClass} w-full py-2 pl-8 text-[13px]`}
        />

        {open && hasSuggestions && (
          <div className="cc-pop absolute z-30 mt-1 max-h-[240px] w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-md)]">
            {groups.length > 0 && (
              <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
                Groups
              </div>
            )}
            {groups.map(({ group, missing }) => (
              <button
                key={group.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(missing)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2"
              >
                <Users size={15} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {group.name}
                </span>
                <span className="text-[11px] text-ink-faint">
                  +{missing.length}{" "}
                  {missing.length === 1 ? "person" : "people"}
                </span>
              </button>
            ))}

            {people.length > 0 && (
              <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
                People
              </div>
            )}
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add([person.id])}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2"
              >
                <Avatar person={person} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{person.name}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {person.email}
                  </span>
                </span>
              </button>
            ))}

            {looksLikeEmail && !alreadyKnown && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={addEmail}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2",
                  (people.length > 0 || groups.length > 0) && "mt-1 border-t border-line pt-2",
                )}
              >
                <Send size={15} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">
                    Invite {query.trim()}
                  </span>
                  <span className="block text-[11px] text-ink-faint">
                    They get an email with this event and a link to join
                  </span>
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-[12px] text-ink-faint">
        Everyone here sees the full event, whatever the privacy setting says.
      </p>
    </div>
  );
}
