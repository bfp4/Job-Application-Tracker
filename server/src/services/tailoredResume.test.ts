import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePosting } from "../test-helpers/fixtures";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("../lib/anthropic", () => ({ generateStructured: generateStructuredMock }));

import { generateTailoredResume } from "./tailoredResume";

const posting = makePosting();
const resumeMarkdown = "# Ada Lovelace\nBuilt distributed systems at Acme.";

describe("generateTailoredResume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateStructuredMock.mockResolvedValue({ header: { name: "Ada", contact: [] } });
  });

  it("passes the resume and posting into the prompt", async () => {
    await generateTailoredResume(resumeMarkdown, posting);

    const opts = generateStructuredMock.mock.calls[0][0];
    expect(opts.prompt).toContain(resumeMarkdown);
    expect(opts.prompt).toContain(posting.title);
    expect(opts.prompt).toContain("Build things with TypeScript."); // posting description
  });

  it("instructs the model never to invent facts", async () => {
    await generateTailoredResume(resumeMarkdown, posting);

    const opts = generateStructuredMock.mock.calls[0][0];
    expect(opts.system.toLowerCase()).toContain("never introduce a fact");
  });

  it("constrains output to the required schema shape with before/after bullets", async () => {
    await generateTailoredResume(resumeMarkdown, posting);

    const { schema } = generateStructuredMock.mock.calls[0][0];
    expect(schema.required).toEqual(
      expect.arrayContaining(["header", "summary", "sections", "changeNote"])
    );
    const bulletProps =
      schema.properties.sections.items.properties.entries.items.properties.bullets.items
        .properties;
    expect(Object.keys(bulletProps)).toEqual(expect.arrayContaining(["before", "after"]));
  });

  it("injects the hard one-page budget into the system prompt", async () => {
    await generateTailoredResume(resumeMarkdown, posting);

    const opts = generateStructuredMock.mock.calls[0][0];
    expect(opts.system).toContain("single US Letter page");
  });

  it("injects field-specific guidance for the chosen specialization", async () => {
    await generateTailoredResume(resumeMarkdown, posting, "FINANCE");

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("Finance & Banking");
    expect(system.toLowerCase()).toContain("deal");
  });

  it("falls back to general guidance when no specialization is given", async () => {
    await generateTailoredResume(resumeMarkdown, posting);

    const { system } = generateStructuredMock.mock.calls[0][0];
    expect(system).toContain("targeting General roles");
  });

  it("returns whatever the model produced", async () => {
    const content = { header: { name: "Ada", contact: [] } };
    generateStructuredMock.mockResolvedValue(content);

    expect(await generateTailoredResume(resumeMarkdown, posting)).toBe(content);
  });
});
