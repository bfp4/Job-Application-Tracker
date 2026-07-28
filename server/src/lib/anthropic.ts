import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in the server environment.");
  }
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

interface StructuredOptions {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

/**
 * Raised when Claude's safety classifiers decline the request. This arrives as
 * a successful HTTP 200 with stop_reason "refusal" — not an SDK error — so
 * routes have to be told about it explicitly. Callers map it to a 422 with a
 * message the user can act on, rather than a generic 500.
 */
export class ContentRefusedError extends Error {
  constructor(readonly category: string | null) {
    super(
      "Claude declined to generate this. If the job description contains " +
        "sensitive or unusual content, try trimming it and running again."
    );
    this.name = "ContentRefusedError";
  }
}

/**
 * Structured outputs guarantees the response's *final* text block conforms to
 * the schema — earlier text blocks may exist (e.g. a stated plan before tool
 * calls), so this takes the last one, not the first.
 */
function extractStructuredJson<T>(response: Anthropic.Message): T {
  // A refusal returns 200 with no usable content. Check before reading blocks:
  // otherwise this surfaces as the generic "no text block" error below and the
  // user gets a 500 with no idea what to change.
  if (response.stop_reason === "refusal") {
    throw new ContentRefusedError(response.stop_details?.category ?? null);
  }

  // A response cut off by max_tokens carries truncated, unparseable JSON —
  // fail with the real cause instead of a cryptic JSON.parse error. (On this
  // model adaptive thinking shares the max_tokens budget, so give headroom.)
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Claude response was truncated by max_tokens before the structured output completed."
    );
  }

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) {
    throw new Error(
      `Claude response had no text block (stop_reason: ${response.stop_reason}).`
    );
  }
  return JSON.parse(lastText.text) as T;
}

/**
 * Single-shot Claude call constrained to a JSON schema via structured outputs.
 *
 * Streamed, then reassembled with finalMessage(): these calls run with a large
 * max_tokens (adaptive thinking shares the budget with the JSON), and a
 * non-streaming request at that size risks an HTTP timeout while an Express
 * request is held open. Streaming costs nothing here — the caller still gets
 * one parsed object — and removes that failure mode.
 */
export async function generateStructured<T>(opts: StructuredOptions): Promise<T> {
  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  return extractStructuredJson<T>(await stream.finalMessage());
}
