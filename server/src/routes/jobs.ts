import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { ingestJobs } from "../services/jobIngestion";
import { prisma } from "../lib/prisma";
import { enrichJobsWithPageText } from "../services/jobPageText";
import { scoreAndSortJobs } from "../services/jobRelevanceScorer";
import {
  buildSearchCacheLookup,
  getValidSearchCache,
  saveSearchCache,
  type CachedSearchJob,
} from "../services/searchResultsCache";
import type { JobSearchParams } from "../jobSources/types";
import type { ResumeKeywords } from "../types/keywords";

const router = Router();

const VALID_POSTED_WITHIN = ["day", "week", "month"] as const;
type PostedWithin = (typeof VALID_POSTED_WITHIN)[number];

const VALID_EXPERIENCE_LEVELS = ["entry", "mid", "senior"] as const;
type ExperienceLevel = (typeof VALID_EXPERIENCE_LEVELS)[number];

const DEFAULT_PAGE = 1;
const DEFAULT_RESULTS_PER_PAGE = 10;
const MAX_RESULTS_PER_PAGE = 50;

/** When Smart Search is on, fetch this many Adzuna results to score globally. */
const SMART_SEARCH_POOL_SIZE = 50;

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

function filterUntracked<T extends { id: string }>(
  jobs: T[],
  trackedPostingIds: Set<string>
): T[] {
  return jobs.filter((job) => !trackedPostingIds.has(job.id));
}

function applyMatchesOnly(jobs: CachedSearchJob[]): CachedSearchJob[] {
  return jobs.filter((job) => (job.relevanceScore ?? 0) > 0);
}

function buildPagination(
  totalCount: number,
  page: number,
  pageSize: number
) {
  return {
    page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
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
    matchesOnly,
    refresh,
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

  const resumeKeywords = req.user!.resumeKeywords as ResumeKeywords | null;
  const keywordsUsed =
    useKeywords === true &&
    req.user!.keywordsEnabled &&
    resumeKeywords !== null;
  const matchesOnlyActive = keywordsUsed && matchesOnly === true;
  const forceRefresh = refresh === true;

  const cacheLookup = buildSearchCacheLookup({
    userId: req.user!.id,
    query: params.query,
    location: params.location,
    postedWithin: params.postedWithin ?? null,
    experienceLevel: params.experienceLevel ?? "",
    keywordsUsed,
    page: parsedPage,
    pageSize: parsedPageSize,
    smartSearchPoolSize: SMART_SEARCH_POOL_SIZE,
  });

  try {
    const trackedApplicationsPromise = prisma.application.findMany({
      where: { userId: req.user!.id },
      select: { jobPostingId: true },
    });

    if (!forceRefresh) {
      const cached = await getValidSearchCache(cacheLookup);
      if (cached) {
        const trackedApplications = await trackedApplicationsPromise;
        const trackedPostingIds = new Set(
          trackedApplications.map((a) => a.jobPostingId)
        );

        let jobs = filterUntracked(cached.payload.jobs, trackedPostingIds);
        if (matchesOnlyActive) {
          jobs = applyMatchesOnly(jobs);
        }

        const clientPagination = keywordsUsed;
        let responseTotalCount = cached.payload.adzunaTotalCount;

        if (keywordsUsed) {
          responseTotalCount = jobs.length;
        }

        return res.json({
          summary: cached.payload.summary,
          jobs,
          keywordsUsed,
          clientPagination,
          matchesOnly: matchesOnlyActive,
          cached: true,
          cachedAt: cached.cachedAt.toISOString(),
          pagination: buildPagination(
            responseTotalCount,
            parsedPage,
            parsedPageSize
          ),
        });
      }
    }

    const fetchParams: JobSearchParams = keywordsUsed
      ? { ...params, page: 1, resultsPerPage: SMART_SEARCH_POOL_SIZE }
      : params;

    const [{ summary, totalCount: adzunaTotalCount, jobs }, trackedApplications] =
      await Promise.all([ingestJobs(fetchParams), trackedApplicationsPromise]);

    const trackedPostingIds = new Set(
      trackedApplications.map((a) => a.jobPostingId)
    );
    const untrackedJobs = filterUntracked(jobs, trackedPostingIds);

    const jobsForScoring = keywordsUsed
      ? await enrichJobsWithPageText(untrackedJobs)
      : untrackedJobs;

    const scoredJobs = scoreAndSortJobs(
      jobsForScoring,
      keywordsUsed ? resumeKeywords : null,
      keywordsUsed,
      { matchesOnly: false }
    );

    // Cache the full scored/plain pool before matches-only filtering.
    void saveSearchCache(cacheLookup, {
      summary,
      jobs: scoredJobs as CachedSearchJob[],
      adzunaTotalCount,
    });

    let pageJobs = scoredJobs;
    let responseTotalCount = adzunaTotalCount;
    const clientPagination = keywordsUsed;

    if (matchesOnlyActive) {
      pageJobs = applyMatchesOnly(pageJobs as CachedSearchJob[]) as typeof pageJobs;
    }

    if (keywordsUsed) {
      responseTotalCount = pageJobs.length;
    }

    const totalPages = Math.max(
      1,
      Math.ceil(responseTotalCount / parsedPageSize)
    );

    try {
      await prisma.searchQuery.upsert({
        where: {
          userId_query_location_experienceLevel: {
            userId: req.user!.id,
            query: params.query,
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
          query: params.query,
          location: params.location,
          postedWithin: params.postedWithin ?? null,
          experienceLevel: params.experienceLevel ?? "",
          lastSearchedAt: new Date(),
        },
      });
    } catch (trackErr) {
      console.error("Failed to record search query:", trackErr);
    }

    res.json({
      summary,
      jobs: pageJobs,
      keywordsUsed,
      clientPagination,
      matchesOnly: matchesOnlyActive,
      cached: false,
      pagination: {
        page: parsedPage,
        pageSize: parsedPageSize,
        totalCount: responseTotalCount,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Job search failed:", err);
    res.status(500).json({ error: "Failed to fetch and ingest jobs." });
  }
});

export default router;
