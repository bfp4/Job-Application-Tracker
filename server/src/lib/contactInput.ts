import { LinkedinStatus } from "@prisma/client";
import { isNonEmptyString, isNullableString, isValidHttpUrl } from "./validation";

// LinkedIn's connection-request note is capped at 300 characters, so a stored
// connectMessage never needs to exceed it. Exported so the AI generator and the
// route validation share one source of truth.
export const MAX_CONNECT_MESSAGE_CHARS = 300;

const VALID_LINKEDIN_STATUSES = Object.values(LinkedinStatus);

export type ContactFieldData = {
  name?: string;
  position?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  linkedinStatus?: LinkedinStatus;
  connectMessage?: string | null;
};

/**
 * Validates and normalizes the contact fields present in a request body.
 * Only keys present in `body` appear in `data`, so the same parser serves
 * create (the caller checks `name` arrived) and partial PATCH updates.
 * Optional text fields store ""/whitespace as NULL so `=== null` reliably
 * means "unset"; `linkedinUrl` must be an http(s) URL because it is rendered
 * as a clickable link (see isValidHttpUrl's security note).
 */
export function parseContactFields(
  body: Record<string, unknown>
): { ok: true; data: ContactFieldData } | { ok: false; error: string } {
  const data: ContactFieldData = {};

  if (body.name !== undefined) {
    if (!isNonEmptyString(body.name)) {
      return { ok: false, error: "`name` must be a non-empty string." };
    }
    data.name = body.name.trim();
  }

  if (body.linkedinUrl !== undefined) {
    if (!isNullableString(body.linkedinUrl)) {
      return { ok: false, error: "`linkedinUrl` must be a string or null." };
    }
    const trimmed = body.linkedinUrl?.trim() ?? "";
    if (trimmed === "") {
      data.linkedinUrl = null;
    } else if (!isValidHttpUrl(trimmed)) {
      return { ok: false, error: "`linkedinUrl` must be a valid http(s) URL." };
    } else {
      data.linkedinUrl = trimmed;
    }
  }

  for (const field of ["position", "phone", "email", "notes"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isNullableString(value)) {
      return { ok: false, error: `\`${field}\` must be a string or null.` };
    }
    data[field] = value === null || value.trim() === "" ? null : value.trim();
  }

  if (body.linkedinStatus !== undefined) {
    if (
      typeof body.linkedinStatus !== "string" ||
      !(VALID_LINKEDIN_STATUSES as readonly string[]).includes(body.linkedinStatus)
    ) {
      return {
        ok: false,
        error: `\`linkedinStatus\` must be one of: ${VALID_LINKEDIN_STATUSES.join(", ")}.`,
      };
    }
    data.linkedinStatus = body.linkedinStatus as LinkedinStatus;
  }

  if (body.connectMessage !== undefined) {
    if (!isNullableString(body.connectMessage)) {
      return { ok: false, error: "`connectMessage` must be a string or null." };
    }
    const trimmed = body.connectMessage?.trim() ?? "";
    if (trimmed === "") {
      data.connectMessage = null;
    } else if (trimmed.length > MAX_CONNECT_MESSAGE_CHARS) {
      return {
        ok: false,
        error: `\`connectMessage\` must be at most ${MAX_CONNECT_MESSAGE_CHARS} characters.`,
      };
    } else {
      data.connectMessage = trimmed;
    }
  }

  return { ok: true, data };
}
