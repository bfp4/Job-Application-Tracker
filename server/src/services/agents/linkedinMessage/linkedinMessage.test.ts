import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePosting } from "../../../test-helpers/fixtures";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

// Only the call is stubbed; the model constants are real so a rename can't let
// these tests keep asserting a model that no longer exists.
vi.mock("../../../lib/anthropic/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/anthropic/anthropic")>()),
  generateStructured: generateStructuredMock,
}));

import { HAIKU } from "../../../lib/anthropic/anthropic";
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

/** Runs the service with a fixed set of drafts and returns the chosen note. */
function draft(notes: string[]) {
  generateStructuredMock.mockResolvedValue({ notes });
  return generateConnectMessage(contact, posting, "APPLIED", null, resumeMarkdown);
}

describe("generateConnectMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateStructuredMock.mockResolvedValue({ notes: ["Hi Grace, I applied Tuesday."] });
  });

  // Cost: a 300-character note from rules this explicit is the one call here
  // that needs neither Sonnet nor a reasoning pass.
  it("drafts on Haiku with reasoning off", async () => {
    const { model, reasoning } = await callWith();

    expect(model).toBe(HAIKU);
    expect(reasoning).toBe("off");
  });

  it("keeps the 300-character ceiling and asks for several drafts", async () => {
    const { system, schema } = await callWith();

    expect(system).toContain("300 characters");
    expect(system).toContain("30–45 words");
    expect((schema as { properties: { notes: unknown } }).properties.notes).toBeDefined();
  });

  // The complaint these rules answer: notes that opened with filler and closed
  // without asking for anything.
  it("bans the stock LinkedIn filler and requires a direct ask", async () => {
    const { system } = await callWith();

    expect(system).toContain("I hope this message finds you well");
    expect(system).toContain("I'd love to connect");
    expect(system).toContain("make the ask outright in the last one");
  });

  it("tells the model what to ask for based on the application status", async () => {
    await generateConnectMessage(contact, posting, "APPLIED", null, resumeMarkdown);
    const applied = generateStructuredMock.mock.calls[0][0].prompt;

    expect(applied).toContain("take a look at the application");
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

  // The point of asking for several drafts: overflow is the model's most common
  // failure, and a draft that fits beats one that has been cut down.
  it("keeps the longest draft that fits instead of trimming a longer one", async () => {
    const short = "Hi Grace, I applied Monday.";
    const full = `Hi Grace, ${"x".repeat(280)}`;
    const over = `Hi Grace, ${"y".repeat(400)}`;

    const message = await draft([over, short, full]);

    expect(message).toBe(full);
  });

  it("trims at a sentence boundary when every draft overflows", async () => {
    // A first sentence long enough to stand on its own, then overflow after it.
    const sentence = `Hi Grace, ${"a".repeat(180)}.`;
    const overflowing = `${sentence} ${"word ".repeat(40)}`;

    const message = await draft([overflowing, `${"z".repeat(400)}.`]);

    expect(message.length).toBeLessThanOrEqual(300);
    expect(message).toBe(sentence);
  });

  it("falls back to a word boundary when the first sentence fills the note", async () => {
    const message = await draft(["word ".repeat(100)]);

    expect(message.length).toBeLessThanOrEqual(300);
    expect(message.endsWith("word")).toBe(true);
  });

  it("ignores blank drafts rather than returning one", async () => {
    const message = await draft(["", "   ", "Hi Grace, I applied Monday."]);

    expect(message).toBe("Hi Grace, I applied Monday.");
  });

  it("fails loudly when no draft is usable", async () => {
    await expect(draft(["", "  "])).rejects.toThrow("no usable LinkedIn note drafts");
  });
});
