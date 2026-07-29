import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePosting } from "../test-helpers/fixtures";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("../lib/anthropic", () => ({ generateStructured: generateStructuredMock }));

import { generateConnectMessage } from "./linkedinMessage";

const posting = makePosting();
const contact = { name: "Grace Hopper", position: "Engineering Manager", notes: null };
const resumeMarkdown = "# Ada Lovelace\nBuilt distributed systems at Acme.";

/** Runs the service and returns the options handed to the model. */
async function callWith(specialization?: Parameters<typeof generateConnectMessage>[5]) {
  await generateConnectMessage(
    contact,
    posting,
    "APPLIED",
    null,
    resumeMarkdown,
    specialization
  );
  return generateStructuredMock.mock.calls[0][0];
}

describe("generateConnectMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateStructuredMock.mockResolvedValue({ message: "Hi Grace — great to connect." });
  });

  it("keeps the 300-character ceiling and the no-pitch rule", async () => {
    const { system } = await callWith();

    expect(system).toContain("at most 300 characters");
    expect(system).toContain("Do NOT ask for a referral");
  });

  it("frames the note for the candidate's specialization", async () => {
    const { system } = await callWith("FINANCE");

    expect(system).toContain("targeting Finance & Banking roles");
    expect(system.toLowerCase()).toContain("conservative");
  });

  it("uses different framing for a different specialization", async () => {
    const { system } = await callWith("DESIGN");

    expect(system).toContain("targeting Design & Creative roles");
    expect(system.toLowerCase()).toContain("portfolio");
  });

  it("falls back to general framing when the user has no specialization", async () => {
    const { system } = await callWith();

    expect(system).toContain("targeting General roles");
  });

  it("trims an over-long draft at a word boundary", async () => {
    generateStructuredMock.mockResolvedValue({ message: "word ".repeat(100) });

    const message = await generateConnectMessage(
      contact,
      posting,
      "APPLIED",
      null,
      resumeMarkdown
    );

    expect(message.length).toBeLessThanOrEqual(300);
    expect(message.endsWith("word")).toBe(true);
  });
});
