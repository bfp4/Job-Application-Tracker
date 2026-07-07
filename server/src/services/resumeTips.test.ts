import { describe, expect, it } from "vitest";
import { makePosting } from "../test-helpers/fixtures";
import { jobPostingFingerprint } from "./resumeTips";

describe("jobPostingFingerprint", () => {
  it("is stable for identical content", () => {
    expect(jobPostingFingerprint(makePosting())).toBe(jobPostingFingerprint(makePosting()));
  });

  it("changes when any content field the analysis reads changes", () => {
    const base = jobPostingFingerprint(makePosting());

    expect(jobPostingFingerprint(makePosting({ title: "Staff Engineer" }))).not.toBe(base);
    expect(jobPostingFingerprint(makePosting({ salary: null }))).not.toBe(base);
    expect(jobPostingFingerprint(makePosting({ description: "Different." }))).not.toBe(base);
    expect(jobPostingFingerprint(makePosting({ location: ["Remote"] }))).not.toBe(base);
    expect(
      jobPostingFingerprint(
        makePosting({ company: { id: "company-1", name: "Other Co", website: null } })
      )
    ).not.toBe(base);
  });

  it("ignores fields the analysis does not read (ids, timestamps, scores)", () => {
    const base = jobPostingFingerprint(makePosting());

    expect(
      jobPostingFingerprint(
        makePosting({
          id: "other-id",
          userId: "other-user",
          matchScore: 95,
          fetchedAt: new Date("2026-07-05T12:00:00Z"),
        })
      )
    ).toBe(base);
  });

  it("distinguishes a missing company from a company with an empty name", () => {
    expect(jobPostingFingerprint(makePosting({ company: null, companyId: null }))).not.toBe(
      jobPostingFingerprint(
        makePosting({ company: { id: "company-1", name: "", website: null } })
      )
    );
  });
});
