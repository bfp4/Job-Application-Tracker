"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Icon button that copies `value` to the clipboard and flashes a checkmark
 * as confirmation. Renders nothing while `value` is empty. Position it via
 * `className`, or use `CopyField` to overlay it on an input/textarea.
 */
export default function CopyButton({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimeout = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimeout.current !== null) clearTimeout(resetTimeout.current);
    },
    []
  );

  if (!value) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Clipboard unavailable (e.g. insecure context) — do nothing.
    }
    setCopied(true);
    if (resetTimeout.current !== null) clearTimeout(resetTimeout.current);
    resetTimeout.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      // Keep focus in the field so copying doesn't trigger its onBlur save.
      onMouseDown={(e) => e.preventDefault()}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      className={`rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 ${className}`}
    >
      {copied ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4 text-green-600"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
          />
        </svg>
      )}
    </button>
  );
}

/**
 * Wraps a text input or textarea and overlays a CopyButton on its right
 * edge — vertically centered for single-line inputs, pinned to the top for
 * textareas. Give the wrapped field `pr-9` so text doesn't run under the
 * button.
 */
export function CopyField({
  value,
  multiline = false,
  children,
}: {
  value: string;
  multiline?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      <CopyButton
        value={value}
        className={`absolute right-1.5 ${
          multiline ? "top-1.5" : "top-1/2 -translate-y-1/2"
        }`}
      />
    </div>
  );
}
