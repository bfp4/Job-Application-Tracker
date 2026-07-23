/** Formats an ISO date string as e.g. "Jun 21, 2026". Returns "—" when empty. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a calendar-date value (followUpDate, appliedDate) as e.g.
 * "Jun 21, 2026". These are stored as UTC midnight and encode a day, not an
 * instant — rendering them in local time (like formatDate does) shows the
 * previous day for users west of UTC.
 */
export function formatCalendarDate(value: string | null | undefined): string {
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
