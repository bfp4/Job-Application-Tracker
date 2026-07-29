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

/**
 * Today as a `YYYY-MM-DD` date-input value, in the viewer's *local* calendar
 * day. `new Date().toISOString()` would give the UTC day, which is already
 * tomorrow for anyone west of UTC in the evening — they'd have this evening's
 * action recorded with tomorrow's date.
 */
export function todayInputValue(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from today until a stored date. Negative means overdue, 0 means
 * today. Returns null when the value is missing or unparseable.
 *
 * "Today" is the viewer's *local* calendar day mapped onto the UTC midnight
 * the dates are stored at. Comparing against the real UTC instant instead
 * would tell someone in New York at 9pm that tomorrow's follow-up is due
 * today, because it is already tomorrow in UTC.
 */
export function daysUntil(
  value: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;

  const targetDay = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate()
  );
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetDay - today) / DAY_MS);
}

export type Urgency = "overdue" | "today" | "soon" | "later";

/**
 * How much attention a dated item deserves. "soon" is the next three days —
 * the same window the reminder email starts nudging in, so the dashboard and
 * the inbox agree about what counts as imminent.
 */
export function urgencyOf(
  value: string | null | undefined,
  now: Date = new Date()
): Urgency {
  const days = daysUntil(value, now);
  if (days === null) return "later";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= 3 ? "soon" : "later";
}

/** Human phrasing for a due date: "Today", "in 5 days", "3 days overdue". */
export function relativeDayLabel(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  const days = daysUntil(value, now);
  if (days === null) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}
