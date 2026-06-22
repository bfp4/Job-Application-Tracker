import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import {
  aggregateUserStats,
  type AggregatedStats,
} from "../services/insightsAggregator";
import {
  generateInsights,
  type Insight,
} from "../services/insightsGenerator";

const router = Router();

function asJson(stats: AggregatedStats): Prisma.InputJsonValue {
  return stats as unknown as Prisma.InputJsonValue;
}

/**
 * GET /api/insights
 * Aggregates the user's application stats, asks Claude for actionable insights,
 * persists the result as an InsightReport, and returns both.
 *
 * The stats are always returned even if the Claude call fails — in that case
 * `insights` is an empty array and `aiError` is true so the UI can show a
 * fallback message while still rendering the stats overview.
 */
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const stats = await aggregateUserStats(req.user!.id);

    let insights: Insight[] = [];
    let generatedAt = new Date();
    let aiError = false;

    try {
      const result = await generateInsights(stats);
      insights = result.insights;
      generatedAt = result.generatedAt;
    } catch (err) {
      console.error("Claude insights generation failed:", err);
      aiError = true;
    }

    // Persist a report row (even when AI failed we keep the metrics snapshot).
    try {
      await prisma.insightReport.create({
        data: {
          userId: req.user!.id,
          summary: JSON.stringify(insights),
          metrics: asJson(stats),
          generatedAt,
        },
      });
    } catch (err) {
      console.error("Failed to persist insight report:", err);
    }

    res.json({ insights, stats, generatedAt, aiError });
  } catch (err) {
    console.error("Failed to generate insights:", err);
    res.status(500).json({ error: "Failed to generate insights." });
  }
});

/**
 * GET /api/insights/history
 * Returns the user's last 5 insight reports, most recent first, so the client
 * can show how insights have changed over time.
 */
router.get("/history", authenticate, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.insightReport.findMany({
      where: { userId: req.user!.id },
      orderBy: { generatedAt: "desc" },
      take: 5,
    });

    const reports = rows.map((row) => ({
      id: row.id,
      generatedAt: row.generatedAt,
      insights: parseInsights(row.summary),
      stats: row.metrics as unknown as AggregatedStats,
    }));

    res.json({ reports });
  } catch (err) {
    console.error("Failed to fetch insight history:", err);
    res.status(500).json({ error: "Failed to fetch insight history." });
  }
});

/** Safely parses a stored summary string back into an insights array. */
function parseInsights(summary: string): Insight[] {
  try {
    const parsed = JSON.parse(summary) as unknown;
    return Array.isArray(parsed) ? (parsed as Insight[]) : [];
  } catch {
    return [];
  }
}

export default router;
