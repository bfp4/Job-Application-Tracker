import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePosting } from "../../../test-helpers/fixtures";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("../../../lib/anthropic/anthropic", () => ({ generateStructured: generateStructuredMock }));

import { generateResumeTips, jobPostingFingerprint, resumeTipsSchema } from "./resumeTips";
import { ALL_RESUME_TIPS_FOCUS_FIELDS } from "../../../lib/resumeTipsSpecializations";
import { CAREER_SPECIALIZATION_VALUES } from "../../../lib/careerSpecializations";

/** The shape resumeTipsSchema gives every focus section. */
interface ArraySchema {
  type: string;
  items: { required: string[] };
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
        makePosting({ company: { id: "company-1", name: "Other Co" } })
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
          fetchedAt: new Date("2026-07-05T12:00:00Z"),
        })
      )
    ).toBe(base);
  });

  it("distinguishes a missing company from a company with an empty name", () => {
    expect(jobPostingFingerprint(makePosting({ company: null, companyId: null }))).not.toBe(
      jobPostingFingerprint(
        makePosting({ company: { id: "company-1", name: "" } })
      )
    );
  });
});

const CORE_FIELDS = [
  "summary",
  "missingFromResume",
  "bulletPointSuggestions",
  "strengthsToHighlight",
  "additionalTips",
];

describe("resumeTipsSchema", () => {
  it("keeps technologiesToStudy for software engineering", () => {
    const schema = resumeTipsSchema("SOFTWARE_ENGINEERING");

    expect(Object.keys(schema.properties as object)).toContain("technologiesToStudy");
    expect(schema.required).toEqual(expect.arrayContaining(["technologiesToStudy"]));
  });

  it("gives other fields their own focus sections instead", () => {
    const healthcare = resumeTipsSchema("HEALTHCARE");
    const sales = resumeTipsSchema("SALES");

    expect(healthcare.required).toEqual(
      expect.arrayContaining(["certificationsToPursue", "clinicalDetailsToAdd"])
    );
    expect(healthcare.required).not.toContain("technologiesToStudy");

    expect(sales.required).toEqual(
      expect.arrayContaining(["skillsAndToolsToSharpen", "numbersToProve"])
    );
    expect(sales.required).not.toContain("technologiesToStudy");
  });

  it("keeps the shared core fields in every specialization's schema", () => {
    for (const spec of ["GENERAL", "FINANCE", "DESIGN", "DATA_ANALYTICS"] as const) {
      expect(resumeTipsSchema(spec).required).toEqual(expect.arrayContaining(CORE_FIELDS));
    }
  });

  it("falls back to the general shape with no specialization", () => {
    const schema = resumeTipsSchema();

    expect(schema.required).toEqual(
      expect.arrayContaining([...CORE_FIELDS, "skillsToDevelop", "achievementsToQuantify"])
    );
  });

  it("gives every specialization exactly two {name, reason} focus sections", () => {
    for (const spec of CAREER_SPECIALIZATION_VALUES) {
      const schema = resumeTipsSchema(spec);
      const focusKeys = (schema.required as string[]).filter(
        (key) => !CORE_FIELDS.includes(key)
      );

      expect(focusKeys).toHaveLength(2);
      for (const key of focusKeys) {
        const property = (schema.properties as Record<string, ArraySchema>)[key];
        expect(property.type).toBe("array");
        expect(property.items.required).toEqual(["name", "reason"]);
      }
    }
  });

  it("never reuses a focus key across two specializations", () => {
    const keys = ALL_RESUME_TIPS_FOCUS_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("generateResumeTips", () => {
  const posting = makePosting();
  const resumeMarkdown = "# Ada Lovelace\nBuilt distributed systems at Acme.";

  beforeEach(() => {
    vi.clearAllMocks();
    generateStructuredMock.mockResolvedValue({ summary: "Solid fit." });
  });

  it("passes the resume and posting into the prompt", async () => {
    await generateResumeTips(resumeMarkdown, posting);

    const opts = generateStructuredMock.mock.calls[0][0];
    expect(opts.prompt).toContain(resumeMarkdown);
    expect(opts.prompt).toContain(posting.title);
    expect(opts.prompt).toContain("Build things with TypeScript."); // posting description
  });

  it("forbids inventing experience the candidate doesn't have", async () => {
    await generateResumeTips(resumeMarkdown, posting);

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("never invent experience");
  });

  it("injects field-specific guidance and schema for the chosen specialization", async () => {
    await generateResumeTips(resumeMarkdown, posting, "HEALTHCARE");

    const { system, schema } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("Healthcare & Nursing");
    expect(system.toLowerCase()).toContain("licensure");
    expect(schema.required).toEqual(expect.arrayContaining(["certificationsToPursue"]));
  });

  it("falls back to general guidance when no specialization is given", async () => {
    await generateResumeTips(resumeMarkdown, posting);

    const { system, schema } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("targeting General roles");
    expect(schema.required).toEqual(expect.arrayContaining(["skillsToDevelop"]));
  });

  it("separates genuine gaps from ATS keyword-match rewrites", async () => {
    await generateResumeTips(resumeMarkdown, posting);

    const { system, schema } = generateStructuredMock.mock.calls[0][0];
    // Genuine gaps only in missingFromResume; reword cases routed elsewhere.
    expect(schema.properties.missingFromResume.description).toContain(
      "does NOT have"
    );
    expect(schema.properties.missingFromResume.description).toContain(
      "route it to bulletPointSuggestions"
    );
    // Acronym pairing lives with the rewrite suggestions.
    expect(schema.properties.bulletPointSuggestions.description).toContain(
      "Certified Public Accountant (CPA)"
    );
    expect(system.toLowerCase()).toContain("ats keyword-match");
  });

  it("returns whatever the model produced", async () => {
    const content = { summary: "Solid fit.", technologiesToStudy: [] };
    generateStructuredMock.mockResolvedValue(content);

    expect(await generateResumeTips(resumeMarkdown, posting)).toBe(content);
  });
});
