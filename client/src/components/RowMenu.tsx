"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconMore } from "@/components/icons";

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  /** Renders an anchor instead of a button. */
  href?: string;
  external?: boolean;
  danger?: boolean;
}

/**
 * The "⋮" overflow menu on a list row. Closes on outside click, Escape, and
 * after any selection.
 *
 * Rows are themselves links, so every trigger stops propagation — opening the
 * menu must never also navigate to the row's destination. Stopping propagation
 * is all it may do: calling preventDefault() here would cancel the default
 * action of the `href` items as their clicks bubble through, and they'd never
 * navigate.
 */
export default function RowMenu({
  items,
  label = "More actions",
}: {
  items: RowMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-subtle hover:text-ink"
      >
        <IconMore size={18} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 animate-fade-in overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop"
        >
          {items.map((item) => {
            const className = `flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-medium transition ${
              item.danger
                ? "text-danger hover:bg-danger-soft"
                : "text-ink hover:bg-subtle"
            }`;

            if (item.href) {
              return (
                <a
                  key={item.label}
                  role="menuitem"
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noreferrer" : undefined}
                  className={className}
                  onClick={() => setOpen(false)}
                >
                  {item.icon}
                  {item.label}
                </a>
              );
            }

            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={className}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
