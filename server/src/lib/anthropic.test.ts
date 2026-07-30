import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

// The SDK is replaced wholesale: these tests are about how a returned Message
// is interpreted, not about the transport.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

import { HAIKU, SONNET, ContentRefusedError, generateStructured } from "./anthropic";

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
        output_config: expect.objectContaining({
          format: { type: "json_schema", schema: SCHEMA },
        }),
      })
    );
  });

  // The reasoning level is the main cost dial on these calls, and the two model
  // families take it as different parameters — sending Sonnet's `effort` to
  // Haiku is a 400, so the translation is worth pinning down.
  describe("reasoning", () => {
    /** Runs a call and returns the request params handed to the SDK. */
    async function paramsFor(opts: Partial<Parameters<typeof generateStructured>[0]>) {
      respondWith({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });
      await generateStructured({ system: "s", prompt: "p", schema: SCHEMA, ...opts });
      return streamMock.mock.calls[0][0];
    }

    it("defaults to Sonnet at medium rather than the API's own high", async () => {
      const params = await paramsFor({});

      expect(params.model).toBe(SONNET);
      expect(params.thinking).toEqual({ type: "adaptive" });
      expect(params.output_config.effort).toBe("medium");
    });

    it("maps a level to adaptive thinking plus effort on Sonnet", async () => {
      const params = await paramsFor({ reasoning: "low" });

      expect(params.thinking).toEqual({ type: "adaptive" });
      expect(params.output_config.effort).toBe("low");
    });

    // Haiku 4.5 predates the effort parameter and rejects it outright.
    it("maps a level to a thinking budget on Haiku, and omits effort", async () => {
      const params = await paramsFor({ model: HAIKU, reasoning: "medium", maxTokens: 8000 });

      expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 2000 });
      expect(params.output_config.effort).toBeUndefined();
    });

    // budget_tokens must stay under max_tokens or the request is rejected.
    it("caps Haiku's budget at half of max_tokens", async () => {
      const params = await paramsFor({ model: HAIKU, reasoning: "high", maxTokens: 3000 });

      expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 1500 });
    });

    // Below the API's 1024 floor no budget is valid, so thinking has to go.
    it("disables thinking when max_tokens leaves no room for the minimum budget", async () => {
      const params = await paramsFor({ model: HAIKU, reasoning: "low", maxTokens: 1500 });

      expect(params.thinking).toEqual({ type: "disabled" });
    });

    it("disables thinking on either family when reasoning is off", async () => {
      const sonnet = await paramsFor({ reasoning: "off" });
      expect(sonnet.thinking).toEqual({ type: "disabled" });
      expect(sonnet.output_config.effort).toBeUndefined();

      streamMock.mockClear();
      const haiku = await paramsFor({ model: HAIKU, reasoning: "off" });
      expect(haiku.thinking).toEqual({ type: "disabled" });
    });
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
