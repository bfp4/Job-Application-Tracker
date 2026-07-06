import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
/** Cheaper model for mechanical, non-judgment work (e.g. reformatting existing text into JSON). */
export const CHEAP_MODEL = "claude-haiku-4-5-20251001";

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
  /** Defaults to MODEL. Override for cheap, non-judgment work (e.g. reformatting existing text into JSON). */
  model?: string;
}

/**
 * Structured outputs guarantees the response's *final* text block conforms to
 * the schema — earlier text blocks may exist (e.g. a stated plan before tool
 * calls), so this takes the last one, not the first.
 */
function extractStructuredJson<T>(response: Anthropic.Message): T {
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
 * Used for resume parsing and search-strategy generation.
 */
export async function generateStructured<T>(opts: StructuredOptions): Promise<T> {
  const response = await getClient().messages.create({
    model: opts.model ?? MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  return extractStructuredJson<T>(response);
}
