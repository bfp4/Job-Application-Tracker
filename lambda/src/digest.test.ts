import { describe, expect, it } from "vitest";
import {
  buildDigests,
  formatDigestEmail,
  type DueFollowUpRow,
  type NotAppliedRow,
} from "./digest.js";

function followUp(overrides: Partial<DueFollowUpRow> = {}): DueFollowUpRow {
  return {
    id: "fu_1",
    followUpDate: new Date("2026-07-07T00:00:00Z"),
    note: null,
    userEmail: "ari@example.com",
    jobTitle: "Senior Engineer",
    companyName: "Acme",
    ...overrides,
  };
}

function notApplied(overrides: Partial<NotAppliedRow> = {}): NotAppliedRow {
  return {
    applicationId: "app_1",
    createdAt: new Date("2026-06-30T00:00:00Z"),
    userEmail: "ari@example.com",
    jobTitle: "Platform Engineer",
    companyName: "Globex",
    ...overrides,
  };
}

describe("buildDigests", () => {
  it("returns no digests for empty input", () => {
    expect(buildDigests([], [])).toEqual([]);
  });

  it("groups multiple follow-ups for the same user into one digest", () => {
    const digests = buildDigests(
      [followUp({ id: "fu_1" }), followUp({ id: "fu_2", jobTitle: "Staff Engineer" })],
      []
    );
    expect(digests).toHaveLength(1);
    expect(digests[0].toAddress).toBe("ari@example.com");
    expect(digests[0].followUpIds).toEqual(["fu_1", "fu_2"]);
    expect(digests[0].body).toContain("Senior Engineer at Acme");
    expect(digests[0].body).toContain("Staff Engineer at Acme");
  });

  it("builds separate digests per user", () => {
    const digests = buildDigests(
      [followUp(), followUp({ id: "fu_2", userEmail: "other@example.com" })],
      [notApplied({ userEmail: "third@example.com" })]
    );
    expect(digests.map((d) => d.toAddress).sort()).toEqual([
      "ari@example.com",
      "other@example.com",
      "third@example.com",
    ]);
  });

  it("builds a follow-ups-only digest", () => {
    const [digest] = buildDigests([followUp()], []);
    expect(digest.subject).toBe("Job tracker: 1 follow-up due");
    expect(digest.body).toContain("FOLLOW-UPS DUE");
    expect(digest.body).not.toContain("NOT APPLIED YET");
  });

  it("builds a not-applied-only digest with no follow-up ids to mark", () => {
    const [digest] = buildDigests([], [notApplied()]);
    expect(digest.subject).toBe("Job tracker: 1 application to submit");
    expect(digest.body).toContain("NOT APPLIED YET");
    expect(digest.body).not.toContain("FOLLOW-UPS DUE");
    expect(digest.followUpIds).toEqual([]);
  });

  it("combines both sections and pluralizes the subject", () => {
    const [digest] = buildDigests(
      [followUp({ id: "fu_1" }), followUp({ id: "fu_2" })],
      [notApplied()]
    );
    expect(digest.subject).toBe(
      "Job tracker: 2 follow-ups due, 1 application to submit"
    );
    expect(digest.body).toContain("FOLLOW-UPS DUE");
    expect(digest.body).toContain("NOT APPLIED YET");
  });
});

describe("formatDigestEmail", () => {
  it("renders follow-up lines with due date and note", () => {
    const body = formatDigestEmail(
      [followUp({ note: "ping the recruiter" })],
      []
    );
    expect(body).toContain(
      "- Senior Engineer at Acme (due Jul 7, 2026) — ping the recruiter"
    );
  });

  it("omits the note suffix when there is no note", () => {
    const body = formatDigestEmail([followUp({ note: null })], []);
    expect(body).toContain("- Senior Engineer at Acme (due Jul 7, 2026)");
    expect(body).not.toContain("—  ");
    expect(body.split("\n")[1]).toBe(
      "- Senior Engineer at Acme (due Jul 7, 2026)"
    );
  });

  it("falls back to 'Unknown company' when the posting has no company", () => {
    const body = formatDigestEmail([], [notApplied({ companyName: null })]);
    expect(body).toContain("- Platform Engineer at Unknown company (saved Jun 30, 2026)");
  });

  it("renders not-applied lines with the saved date", () => {
    const body = formatDigestEmail([], [notApplied()]);
    expect(body).toContain("- Platform Engineer at Globex (saved Jun 30, 2026)");
  });
});
