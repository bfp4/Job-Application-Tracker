import { describe, expect, it } from "vitest";
import type { Company, JobPosting } from "@prisma/client";
import { jobPostingFingerprint } from "./resumeTips";

type PostingWithCompany = JobPosting & { company: Company | null };

function makePosting(overrides: Partial<PostingWithCompany> = {}): PostingWithCompany {
  return {
    id: "posting-1",
    userId: "user-1",
    companyId: "company-1",
    company: { id: "company-1", name: "Acme", website: null },
    title: "Software Engineer",
    location: ["New York, NY", "Remote"],
    salary: "$120k–$150k",
    jobUrl: "https://example.com/jobs/1",
    description: "Build things with TypeScript.",
    matchScore: null,
    matchReasons: [],
    postedDate: null,
    fetchedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

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
