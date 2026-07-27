import {
  isNonEmptyString,
  isNullableString,
  isStringArray,
  isValidHttpUrl,
} from "./validation";

export type JobPostingFieldData = {
  jobUrl?: string;
  title?: string;
  /** The company's name — resolved to a Company row by the route. */
  companyName?: string;
  location?: string[];
  salary?: string | null;
  description?: string | null;
};

/**
 * Validates and normalizes the job-posting fields present in a request body.
 * Only keys present in `body` appear in `data`, so the same parser serves
 * create (the caller checks the required fields arrived) and partial PATCH
 * updates. Optional text fields store ""/whitespace as NULL so `=== null`
 * reliably means "unset"; `jobUrl` must be an http(s) URL because it is
 * rendered as a clickable link (see isValidHttpUrl's security note).
 */
export function parseJobPostingFields(
  body: Record<string, unknown>
): { ok: true; data: JobPostingFieldData } | { ok: false; error: string } {
  const data: JobPostingFieldData = {};

  if (body.jobUrl !== undefined) {
    if (!isValidHttpUrl(body.jobUrl)) {
      return { ok: false, error: "`jobUrl` must be a valid http(s) URL." };
    }
    data.jobUrl = body.jobUrl.trim();
  }

  for (const field of ["title", "companyName"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isNonEmptyString(value)) {
      return { ok: false, error: `\`${field}\` must be a non-empty string.` };
    }
    data[field] = value.trim();
  }

  if (body.location !== undefined) {
    if (!isStringArray(body.location)) {
      return { ok: false, error: "`location` must be an array of non-empty strings." };
    }
    data.location = body.location.map((entry) => entry.trim());
  }

  for (const field of ["salary", "description"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isNullableString(value)) {
      return { ok: false, error: `\`${field}\` must be a string or null.` };
    }
    data[field] = value === null || value.trim() === "" ? null : value.trim();
  }

  return { ok: true, data };
}
