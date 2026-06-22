import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { rankSearchQueries } from "../services/searchScoring";

const router = Router();

/** How many searches feed the daily recommendations digest / preferences list. */
export const TOP_SEARCH_LIMIT = 5;

/**
 * GET /api/search-preferences
 * The user's top 5 searches: pinned first, then unpinned ranked by recency-weighted
 * score (see searchScoring.ts), filled up to 5 total.
 */
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const queries = await prisma.searchQuery.findMany({
      where: { userId: req.user!.id },
      orderBy: { lastSearchedAt: "desc" },
    });

    const top = rankSearchQueries(queries, TOP_SEARCH_LIMIT);
    res.json({ searches: top });
  } catch (err) {
    console.error("Failed to list search preferences:", err);
    res.status(500).json({ error: "Failed to list search preferences." });
  }
});

/**
 * PATCH /api/search-preferences/:id
 * Toggle whether a search is pinned. Pinned searches always feed the digest
 * regardless of how recently/often they were used.
 */
router.patch("/:id", authenticate, async (req: Request, res: Response) => {
  const { pinned } = req.body ?? {};

  if (typeof pinned !== "boolean") {
    res.status(400).json({ error: "`pinned` must be a boolean." });
    return;
  }

  try {
    const existing = await prisma.searchQuery.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Search not found." });
      return;
    }

    const search = await prisma.searchQuery.update({
      where: { id: existing.id },
      data: { pinned },
    });

    res.json({ search });
  } catch (err) {
    console.error("Failed to update search preference:", err);
    res.status(500).json({ error: "Failed to update search preference." });
  }
});

/**
 * DELETE /api/search-preferences/:id
 * Remove a search from consideration entirely (user no longer wants it in their
 * recommendations).
 */
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.searchQuery.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Search not found." });
      return;
    }

    await prisma.searchQuery.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    console.error("Failed to delete search preference:", err);
    res.status(500).json({ error: "Failed to delete search preference." });
  }
});

export default router;
