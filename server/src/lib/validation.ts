/** Shared request-body validators used across routes. */

/**
 * Only http(s) URLs are valid. This is a security invariant, not a
 * formality: user-supplied URLs are stored and rendered as clickable links,
 * so schemes like javascript: must never be accepted by any write path.
 */
export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * Parses a value into a Date or null. Returns `undefined` when the value is
 * present but not a valid date, so callers can reject invalid input.
 */
export function parseNullableDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
