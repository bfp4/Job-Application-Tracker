import type { BaseResume, Company, JobPosting } from "@prisma/client";

export type PostingWithCompany = JobPosting & { company: Company | null };

/** A complete JobPosting row (with company) — override what the test cares about. */
export function makePosting(
  overrides: Partial<PostingWithCompany> = {}
): PostingWithCompany {
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

export function makeBaseResume(overrides: Partial<BaseResume> = {}): BaseResume {
  return {
    id: "resume-1",
    userId: "user-1",
    pdfS3Key: "resumes/user-1/base.pdf",
    markdownS3Key: "resumes/user-1/base.md",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

/** A valid TailoredResumeContent shape (structurally, not typed here to keep
 *  fixtures free of a service import) — override what the test cares about. */
export function makeTailoredContent(overrides: Record<string, unknown> = {}) {
  return {
    header: { name: "Ada Lovelace", contact: ["ada@example.com", "London, UK"] },
    summary: "Engineer retargeted for the role.",
    sections: [
      {
        title: "Experience",
        entries: [
          {
            heading: "Senior Engineer @ Acme · 2020–2024",
            bullets: [{ before: "Built stuff", after: "Built distributed systems" }],
          },
        ],
      },
      {
        title: "Skills",
        entries: [{ heading: null, bullets: [{ before: null, after: "TypeScript, Node.js" }] }],
      },
    ],
    changeNote: "Emphasized distributed systems.",
    ...overrides,
  };
}
