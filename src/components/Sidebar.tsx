"use client";

import clsx from "clsx";
import {
  ArrowDownLeft,
  Check,
  Eye,
  EyeOff,
  Home,
  Lock,
  Mail,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Share2,
  TriangleAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import Image from "next/image";
import { colorVar, COLOR_KEYS, COLORS } from "@/lib/colors";
import { useStore } from "@/lib/store";
import type { Calendar, Group } from "@/lib/types";
import type { MenuItem, MenuState } from "./ContextMenu";
import { JoinRequests } from "./JoinRequests";
import { MiniMonth } from "./MiniMonth";
import { Avatar, Button } from "./ui";

function CalendarRow({
  calendar,
  focused,
  onFocus,
  onMenu,
}: {
  calendar: Calendar;
  focused: boolean;
  onFocus: () => void;
  onMenu: (e: React.MouseEvent, calendar: Calendar) => void;
}) {
  const { toggleCalendar, groups } = useStore();
  const group = groups.find((g) => g.id === calendar.groupId);

  return (
    <div
      className={clsx(
        "group flex items-center gap-2.5 rounded-lg py-[5px] pr-1 pl-2 transition",
        focused ? "bg-brand-soft" : "hover:bg-surface-2",
      )}
      onContextMenu={(e) => onMenu(e, calendar)}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={calendar.visible}
        aria-label={`Toggle ${calendar.name}`}
        onClick={() => toggleCalendar(calendar.id)}
        style={colorVar(calendar.color)}
        className={clsx(
          "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[5px] border-2 transition",
          calendar.visible
            ? "cc-solid border-[var(--c)]"
            : "border-[var(--c)] opacity-60 hover:opacity-100",
        )}
      >
        {calendar.visible && <Check size={10} strokeWidth={3.5} />}
      </button>

      <button
        type="button"
        onClick={onFocus}
        className={clsx(
          "min-w-0 flex-1 truncate text-left text-[13px] transition",
          focused
            ? "font-medium text-brand"
            : calendar.visible
              ? "text-ink"
              : "text-ink-faint",
        )}
        title={
          focused
            ? "Show everything again"
            : `Show only ${calendar.name} — the tick beside it hides and shows it instead`
        }
      >
        {calendar.name}
      </button>

      {calendar.privacy !== "busy" && (
        <span
          className="shrink-0 text-ink-faint"
          title={
            calendar.privacy === "details"
              ? "Your groups see the details on this calendar"
              : "Hidden from everyone else"
          }
        >
          {calendar.privacy === "details" ? <Eye size={12} /> : <Lock size={12} />}
        </span>
      )}

      {group && (
        <div className="flex -space-x-1.5 pr-0.5">
          {group.memberIds.slice(0, 3).map((id) => (
            <MemberAvatar key={id} id={id} />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => onMenu(e, calendar)}
        aria-label={`${calendar.name} options`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-surface hover:text-ink"
      >
        <Settings2 size={13} />
      </button>
    </div>
  );
}

function MemberAvatar({ id }: { id: string }) {
  const { personById } = useStore();
  const person = personById(id);
  if (!person) return null;
  return (
    <Avatar
      person={person}
      size={17}
      className="ring-2 ring-[var(--surface)]"
    />
  );
}

function PersonRow({
  personId,
  onOpen,
}: {
  personId: string;
  onOpen: (personId: string) => void;
}) {
  const store = useStore();
  const person = store.personById(personId);
  const traffic = store.trafficWith(personId);
  if (!person) return null;
  const busyShown = !store.busyHidden.includes(personId);

  return (
    <div className="group flex items-center gap-2.5 rounded-lg py-[5px] pr-1 pl-2 transition hover:bg-surface-2">
      <Avatar
        person={person}
        size={18}
        status={store.presenceOf(personId)}
        className={clsx("transition", !busyShown && "opacity-40 grayscale")}
      />
      <button
        type="button"
        onClick={() => onOpen(personId)}
        title={`See everything between you and ${person.name}`}
        className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
      >
        {person.name}
      </button>
      {/* what they sent you, and what you sent them */}
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint tabular-nums">
        {traffic.from > 0 && (
          <span
            className="flex items-center gap-0.5"
            title={`${traffic.from} shared with you by ${person.name}`}
          >
            <ArrowDownLeft size={11} />
            {traffic.from}
          </span>
        )}
        {traffic.to > 0 && (
          <span
            className="flex items-center gap-0.5"
            title={`${traffic.to} you shared with ${person.name}`}
          >
            <Share2 size={11} />
            {traffic.to}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => store.togglePersonBusy(personId)}
        title={`${busyShown ? "Hide" : "Show"} ${person.name}'s busy times`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface hover:text-ink"
      >
        {busyShown ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
    </div>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pt-4 pb-1">
      <span className="text-[11px] font-semibold tracking-wider text-ink-faint uppercase">
        {children}
      </span>
      {action}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-5 w-5 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-brand"
    >
      <Plus size={14} />
    </button>
  );
}

export function Sidebar({
  open,
  onClose,
  selected,
  onSelectDate,
  onNewEvent,
  onNewCalendar,
  onEditCalendar,
  onNewGroup,
  onEditGroup,
  focus,
  onFocus,
  onInvite,
  onOpenPerson,
  onSubscribe,
  openMenu,
}: {
  /** On a phone the sidebar slides over the calendar instead of sitting beside it. */
  open: boolean;
  onClose: () => void;
  selected: Date;
  onSelectDate: (d: Date) => void;
  onNewEvent: () => void;
  onNewCalendar: (groupId?: string) => void;
  onEditCalendar: (calendar: Calendar) => void;
  onNewGroup: () => void;
  onEditGroup: (group: Group) => void;
  /** What has the calendar to itself, if anything. */
  focus: { kind: "group" | "calendar"; id: string } | null;
  onFocus: (next: { kind: "group" | "calendar"; id: string } | null) => void;
  onInvite: () => void;
  onOpenPerson: (personId: string) => void;
  onSubscribe: () => void;
  openMenu: (state: MenuState) => void;
}) {
  const store = useStore();
  const personal = store.myCalendars;
  const shared = store.sharedCalendars;
  const pendingInvites = store.invites.filter(
    (i) => i.status === "pending" || i.status === "sent" || i.status === "failed",
  );

  const calendarMenu = (e: React.MouseEvent, calendar: Calendar) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      {
        label: "Edit calendar",
        icon: <Pencil size={13} />,
        onSelect: () => onEditCalendar(calendar),
      },
      {
        label: "Show only this",
        icon: <Eye size={13} />,
        onSelect: () => store.showOnlyCalendar(calendar.id),
      },
      {
        kind: "submenu",
        label: "Who else can see it",
        icon: <Eye size={13} />,
        items: [
          {
            label: "Show details",
            icon: <Eye size={13} />,
            checked: calendar.privacy === "details",
            onSelect: () => store.setCalendarPrivacy(calendar.id, "details"),
          },
          {
            label: "Busy only",
            icon: <EyeOff size={13} />,
            checked: calendar.privacy === "busy",
            onSelect: () => store.setCalendarPrivacy(calendar.id, "busy"),
          },
          {
            label: "Hidden",
            icon: <Lock size={13} />,
            checked: calendar.privacy === "hidden",
            onSelect: () => store.setCalendarPrivacy(calendar.id, "hidden"),
          },
        ],
      },
      {
        kind: "submenu",
        label: "Colour",
        icon: <Palette size={13} />,
        items: COLOR_KEYS.map((key) => ({
          label: COLORS[key].label,
          checked: calendar.color === key,
          icon: (
            <span
              style={colorVar(key)}
              className="cc-dot h-2.5 w-2.5 rounded-full"
            />
          ),
          onSelect: () => store.setCalendarColor(calendar.id, key),
        })),
      },
      { kind: "separator" },
      {
        label: "Delete calendar",
        icon: <Trash2 size={13} />,
        danger: true,
        disabled: store.calendars.length === 1,
        onSelect: () => store.deleteCalendar(calendar.id),
      },
    ];
    openMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close the menu"
          onClick={onClose}
          className="cc-fade fixed inset-0 z-30 bg-black/30 md:hidden"
        />
      )}

      <aside
        className={clsx(
          "flex h-full w-[268px] shrink-0 flex-col border-r border-line bg-surface",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[86vw] max-md:max-w-[320px] max-md:shadow-[var(--shadow-lg)] max-md:transition-transform",
          !open && "max-md:-translate-x-full",
        )}
      >
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Image
          src="/logo-mark.png"
          alt=""
          width={32}
          height={32}
          priority
          className="h-8 w-8"
        />
        <div className="text-[15px] leading-none font-bold tracking-tight text-ink">
          DocMaker <span className="text-brand">Calendar</span>
        </div>
      </div>

      <div className="space-y-2 px-4 pb-3">
        <Button
          variant="primary"
          onClick={onNewEvent}
          className="w-full justify-center"
        >
          <Plus size={16} /> New event
        </Button>
        <Button variant="outline" onClick={onInvite} className="w-full justify-center">
          <UserPlus size={15} /> Invite people
        </Button>
      </div>

      <div className="cc-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <button
          type="button"
          onClick={() => onFocus(null)}
          className={clsx(
            "mb-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition",
            focus
              ? "text-ink-muted hover:bg-surface-2 hover:text-ink"
              : "bg-surface-2 font-medium text-ink",
          )}
        >
          <Home size={14} className="shrink-0 text-ink-faint" />
          Everything
          {focus && (
            <span className="ml-auto text-[11px] text-brand">back to all</span>
          )}
        </button>

        <JoinRequests />

        <MiniMonth
          selected={selected}
          events={store.visibleEvents}
          onSelect={onSelectDate}
        />

        <SectionTitle action={<AddButton label="New calendar" onClick={() => onNewCalendar()} />}>
          My calendars
        </SectionTitle>
        {personal.map((c) => (
          <CalendarRow
            key={c.id}
            calendar={c}
            focused={focus?.kind === "calendar" && focus.id === c.id}
            onFocus={() => onFocus({ kind: "calendar", id: c.id })}
            onMenu={calendarMenu}
          />
        ))}

        <SectionTitle
          action={<AddButton label="New shared calendar" onClick={() => onNewCalendar(store.groups[0]?.id)} />}
        >
          Shared calendars
        </SectionTitle>
        {shared.length === 0 && (
          <p className="px-2 py-1 text-[12px] text-ink-faint">
            None yet — create one for a group.
          </p>
        )}
        {shared.map((c) => (
          <CalendarRow
            key={c.id}
            calendar={c}
            focused={focus?.kind === "calendar" && focus.id === c.id}
            onFocus={() => onFocus({ kind: "calendar", id: c.id })}
            onMenu={calendarMenu}
          />
        ))}

        <SectionTitle
          action={<AddButton label="Subscribe to a calendar" onClick={onSubscribe} />}
        >
          Subscribed
        </SectionTitle>
        {store.feeds.length === 0 && (
          <p className="px-2 py-1 text-[12px] leading-relaxed text-ink-faint">
            Bring in Google or Outlook with the + above.
          </p>
        )}
        {store.feeds.map((feed) => {
          const calendar = store.calendarById(feed.calendarId);
          return (
            <button
              key={feed.id}
              type="button"
              onClick={onSubscribe}
              title={
                feed.lastStatus === "error"
                  ? feed.lastError
                  : `${feed.eventCount} events · ${feed.mode === "auto" ? `syncs every ${feed.intervalMinutes / 60}h` : "imported once"}`
              }
              className="flex w-full items-center gap-2.5 rounded-lg py-[5px] pr-2 pl-2 text-left transition hover:bg-surface-2"
            >
              <span
                style={colorVar(calendar?.color ?? "blue")}
                className="cc-dot h-2.5 w-2.5 shrink-0 rounded-full"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {feed.name}
              </span>
              {feed.lastStatus === "error" ? (
                <TriangleAlert size={12} className="shrink-0 text-[#d1443c]" />
              ) : (
                feed.mode === "auto" && (
                  <RefreshCw size={11} className="shrink-0 text-ink-faint" />
                )
              )}
            </button>
          );
        })}

        <SectionTitle
          action={<AddButton label="Invite someone" onClick={onInvite} />}
        >
          People I can share with
        </SectionTitle>
        {store.contacts.length === 0 && (
          <p className="px-2 py-1 text-[12px] leading-relaxed text-ink-faint">
            Nobody yet. Invite your partner or family with{" "}
            <button
              type="button"
              onClick={onInvite}
              className="font-medium text-brand hover:underline"
            >
              the + above
            </button>
            , and they appear here once they accept.
          </p>
        )}
        {store.contacts.map((person) => (
          <PersonRow key={person.id} personId={person.id} onOpen={onOpenPerson} />
        ))}

        {pendingInvites.length > 0 && (
          <>
            <SectionTitle>Invited</SectionTitle>
            {pendingInvites.map((invite) => (
              <button
                key={invite.id}
                type="button"
                onClick={onInvite}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-[5px] text-left transition hover:bg-surface-2"
              >
                <Mail size={14} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                  {invite.email}
                </span>
                <span className="shrink-0 text-[10px] font-semibold tracking-wide text-ink-faint uppercase">
                  {invite.status}
                </span>
              </button>
            ))}
          </>
        )}

        <SectionTitle action={<AddButton label="New group" onClick={onNewGroup} />}>
          {store.groups.length === 1 ? "My group" : "My groups"}
        </SectionTitle>
        {store.groups.length === 0 && (
          <p className="px-2 py-1 text-[12px] leading-relaxed text-ink-faint">
            A group is just a name for several people, so you can share with all
            of them at once.
          </p>
        )}
        {store.groups.length > 0 && (
          <p className="px-2 pb-1 text-[11px] leading-relaxed text-ink-faint">
            Click a group to see only what it is involved in.
          </p>
        )}
        {store.groups.map((group) => {
          const focused = focus?.kind === "group" && focus.id === group.id;
          return (
            <div
              key={group.id}
              className={clsx(
                "group flex items-center gap-2.5 rounded-lg py-[6px] pr-1 pl-2 transition",
                focused ? "bg-brand-soft" : "hover:bg-surface-2",
              )}
            >
              <Users
                size={14}
                className={clsx("shrink-0", focused ? "text-brand" : "text-ink-faint")}
              />
              <button
                type="button"
                onClick={() => onFocus({ kind: "group", id: group.id })}
                title={
                  focused
                    ? "Show everything again"
                    : `Show only what ${group.name} is involved in`
                }
                className={clsx(
                  "min-w-0 flex-1 truncate text-left text-[13px]",
                  focused ? "font-medium text-brand" : "text-ink",
                )}
              >
                {group.name}
              </button>

              <span className="flex -space-x-1.5">
                {group.memberIds.slice(0, 4).map((id) => (
                  <MemberAvatar key={id} id={id} />
                ))}
              </span>

              <button
                type="button"
                onClick={() => onEditGroup(group)}
                aria-label={`${group.name} settings`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-surface hover:text-ink"
              >
                <Settings2 size={13} />
              </button>
            </div>
          );
        })}
        </div>
      </aside>
    </>
  );
}
