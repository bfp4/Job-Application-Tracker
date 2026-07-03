import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";

const router = Router();

const JOB_SEARCH_DISABLED_MESSAGE =
  "Job search is temporarily unavailable while resume handling is being updated.";

/**
 * POST /api/search/run
 * Blocked — job search is temporarily disabled.
 */
router.post("/run", authenticate, (_req: Request, res: Response) => {
  res.status(503).json({ error: JOB_SEARCH_DISABLED_MESSAGE, disabled: true });
});

/**
 * GET /api/search/results
 * Returns the user's discovered job postings, most recently fetched first,
 * annotated with whether the user is already tracking each one.
 */
router.get("/results", authenticate, async (req: Request, res: Response) => {
  const [jobPostings, trackedApplications] = await Promise.all([
    prisma.jobPosting.findMany({
      orderBy: { fetchedAt: "desc" },
      take: 100,
      include: { company: true },
    }),
    prisma.application.findMany({
      where: { userId: req.user!.id },
      select: { jobPostingId: true },
    }),
  ]);

  const trackedIds = new Set(trackedApplications.map((a) => a.jobPostingId));
  const results = jobPostings.map((posting) => ({
    ...posting,
    isTracked: trackedIds.has(posting.id),
  }));

  res.json({ results });
});

/**
 * GET /api/search/runs
 * Returns the user's recent search-agent runs (plan + resultCount + trace)
 * for debugging — since the search is a non-deterministic adaptive loop, the
 * trace is what explains what a given run actually did.
 */
router.get("/runs", authenticate, async (req: Request, res: Response) => {
  const runs = await prisma.searchRun.findMany({
    where: { userId: req.user!.id },
    orderBy: { runAt: "desc" },
    take: 20,
  });

  res.json({ runs });
});

export default router;
