/**
 * Formats an ISO date string as e.g. "Jun 21, 2026". Returns "—" when empty.
 *
 * Rendered in UTC, not the viewer's zone. Every date this app shows is a
 * calendar date the user picked (applied date, follow-up date, posted date),
 * stored as UTC midnight — reading it in a negative-offset zone would land on
 * the previous day and show "Jul 27" for a follow-up the user set to Jul 28.
 * The reminder Lambda formats the same values in UTC (lambda/src/digest.ts),
 * so this also keeps the digest email and the UI showing the same day.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Formats an ISO date string for a `<input type="date">` value (YYYY-MM-DD). */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
