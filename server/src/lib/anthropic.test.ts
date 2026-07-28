import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

// The SDK is replaced wholesale: these tests are about how a returned Message
// is interpreted, not about the transport.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

import { ContentRefusedError, generateStructured } from "./anthropic";

/** Makes stream().finalMessage() resolve to the given Message-shaped object. */
function respondWith(message: Record<string, unknown>) {
  streamMock.mockReturnValue({ finalMessage: async () => message });
}

const SCHEMA = { type: "object", properties: {}, additionalProperties: false };

function call() {
  return generateStructured<{ ok: boolean }>({
    system: "system",
    prompt: "prompt",
    schema: SCHEMA,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("generateStructured", () => {
  it("parses the last text block, not the first", async () => {
    respondWith({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "Here's my plan." },
        { type: "text", text: '{"ok":true}' },
      ],
    });

    await expect(call()).resolves.toEqual({ ok: true });
  });

  it("streams rather than blocking on a single non-streaming request", async () => {
    respondWith({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });

    await call();

    expect(streamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      })
    );
  });

  // A refusal is an HTTP 200 with no usable content — it must not fall through
  // to the generic "no text block" error, which the route turns into a 500.
  it("raises ContentRefusedError on a refusal", async () => {
    respondWith({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
      content: [],
    });

    await expect(call()).rejects.toBeInstanceOf(ContentRefusedError);
  });

  it("tolerates a refusal that carries no stop_details", async () => {
    respondWith({ stop_reason: "refusal", content: [] });

    await expect(call()).rejects.toMatchObject({ category: null });
  });

  it("names max_tokens as the cause rather than failing to parse", async () => {
    respondWith({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"ok":tr' }],
    });

    await expect(call()).rejects.toThrow(/max_tokens/);
  });

  it("reports the stop reason when there is no text block at all", async () => {
    respondWith({ stop_reason: "end_turn", content: [] });

    await expect(call()).rejects.toThrow(/no text block \(stop_reason: end_turn\)/);
  });
});
