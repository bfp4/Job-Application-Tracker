import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePosting } from "../test-helpers/fixtures";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("../lib/anthropic", () => ({ generateStructured: generateStructuredMock }));

import { generateQuestionAnswer } from "./applicationQuestions";

const posting = makePosting();
const resumeMarkdown = "# Ada Lovelace\nBuilt distributed systems at Acme.";
const question = "Tell us about a project you're proud of.";

/** Runs the service and returns the options handed to the model. */
async function callWith(specialization?: Parameters<typeof generateQuestionAnswer>[5]) {
  await generateQuestionAnswer(
    question,
    resumeMarkdown,
    posting,
    null,
    null,
    specialization
  );
  return generateStructuredMock.mock.calls[0][0];
}

describe("generateQuestionAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateStructuredMock.mockResolvedValue({ answer: "At Acme I…" });
  });

  it("passes the question, resume, and posting into the prompt", async () => {
    const { prompt } = await callWith();

    expect(prompt).toContain(question);
    expect(prompt).toContain(resumeMarkdown);
    expect(prompt).toContain(posting.title);
  });

  it("keeps the grounding rules regardless of specialization", async () => {
    const { system } = await callWith("CONSULTING");

    expect(system).toContain("never invent employers, projects, metrics, or dates");
    expect(system).toContain("[bracketed placeholder]");
  });

  it("frames the answer for the candidate's specialization", async () => {
    const { system } = await callWith("CONSULTING");

    expect(system).toContain("targeting Consulting roles");
    expect(system).toContain("Lead with the answer");
  });

  it("uses different framing for a different specialization", async () => {
    const { system } = await callWith("HEALTHCARE");

    expect(system).toContain("targeting Healthcare & Nursing roles");
    expect(system.toLowerCase()).toContain("patient safety");
  });

  it("falls back to general framing when the user has no specialization", async () => {
    const { system } = await callWith();

    expect(system).toContain("targeting General roles");
  });

  it("leads with the draft when refining an existing answer", async () => {
    await generateQuestionAnswer(
      question,
      resumeMarkdown,
      posting,
      null,
      "My rough draft.",
      "SALES"
    );

    const { prompt, system } = generateStructuredMock.mock.calls[0][0];
    expect(prompt).toContain("Refine the candidate's draft answer");
    expect(prompt).toContain("My rough draft.");
    expect(system).toContain("targeting Sales roles");
  });

  it("returns the model's answer", async () => {
    generateStructuredMock.mockResolvedValue({ answer: "Drafted answer." });

    expect(
      await generateQuestionAnswer(question, resumeMarkdown, posting, null)
    ).toBe("Drafted answer.");
  });
});
