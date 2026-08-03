/** Shared date helpers. */

/**
 * Midnight UTC on the day `date` falls in.
 *
 * Day-granularity columns (appliedDate, followUpDate, TimelineEntry.occurredAt)
 * are stored as UTC midnight, because the client renders every one of them with
 * `timeZone: "UTC"` and edits them through `<input type="date">`. Writing a real
 * instant into one of those columns instead shifts the rendered day for anyone
 * west of UTC: 8pm in New York is already tomorrow in UTC, so the entry shows up
 * dated a day after it happened.
 */
export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
