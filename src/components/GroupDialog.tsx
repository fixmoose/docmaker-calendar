"use client";

import clsx from "clsx";
import { Check, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Group } from "@/lib/types";
import { Avatar, Button, Field, Modal, inputClass } from "./ui";

export function GroupDialog({
  group,
  onClose,
}: {
  group?: Group;
  onClose: () => void;
}) {
  const store = useStore();
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<string[]>(
    group?.memberIds ?? [store.currentUserId],
  );
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [withCalendar, setWithCalendar] = useState(false);

  const toggle = (id: string) =>
    setMembers((current) =>
      current.includes(id)
        ? current.filter((m) => m !== id)
        : [...current, id],
    );

  /** People who are not on DocMaker Calendar yet get an emailed invitation. */
  const invite = async () => {
    const value = email.trim();
    if (!value.includes("@")) return;
    const existing = store.people.find(
      (p) => p.email.toLowerCase() === value.toLowerCase(),
    );
    if (existing) {
      setMembers((current) =>
        current.includes(existing.id) ? current : [...current, existing.id],
      );
    } else if (group) {
      // Into an existing group: the group decides, then the mail goes.
      await store.proposeMember(group.id, { email: value });
      setSent((current) => [...current, value]);
    } else {
      // A group that does not exist yet has nobody to ask; the invitation is
      // made once it does, from the members list.
      await store.createInvites([value]);
      setSent((current) => [...current, value]);
    }
    setEmail("");
  };

  const save = () => {
    if (group) {
      store.renameGroup(group.id, name);
      store.setGroupMembers(group.id, members);
    } else {
      void store.createGroup(name, members, withCalendar);
    }
    onClose();
  };

  return (
    <Modal
      title={group ? "Group settings" : "New group"}
      onClose={onClose}
      footer={
        <>
          {group && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                store.deleteGroup(group.id);
                onClose();
              }}
            >
              <Trash2 size={15} /> Delete group
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {group ? "Save" : "Create group"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
          A group is a set of people you plan with — everyone here can be picked
          when you share an event. It does not create a calendar on its own.
        </p>

        <Field label="Group name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Us, Family, Flatmates…"
            className={inputClass}
          />
        </Field>

        <Field label="Members">
          <div className="space-y-1">
            {store.people.map((person) => {
              const isMe = person.id === store.currentUserId;
              const on = members.includes(person.id) || isMe;
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={isMe}
                  onClick={() => toggle(person.id)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition",
                    on
                      ? "border-brand/40 bg-brand-soft"
                      : "border-line hover:bg-surface-2",
                    isMe && "opacity-70",
                  )}
                >
                  <Avatar person={person} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {person.name}
                      {isMe && " (you)"}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {person.email}
                    </span>
                  </span>
                  {on && <Check size={15} className="text-brand" />}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Invite by email">
          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
              placeholder="name@example.com"
              className={inputClass}
            />
            <Button variant="outline" onClick={() => void invite()} className="shrink-0">
              <UserPlus size={15} /> Add
            </Button>
          </div>
        </Field>

        {!group && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              checked={withCalendar}
              onChange={(e) => setWithCalendar(e.target.checked)}
              className="h-4 w-4 accent-[var(--cc-brand)]"
            />
            Also create a calendar this group writes to together
          </label>
        )}

        {sent.length > 0 && (
          <p className="text-[12px] text-ink-faint">
            Invitation queued for {sent.join(", ")} — they join the group when they
            accept.
          </p>
        )}
      </div>
    </Modal>
  );
}
