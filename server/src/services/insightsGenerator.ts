import { generateJson } from "../lib/anthropic";
import type { AggregatedStats } from "./insightsAggregator";

/** The allowed insight categories, used to pick an icon/colour in the UI. */
export type InsightType = "positive" | "warning" | "suggestion" | "neutral";

const INSIGHT_TYPES: InsightType[] = [
  "positive",
  "warning",
  "suggestion",
  "neutral",
];

/** A single AI-generated insight. */
export interface Insight {
  title: string;
  insight: string;
  type: InsightType;
}

/** The result of a single insights generation pass. */
export interface InsightResult {
  insights: Insight[];
  generatedAt: Date;
  statsSnapshot: AggregatedStats;
}

function isInsight(value: unknown): value is Insight {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { title?: unknown; insight?: unknown; type?: unknown };
  return (
    typeof v.title === "string" &&
    typeof v.insight === "string" &&
    typeof v.type === "string" &&
    (INSIGHT_TYPES as string[]).includes(v.type)
  );
}

function isInsightArray(value: unknown): value is Insight[] {
  return Array.isArray(value) && value.every(isInsight);
}

function buildPrompt(stats: AggregatedStats): string {
  const statsJSON = JSON.stringify(stats, null, 2);

  return `You are a career coach analyzing a job seeker's application data. Based on the following statistics, provide 4-6 specific, actionable insights. 

Rules:
- Be direct and specific, not generic (avoid advice like 'apply to more jobs')
- Reference the actual numbers from the data when relevant
- If the data is too sparse to draw meaningful conclusions (fewer than 5 applications), say so and suggest what data would be needed
- Focus on what's working, what isn't, and one clear next action per insight
- Each insight should be 2-3 sentences maximum

Format your response as a JSON array of insight objects:
[
  {
    'title': 'short title (5 words max)',
    'insight': 'the 2-3 sentence insight',
    'type': one of: 'positive' | 'warning' | 'suggestion' | 'neutral'
  }
]

Return ONLY valid JSON — no explanation, no markdown backticks.

Application data:
${statsJSON}`;
}

/**
 * Sends the aggregated stats to Claude and returns 4–6 actionable insights.
 *
 * Throws if Claude is unavailable or returns malformed JSON (generateJson
 * retries once internally). Callers should catch and fall back to showing the
 * raw stats without insights.
 */
export async function generateInsights(
  stats: AggregatedStats
): Promise<InsightResult> {
  const insights = await generateJson<Insight[]>({
    prompt: buildPrompt(stats),
    maxTokens: 1000,
    validate: isInsightArray,
  });

  return {
    insights,
    generatedAt: new Date(),
    statsSnapshot: stats,
  };
}
