import { describe, expect, it } from "vitest";
import { formatDate, toDateInputValue } from "./format";

describe("formatDate", () => {
  it("returns an em dash for empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("returns an em dash for an unparseable value", () => {
    expect(formatDate("not a date")).toBe("—");
  });

  /**
   * Regression guard. Every date the app shows is a calendar date the user
   * picked, stored as UTC midnight. Rendering it in the viewer's local zone put
   * negative-offset users one day behind — a follow-up set to Jul 28 displayed
   * as "Jul 27", and disagreed with the reminder email, which formats in UTC.
   */
  it("renders the stored calendar day regardless of the viewer's timezone", () => {
    const utcMidnight = "2026-07-28T00:00:00.000Z";
    const original = process.env.TZ;

    try {
      for (const tz of ["UTC", "America/Los_Angeles", "America/New_York", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        expect(formatDate(utcMidnight), `in ${tz}`).toBe("Jul 28, 2026");
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("round-trips with toDateInputValue", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    expect(toDateInputValue(iso)).toBe("2026-01-01");
    expect(formatDate(iso)).toBe("Jan 1, 2026");
  });
});

describe("toDateInputValue", () => {
  it("returns an empty string for empty or invalid input", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
    expect(toDateInputValue("nope")).toBe("");
  });

  it("truncates a full timestamp to its UTC calendar day", () => {
    expect(toDateInputValue("2026-07-28T23:59:59.000Z")).toBe("2026-07-28");
  });
});
