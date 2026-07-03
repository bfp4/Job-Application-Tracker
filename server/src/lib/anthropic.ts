import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
const MAX_WEB_SEARCH_CONTINUATIONS = 5;

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
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  return extractStructuredJson<T>(response);
}

interface WebSearchStructuredOptions extends StructuredOptions {
  maxSearches?: number;
  maxFetches?: number;
}

export interface AgentTraceEntry {
  tool: string;
  input: unknown;
}

export interface WebSearchAgentResult<T> {
  result: T;
  /** The model's stated plan, if it produced leading text before its first tool call. */
  plan: string | null;
  /** Every server-executed tool call made across the run, in order. */
  trace: AgentTraceEntry[];
}

/**
 * Claude call with the server-side web_search and web_fetch tools enabled,
 * constrained to a JSON schema via structured outputs. This is a single
 * adaptive agentic loop — Claude searches, reads what it finds, and decides
 * its next move in real time, rather than following a pre-committed query
 * list. Both tools are server-executed, so no client-side tool loop is
 * needed — but the server-side loop caps at 10 iterations per request, so a
 * `pause_turn` stop reason means it hit that cap mid-task and the request
 * must be resent to let it continue.
 */
export async function generateWithWebSearch<T>(
  opts: WebSearchStructuredOptions
): Promise<WebSearchAgentResult<T>> {
  const anthropic = getClient();
  const tools: Anthropic.ToolUnion[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: opts.maxSearches ?? 15,
    },
    {
      type: "web_fetch_20260209",
      name: "web_fetch",
      max_uses: opts.maxFetches ?? 10,
    },
  ];
  const requestBase = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    tools,
    output_config: {
      format: { type: "json_schema" as const, schema: opts.schema },
    },
  };

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: opts.prompt },
  ];

  let response = await anthropic.messages.create({ ...requestBase, messages });
  const allBlocks: Anthropic.ContentBlock[] = [...response.content];

  let continuations = 0;
  while (
    response.stop_reason === "pause_turn" &&
    continuations < MAX_WEB_SEARCH_CONTINUATIONS
  ) {
    messages.push({
      role: "assistant",
      content: response.content as unknown as Anthropic.MessageParam["content"],
    });
    response = await anthropic.messages.create({ ...requestBase, messages });
    allBlocks.push(...response.content);
    continuations += 1;
  }

  let plan: string | null = null;
  let sawToolUse = false;
  const trace: AgentTraceEntry[] = [];

  for (const block of allBlocks) {
    if (block.type === "server_tool_use") {
      sawToolUse = true;
      trace.push({ tool: block.name, input: block.input });
    } else if (block.type === "text" && !sawToolUse && plan === null) {
      const trimmed = block.text.trim();
      if (trimmed) plan = trimmed;
    }
  }

  return { result: extractStructuredJson<T>(response), plan, trace };
}
