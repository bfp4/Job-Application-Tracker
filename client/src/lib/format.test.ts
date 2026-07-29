import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatDate,
  relativeDayLabel,
  toDateInputValue,
  todayInputValue,
  urgencyOf,
} from "./format";

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

describe("todayInputValue", () => {
  it("pads the month and day to two digits", () => {
    expect(todayInputValue(new Date(2026, 0, 5, 9, 0, 0))).toBe("2026-01-05");
  });

  /**
   * Regression guard. This fills in the applied date when a status moves off
   * "Not applied". Taking the UTC day instead recorded *tomorrow* for anyone
   * west of UTC acting in the evening, and the header then showed a future
   * applied date.
   */
  it("uses the local calendar day, not the UTC one", () => {
    const lateEvening = new Date(2026, 6, 28, 23, 30, 0);
    expect(todayInputValue(lateEvening)).toBe("2026-07-28");

    const earlyMorning = new Date(2026, 6, 28, 0, 30, 0);
    expect(todayInputValue(earlyMorning)).toBe("2026-07-28");
  });
});

describe("daysUntil", () => {
  /** Local noon, so the case doesn't depend on the runner's zone. */
  const now = new Date(2026, 6, 28, 12, 0, 0);

  it("returns null for missing or unparseable input", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("nope", now)).toBeNull();
  });

  it("counts whole days forward and backward from today", () => {
    expect(daysUntil("2026-07-28T00:00:00.000Z", now)).toBe(0);
    expect(daysUntil("2026-07-29T00:00:00.000Z", now)).toBe(1);
    expect(daysUntil("2026-08-04T00:00:00.000Z", now)).toBe(7);
    expect(daysUntil("2026-07-26T00:00:00.000Z", now)).toBe(-2);
  });

  /**
   * Regression guard for the same class of bug formatDate had. Late in the
   * evening in a negative-offset zone it is already tomorrow in UTC, and
   * comparing instants rather than calendar days reported today's follow-up as
   * overdue — while the row above it still rendered today's date.
   */
  it("treats the viewer's local calendar day as today", () => {
    const lateEvening = new Date(2026, 6, 28, 23, 30, 0);
    expect(daysUntil("2026-07-28T00:00:00.000Z", lateEvening)).toBe(0);

    const earlyMorning = new Date(2026, 6, 28, 0, 30, 0);
    expect(daysUntil("2026-07-28T00:00:00.000Z", earlyMorning)).toBe(0);
  });
});

describe("urgencyOf", () => {
  const now = new Date(2026, 6, 28, 12, 0, 0);

  it("bands a date by how much attention it needs", () => {
    expect(urgencyOf("2026-07-27T00:00:00.000Z", now)).toBe("overdue");
    expect(urgencyOf("2026-07-28T00:00:00.000Z", now)).toBe("today");
    expect(urgencyOf("2026-07-31T00:00:00.000Z", now)).toBe("soon");
    expect(urgencyOf("2026-08-01T00:00:00.000Z", now)).toBe("later");
  });

  /** The "soon" window matches the reminder email's 3-day lead time. */
  it("closes the soon window exactly three days out", () => {
    expect(urgencyOf("2026-07-31T00:00:00.000Z", now)).toBe("soon");
    expect(urgencyOf("2026-08-01T00:00:00.000Z", now)).not.toBe("soon");
  });
});

describe("relativeDayLabel", () => {
  const now = new Date(2026, 6, 28, 12, 0, 0);

  it("phrases the distance to a due date", () => {
    expect(relativeDayLabel("2026-07-28T00:00:00.000Z", now)).toBe("Today");
    expect(relativeDayLabel("2026-07-29T00:00:00.000Z", now)).toBe("Tomorrow");
    expect(relativeDayLabel("2026-08-02T00:00:00.000Z", now)).toBe("in 5 days");
    expect(relativeDayLabel("2026-07-27T00:00:00.000Z", now)).toBe("1 day overdue");
    expect(relativeDayLabel("2026-07-25T00:00:00.000Z", now)).toBe("3 days overdue");
  });
});
