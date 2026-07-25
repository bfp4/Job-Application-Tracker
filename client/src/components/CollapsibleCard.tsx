"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "jat:collapsed:";

export interface CollapsibleState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

function readStored(storageKey: string): boolean | null {
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    return value === null ? null : value === "open";
  } catch {
    return null;
  }
}

function writeStored(storageKey: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "open" : "closed");
  } catch {
    // Storage can be unavailable (private mode, quota) — collapsing still works,
    // it just won't be remembered.
  }
}

/**
 * Open/closed state for one collapsible card, remembered per `storageKey` so a
 * user's layout choices survive navigation and reloads. Keys are shared across
 * applications on purpose: collapsing "Follow-ups" once collapses it for every
 * application. Pass an empty key to opt out of persistence.
 *
 * Only needed directly when a section has to open itself (e.g. a card that
 * expands when generation starts) — otherwise let `CollapsibleCard` own it.
 */
export function useCollapsible(storageKey: string, defaultOpen = true): CollapsibleState {
  const [open, setOpenState] = useState(defaultOpen);

  // Restored after mount rather than in the initial state: localStorage doesn't
  // exist during SSR, and reading it eagerly would mismatch the server markup.
  useEffect(() => {
    if (!storageKey) return;
    const saved = readStored(storageKey);
    if (saved !== null) setOpenState(saved);
  }, [storageKey]);

  function setOpen(next: boolean) {
    setOpenState(next);
    if (storageKey) writeStored(storageKey, next);
  }

  return { open, setOpen, toggle: () => setOpen(!open) };
}

/** Disclosure arrow: points right when closed, down when open. */
export function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
        open ? "rotate-90" : ""
      } ${className}`}
    >
      <path
        fillRule="evenodd"
        d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * A card whose body can be collapsed to just its header, so long pages stay
 * navigable. The header (title, `meta` summary and `actions`) stays visible
 * either way; put descriptions and everything else in `children`.
 *
 * The body is hidden with CSS instead of unmounted so in-progress edits, loaded
 * data and scroll positions survive a collapse.
 */
export default function CollapsibleCard({
  title,
  meta,
  actions,
  children,
  storageKey,
  defaultOpen = true,
  state,
  padding = "md",
  className = "border-gray-200",
  titleClassName = "text-lg font-semibold text-gray-900",
}: {
  title: ReactNode;
  /** Short summary shown next to the title — what the card holds when closed. */
  meta?: ReactNode;
  /** Header-right controls, visible whether the card is open or closed. */
  actions?: ReactNode;
  children: ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  /** Supply state from `useCollapsible` when the section must open itself. */
  state?: CollapsibleState;
  padding?: "md" | "sm";
  className?: string;
  titleClassName?: string;
}) {
  // Hooks can't be conditional: when `state` is supplied the caller owns
  // persistence, so the internal instance opts out with an empty key.
  const internal = useCollapsible(state ? "" : storageKey, defaultOpen);
  const { open, toggle } = state ?? internal;
  const bodyId = useId();

  const headerPadding = padding === "sm" ? "px-4 py-3" : "px-6 py-4";
  const bodyPadding = padding === "sm" ? "px-4 pb-4" : "px-6 pb-6";

  return (
    <div className={`rounded-xl border bg-white shadow-sm ${className}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${headerPadding}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} />
          <span className={`min-w-0 truncate ${titleClassName}`}>{title}</span>
          {meta && <span className="min-w-0 truncate text-sm text-gray-400">{meta}</span>}
        </button>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div id={bodyId} hidden={!open} className={bodyPadding}>
        {children}
      </div>
    </div>
  );
}
