import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude model used for both resume parsing and tailoring.
 */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

// Lazily construct the Anthropic client so the server can boot without an API
// key configured; the first AI call validates the environment and throws if it
// is missing.
let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Set it in the server environment to enable " +
        "AI resume parsing and tailoring."
    );
  }

  cached = new Anthropic({ apiKey });
  return cached;
}

/**
 * Concatenates the text content blocks of a Claude message into a single string.
 */
function textFromMessage(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Removes a surrounding markdown code fence (```json ... ``` or ``` ... ```) if
 * the model wrapped its JSON despite being told not to.
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Sends a prompt to Claude and parses the response as JSON of type T.
 *
 * If the first response is malformed (not valid JSON, or rejected by the
 * optional `validate` callback), the call is retried exactly once before the
 * error propagates to the caller.
 */
export async function generateJson<T>(params: {
  prompt: string;
  maxTokens: number;
  validate?: (value: unknown) => value is T;
}): Promise<T> {
  const client = getAnthropic();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: params.maxTokens,
        messages: [{ role: "user", content: params.prompt }],
      });

      const raw = stripCodeFence(textFromMessage(message));
      const parsed = JSON.parse(raw) as unknown;

      if (params.validate && !params.validate(parsed)) {
        throw new Error("Claude response did not match the expected shape.");
      }

      return parsed as T;
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        console.warn(
          "Claude JSON generation failed, retrying once:",
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  throw lastError ?? new Error("Claude returned malformed JSON.");
}
