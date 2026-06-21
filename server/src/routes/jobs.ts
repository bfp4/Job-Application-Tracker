import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { ingestJobs } from "../services/jobIngestion";
import type { JobSearchParams } from "../jobSources/types";

const router = Router();

const VALID_POSTED_WITHIN = ["day", "week", "month"] as const;
type PostedWithin = (typeof VALID_POSTED_WITHIN)[number];

const DEFAULT_PAGE = 1;
const DEFAULT_RESULTS_PER_PAGE = 10;
const MAX_RESULTS_PER_PAGE = 50;

function isPostedWithin(value: unknown): value is PostedWithin {
  return (
    typeof value === "string" &&
    (VALID_POSTED_WITHIN as readonly string[]).includes(value)
  );
}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  max?: number
): number | null {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  if (max !== undefined && n > max) return null;
  return n;
}

/**
 * POST /api/jobs/search
 *
 * Triggers a live fetch from all registered job sources, persists the results,
 * and returns the current page of jobs plus pagination metadata.
 */
router.post("/search", authenticate, async (req: Request, res: Response) => {
  const { query, location, postedWithin, page, resultsPerPage } = req.body ?? {};

  if (typeof query !== "string" || query.trim() === "") {
    res.status(400).json({ error: "`query` is required and must be a string." });
    return;
  }

  if (typeof location !== "string" || location.trim() === "") {
    res
      .status(400)
      .json({ error: "`location` is required and must be a string." });
    return;
  }

  if (postedWithin !== undefined && !isPostedWithin(postedWithin)) {
    res.status(400).json({
      error: "`postedWithin` must be one of 'day', 'week', or 'month'.",
    });
    return;
  }

  const parsedPage = parsePositiveInt(page, DEFAULT_PAGE);
  if (parsedPage === null) {
    res.status(400).json({ error: "`page` must be a positive integer." });
    return;
  }

  const parsedPageSize = parsePositiveInt(
    resultsPerPage,
    DEFAULT_RESULTS_PER_PAGE,
    MAX_RESULTS_PER_PAGE
  );
  if (parsedPageSize === null) {
    res.status(400).json({
      error: "`resultsPerPage` must be a positive integer up to 50.",
    });
    return;
  }

  const params: JobSearchParams = {
    query: query.trim(),
    location: location.trim(),
    page: parsedPage,
    resultsPerPage: parsedPageSize,
    ...(postedWithin ? { postedWithin } : {}),
  };

  try {
    const { summary, totalCount, jobs } = await ingestJobs(params);

    const totalPages = Math.max(1, Math.ceil(totalCount / parsedPageSize));

    res.json({
      summary,
      jobs,
      pagination: {
        page: parsedPage,
        pageSize: parsedPageSize,
        totalCount,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Job search failed:", err);
    res.status(500).json({ error: "Failed to fetch and ingest jobs." });
  }
});

export default router;
