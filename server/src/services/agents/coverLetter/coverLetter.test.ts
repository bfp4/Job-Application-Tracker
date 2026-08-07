import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCoverLetterContent, makePosting } from "../../../test-helpers/fixtures";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("../../../lib/anthropic/anthropic", () => ({ generateStructured: generateStructuredMock }));

import { generateCoverLetter } from "./coverLetter";

const posting = makePosting();
const resumeMarkdown = "# Ada Lovelace\nBuilt distributed systems at Acme.";

describe("generateCoverLetter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateStructuredMock.mockResolvedValue(makeCoverLetterContent());
  });

  it("passes the resume and posting into the prompt", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const opts = generateStructuredMock.mock.calls[0][0];
    expect(opts.prompt).toContain(resumeMarkdown);
    expect(opts.prompt).toContain(posting.title);
    expect(opts.prompt).toContain("Build things with TypeScript."); // posting description
  });

  it("instructs the model never to invent facts", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const opts = generateStructuredMock.mock.calls[0][0];
    expect(opts.system.toLowerCase()).toContain("never introduce a fact");
  });

  it("tells the model to support the resume rather than repeat it", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("SUPPORT the resume, don't repeat it");
  });

  it("forbids inventing a recipient name", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("Never invent a recipient name");
  });

  it("injects the recruiter-friendly length budget into the system prompt", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("250-400 words");
    expect(system).toContain("3 or 4 paragraphs");
  });

  it("constrains output to the required schema shape", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const { schema } = generateStructuredMock.mock.calls[0][0];
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "header",
        "recipient",
        "greeting",
        "paragraphs",
        "closing",
        "signature",
        "approachNote",
      ])
    );
    // The addressee block must allow nulls — the posting often names nobody.
    expect(schema.properties.recipient.properties.name.anyOf).toEqual(
      expect.arrayContaining([{ type: "null" }])
    );
  });

  it("injects field-specific guidance for the chosen specialization", async () => {
    await generateCoverLetter(resumeMarkdown, posting, "HEALTHCARE");

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("Healthcare & Nursing");
    expect(system.toLowerCase()).toContain("licensure");
  });

  it("falls back to general guidance when no specialization is given", async () => {
    await generateCoverLetter(resumeMarkdown, posting);

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("targeting General roles");
  });

  it("returns whatever the model produced", async () => {
    const content = makeCoverLetterContent();
    generateStructuredMock.mockResolvedValue(content);

    expect(await generateCoverLetter(resumeMarkdown, posting)).toBe(content);
  });
});
