import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { ingestJobs } from "../services/jobIngestion";
import { prisma } from "../lib/prisma";
import { selectKeywordFilters } from "../services/keywordSearch";
import type { JobSearchParams } from "../jobSources/types";
import type { ResumeKeywords } from "../types/keywords";

const router = Router();

const VALID_POSTED_WITHIN = ["day", "week", "month"] as const;
type PostedWithin = (typeof VALID_POSTED_WITHIN)[number];

const VALID_EXPERIENCE_LEVELS = ["entry", "mid", "senior"] as const;
type ExperienceLevel = (typeof VALID_EXPERIENCE_LEVELS)[number];

const VALID_KEYWORD_MODES = ["or", "and"] as const;
type KeywordMode = (typeof VALID_KEYWORD_MODES)[number];

const DEFAULT_PAGE = 1;
const DEFAULT_RESULTS_PER_PAGE = 10;
const MAX_RESULTS_PER_PAGE = 50;

function isPostedWithin(value: unknown): value is PostedWithin {
  return (
    typeof value === "string" &&
    (VALID_POSTED_WITHIN as readonly string[]).includes(value)
  );
}

function isExperienceLevel(value: unknown): value is ExperienceLevel {
  return (
    typeof value === "string" &&
    (VALID_EXPERIENCE_LEVELS as readonly string[]).includes(value)
  );
}

function isKeywordMode(value: unknown): value is KeywordMode {
  return (
    typeof value === "string" &&
    (VALID_KEYWORD_MODES as readonly string[]).includes(value)
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
  const {
    query,
    location,
    postedWithin,
    experienceLevel,
    page,
    resultsPerPage,
    useKeywords,
    keywordMode,
  } = req.body ?? {};

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

  if (experienceLevel !== undefined && !isExperienceLevel(experienceLevel)) {
    res.status(400).json({
      error: "`experienceLevel` must be one of 'entry', 'mid', or 'senior'.",
    });
    return;
  }

  if (keywordMode !== undefined && !isKeywordMode(keywordMode)) {
    res.status(400).json({
      error: "`keywordMode` must be one of 'or' or 'and'.",
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
    ...(experienceLevel ? { experienceLevel } : {}),
  };

  // The user-typed query, preserved so saved-search tracking (which feeds the
  // daily digest) is never polluted with the keyword-enriched variant.
  const originalQuery = params.query;

  // Smart Search: attach resume keywords as Adzuna what_or / what_and filters.
  // The user's query stays unchanged.
  if (useKeywords === true && req.user!.keywordsEnabled) {
    const keywords = req.user!.resumeKeywords as ResumeKeywords | null;
    const keywordFilters = selectKeywordFilters(originalQuery, keywords);
    if (keywordFilters.length > 0) {
      params.keywordFilters = keywordFilters;
      params.useKeywords = true;
      params.keywordMode = keywordMode ?? "or";
    }
  }

  try {
    const { summary, totalCount, jobs } = await ingestJobs(params);

    const trackedApplications = await prisma.application.findMany({
      where: { userId: req.user!.id },
      select: { jobPostingId: true },
    });
    const trackedPostingIds = new Set(
      trackedApplications.map((a) => a.jobPostingId)
    );
    const untrackedJobs = jobs.filter((job) => !trackedPostingIds.has(job.id));

    // Record this search so it can feed the daily recommendations digest.
    // Keyed on [userId, query, location, experienceLevel]: repeats bump
    // searchCount and recency instead of creating duplicate rows, while the
    // same query at different experience levels is tracked separately. Failures
    // here must not break search.
    try {
      await prisma.searchQuery.upsert({
        where: {
          userId_query_location_experienceLevel: {
            userId: req.user!.id,
            query: originalQuery,
            location: params.location,
            experienceLevel: params.experienceLevel ?? "",
          },
        },
        update: {
          searchCount: { increment: 1 },
          lastSearchedAt: new Date(),
          postedWithin: params.postedWithin ?? null,
        },
        create: {
          userId: req.user!.id,
          query: originalQuery,
          location: params.location,
          postedWithin: params.postedWithin ?? null,
          experienceLevel: params.experienceLevel ?? "",
          lastSearchedAt: new Date(),
        },
      });
    } catch (trackErr) {
      console.error("Failed to record search query:", trackErr);
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / parsedPageSize));

    res.json({
      summary,
      jobs: untrackedJobs,
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
