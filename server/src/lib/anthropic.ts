import Anthropic from "@anthropic-ai/sdk";

/**
 * The two models this app calls. Sonnet writes the long-form documents (resume
 * tips, tailored resume, cover letter); Haiku handles the short, tightly
 * specified drafts — a 300-character LinkedIn note, an application answer — at
 * roughly a third of Sonnet's per-token price.
 */
export const SONNET = "claude-sonnet-5";
export const HAIKU = "claude-haiku-4-5";
export type Model = typeof SONNET | typeof HAIKU;

/**
 * How hard the model reasons before answering. This is the main cost dial on
 * these calls: reasoning tokens bill at the output rate, and left unset Sonnet
 * reasons at `high` on every request — far more than most of these prompts need.
 *
 * The two model families express reasoning differently, so a level is
 * translated per model rather than passed through:
 *   - Sonnet 5 takes adaptive thinking plus `output_config.effort`.
 *   - Haiku 4.5 predates `effort` (it rejects the parameter outright) and takes
 *     a fixed thinking-token budget instead.
 * The ladders are therefore NOT equivalent across families — choose a level per
 * call site by looking at the output, not by matching names with another one.
 */
export type Reasoning = "off" | "low" | "medium" | "high";

/**
 * Haiku 4.5's stand-in for the effort ladder. 1024 is the API minimum, and the
 * budget must also stay under `max_tokens`, which reasoningFor enforces.
 */
const HAIKU_THINKING_BUDGETS: Record<Exclude<Reasoning, "off">, number> = {
  low: 1024,
  medium: 2000,
  high: 4000,
};

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
  /** Defaults to Sonnet. Use Haiku for short, tightly specified outputs. */
  model?: Model;
  /**
   * Defaults to `medium` rather than the API's own `high`: nothing here is a
   * hard reasoning problem, so a new call site should start cheap and be raised
   * deliberately if its output needs it.
   */
  reasoning?: Reasoning;
}

/**
 * Translates a reasoning level into the request fields the given model accepts.
 * Only Sonnet gets `effort`; sending it to Haiku 4.5 is a 400.
 */
function reasoningFor(
  model: Model,
  reasoning: Reasoning,
  maxTokens: number
): { thinking: Anthropic.ThinkingConfigParam; effort?: Anthropic.OutputConfig["effort"] } {
  if (reasoning === "off") return { thinking: { type: "disabled" } };

  if (model === HAIKU) {
    // budget_tokens must be ≥1024 and strictly below max_tokens. Cap it at half
    // the budget so the JSON always has room to finish; if that leaves less
    // than the 1024 floor, no budget can satisfy both — skip thinking instead
    // of sending a request the API would reject.
    const budget = Math.min(HAIKU_THINKING_BUDGETS[reasoning], Math.floor(maxTokens / 2));
    if (budget < 1024) return { thinking: { type: "disabled" } };
    return { thinking: { type: "enabled", budget_tokens: budget } };
  }

  return { thinking: { type: "adaptive" }, effort: reasoning };
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
 * Marks an error as raised *after* Claude returned a response — which means
 * the call was billed even though it produced nothing usable.
 *
 * A symbol rather than a named property so the tag can never leak into a JSON
 * error body, and so it survives on error types this module doesn't own (a
 * JSON.parse SyntaxError can't be re-classed without discarding its message).
 *
 * Quota accounting reads this via `isBilledModelFailure`: a refund is only
 * safe when the attempt cost nothing. See `releaseAiCallOnFailure`.
 */
const BILLED_MODEL_CALL = Symbol("billedModelCall");

function markBilledModelFailure<E>(err: E): E {
  if (typeof err === "object" && err !== null) {
    (err as Record<symbol, unknown>)[BILLED_MODEL_CALL] = true;
  }
  return err;
}

/**
 * True for errors thrown after a completed, billed model response — a refusal,
 * a max_tokens truncation, or unparseable output. Distinguishes "we paid and
 * got nothing" from "we never reached the model" (missing API key, transport
 * failure), which are free to retry.
 */
export function isBilledModelFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<symbol, unknown>)[BILLED_MODEL_CALL] === true
  );
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
  // fail with the real cause instead of a cryptic JSON.parse error. (Unless
  // reasoning is "off", thinking shares the max_tokens budget with the JSON, so
  // callers need headroom above the size of the object itself.)
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
  const model = opts.model ?? SONNET;
  const maxTokens = opts.maxTokens ?? 4096;
  const { thinking, effort } = reasoningFor(model, opts.reasoning ?? "medium", maxTokens);

  const stream = getClient().messages.stream({
    model,
    max_tokens: maxTokens,
    system: opts.system,
    thinking,
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
      // Omitted entirely for Haiku, which has no effort parameter.
      ...(effort ? { effort } : {}),
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  // Once finalMessage() resolves, the call has been billed regardless of what
  // it contains — a refusal and a truncation both arrive as a successful
  // response. Everything from here on is a paid-for failure, so tag it.
  const response = await stream.finalMessage();
  try {
    return extractStructuredJson<T>(response);
  } catch (err) {
    throw markBilledModelFailure(err);
  }
}
