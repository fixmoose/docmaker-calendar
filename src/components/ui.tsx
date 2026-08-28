"use client";

import clsx from "clsx";
import { RotateCcw, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { colorVar, COLOR_KEYS, COLORS } from "@/lib/colors";
import type { ColorKey, Person } from "@/lib/types";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Avatar({
  person,
  size = 22,
  className,
  status,
}: {
  person: Person;
  size?: number;
  className?: string;
  /**
   * Green while they are using the calendar, amber when they have wandered
   * off, hollow when the calendar is closed. Pass "offline" rather than
   * leaving it out: no dot at all reads as "we do not do this", which is a
   * different claim from "they are not there".
   */
  status?: "active" | "away" | "offline";
}) {
  if (status) {
    return (
      <span className="relative inline-flex shrink-0">
        <Avatar person={person} size={size} className={className} />
        <span
          title={
            status === "active"
              ? `${person.name} is in the calendar`
              : status === "away"
                ? `${person.name} has the calendar open but is away`
                : `${person.name} does not have the calendar open`
          }
          style={{ width: Math.max(7, size * 0.3), height: Math.max(7, size * 0.3) }}
          className={clsx(
            "absolute -right-px -bottom-px rounded-full ring-2 ring-[var(--surface)]",
            status === "active" && "bg-[#3f9142]",
            status === "away" && "bg-[#dc9a15]",
            status === "offline" && "border border-line-strong bg-[var(--surface-2)]",
          )}
        />
      </span>
    );
  }

  if (person.avatarUrl) {
    return (
      // Google profile pictures are remote and unoptimised on purpose.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt={person.name}
        title={person.name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={clsx("shrink-0 rounded-full object-cover select-none", className)}
      />
    );
  }

  return (
    <span
      style={{ ...colorVar(person.avatarColor), width: size, height: size, fontSize: size * 0.42 }}
      className={clsx(
        "cc-solid inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none",
        className,
      )}
      title={person.name}
      aria-label={person.name}
    >
      {initials(person.name)}
    </span>
  );
}

export function IconButton({
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition",
        "hover:bg-surface-2 hover:text-ink active:scale-[0.97]",
        active && "bg-brand-soft text-brand",
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  variant = "ghost",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
}) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" &&
          "bg-brand text-white shadow-[var(--shadow-sm)] hover:bg-brand-strong",
        variant === "outline" &&
          "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink-muted hover:bg-surface-2 hover:text-ink",
        variant === "danger" &&
          "text-[#d1443c] hover:bg-[color-mix(in_oklab,#d1443c_12%,var(--surface))]",
        className,
      )}
      {...props}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={clsx(
            "h-7 rounded-[9px] px-3 text-[13px] font-medium transition",
            value === option.value
              ? "bg-brand-soft text-brand"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: ColorKey;
  onChange: (color: ColorKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          title={COLORS[key].label}
          aria-label={COLORS[key].label}
          onClick={() => onChange(key)}
          style={colorVar(key)}
          className={clsx(
            "cc-dot h-6 w-6 rounded-full transition",
            value === key
              ? "ring-2 ring-offset-2 ring-[var(--c)] ring-offset-[var(--surface)]"
              : "opacity-80 hover:opacity-100",
          )}
        />
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[12px] font-semibold tracking-tight text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Field styling without a width, so callers can size controls themselves. */
export const controlClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-4 focus:ring-[var(--ring)]";

export const inputClass = `${controlClass} w-full`;

/** Bottom-centre status line: uploads, "added to …", errors. */
export function Toast({
  message,
  busy,
  sticky,
  onDismiss,
}: {
  message: string | null;
  busy?: boolean;
  /** Errors stay until dismissed — four seconds is not long enough to read one. */
  sticky?: boolean;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!message || busy || sticky) return;
    const id = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(id);
  }, [message, busy, sticky, onDismiss]);

  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={clsx(
          "cc-pop pointer-events-auto flex max-w-[560px] items-start gap-2.5 rounded-2xl border px-4 py-2.5 text-[13px] shadow-[var(--shadow-md)]",
          sticky
            ? "border-[#d1443c]/30 bg-[color-mix(in_oklab,#d1443c_8%,var(--surface))] text-ink"
            : "border-line bg-surface text-ink",
        )}
      >
        {busy && (
          <span className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand" />
        )}
        <span className="min-w-0 flex-1 leading-relaxed break-words">{message}</span>

        {sticky && (
          <button
            type="button"
            title="Copy this message"
            onClick={() => {
              void navigator.clipboard?.writeText(message);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}

        {!busy && (
          <button
            type="button"
            onClick={onDismiss}
            className="-mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-surface-2"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** "Deleted Dinner — Undo", the way a mail client offers it back. */
export function UndoBar({
  label,
  onUndo,
}: {
  label: string;
  onUndo: () => void;
}) {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setGone(true), 12_000);
    return () => window.clearTimeout(id);
  }, []);

  if (gone) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="cc-pop pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-ink px-4 py-2 text-[13px] text-[var(--surface)] shadow-[var(--shadow-md)]">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => {
            onUndo();
            setGone(true);
          }}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-brand hover:bg-white/10"
        >
          <RotateCcw size={13} /> Undo
        </button>
        <button
          type="button"
          onClick={() => setGone(true)}
          className="-mr-1.5 flex h-6 w-6 items-center justify-center rounded-full opacity-60 hover:bg-white/10 hover:opacity-100"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
  autoFocus = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /**
   * Whether to put the cursor in the first field. Right for a dialog you came
   * to in order to type something; wrong for a long page of settings, where it
   * scrolls you past the top to whichever box happens to accept text.
   */
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // The first real field — not the close button, which sits first in the DOM.
    if (autoFocus) {
      ref.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    }
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, autoFocus]);

  return (
    <div
      className="cc-fade fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        style={{ width }}
        className="cc-pop flex max-h-[82vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-ink">{title}</div>
          <IconButton onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-0.5">
            <X size={16} />
          </IconButton>
        </div>
        <div className="cc-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
