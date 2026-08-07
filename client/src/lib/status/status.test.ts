import { describe, expect, it } from "vitest";
import {
  LINKEDIN_STATUS_META,
  LINKEDIN_STATUS_ORDER,
  linkedinStatusBadgeClasses,
  linkedinStatusLabel,
} from "../linkedin";
import { STATUS_META, STATUS_ORDER, statusBadgeClasses, statusLabel } from "./status";

/**
 * These tables mirror Prisma enums (ApplicationStatus, LinkedinStatus). The
 * ordering array drives every dropdown and grouped list, so a value present in
 * one and missing from the other renders a status the user can never select.
 */
describe("application status table", () => {
  it("orders exactly the statuses it has metadata for", () => {
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(STATUS_META).sort());
  });

  it("has no duplicates in the pipeline order", () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
  });

  it("gives every status a label and badge classes", () => {
    for (const status of STATUS_ORDER) {
      expect(statusLabel(status), status).toBeTruthy();
      expect(statusBadgeClasses(status), status).toContain("bg-");
    }
  });

  it("falls back rather than rendering blank for an unknown status", () => {
    const unknown = "SOMETHING_NEW" as (typeof STATUS_ORDER)[number];
    expect(statusLabel(unknown)).toBe("SOMETHING_NEW");
    expect(statusBadgeClasses(unknown)).toBe(STATUS_META.NOT_APPLIED.badge);
  });
});

describe("linkedin status table", () => {
  it("orders exactly the statuses it has metadata for", () => {
    expect([...LINKEDIN_STATUS_ORDER].sort()).toEqual(
      Object.keys(LINKEDIN_STATUS_META).sort()
    );
  });

  it("gives every status a label and badge classes", () => {
    for (const status of LINKEDIN_STATUS_ORDER) {
      expect(linkedinStatusLabel(status), status).toBeTruthy();
      expect(linkedinStatusBadgeClasses(status), status).toContain("bg-");
    }
  });

  it("falls back rather than rendering blank for an unknown status", () => {
    const unknown = "SOMETHING_NEW" as (typeof LINKEDIN_STATUS_ORDER)[number];
    expect(linkedinStatusLabel(unknown)).toBe("SOMETHING_NEW");
    expect(linkedinStatusBadgeClasses(unknown)).toBe(LINKEDIN_STATUS_META.NONE.badge);
  });
});
