import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { ingestJobs } from "../services/jobIngestion";
import { rankJobsForUser } from "../services/jobRanker";
import { prisma } from "../lib/prisma";
import type { JobSearchParams, NormalizedJob } from "../jobSources/types";
import type { ResumeStructure } from "../types/resume";

const router = Router();

const VALID_POSTED_WITHIN = ["day", "week", "month"] as const;
type PostedWithin = (typeof VALID_POSTED_WITHIN)[number];

const VALID_EXPERIENCE_LEVELS = ["entry", "mid", "senior"] as const;
type ExperienceLevel = (typeof VALID_EXPERIENCE_LEVELS)[number];

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
  const { query, location, postedWithin, experienceLevel, page, resultsPerPage } =
    req.body ?? {};

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

  try {
    const { summary, totalCount, jobs } = await ingestJobs(params);

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

/**
 * Coerces a loosely-typed incoming job object into a NormalizedJob, tolerating
 * the slightly different field names the client may send (e.g. a persisted
 * JobPosting with a nested company instead of companyName).
 */
function toNormalizedJob(raw: unknown): NormalizedJob | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const externalId =
    typeof r.externalId === "string" ? r.externalId : undefined;
  if (!externalId) return null;

  const company = r.company as { name?: unknown } | undefined;
  const companyName =
    typeof r.companyName === "string"
      ? r.companyName
      : typeof company?.name === "string"
        ? company.name
        : "Unknown";

  return {
    externalId,
    source: typeof r.source === "string" ? r.source : "",
    title: typeof r.title === "string" ? r.title : "",
    description: typeof r.description === "string" ? r.description : "",
    location: typeof r.location === "string" ? r.location : "",
    jobUrl: typeof r.jobUrl === "string" ? r.jobUrl : "",
    companyName,
    postedDate: typeof r.postedDate === "string" ? r.postedDate : null,
  };
}

/**
 * POST /api/jobs/smart-rank
 *
 * Re-ranks a set of jobs (already returned from a previous search) against the
 * authenticated user's most recent base resume using AI, returning them sorted
 * by fit. Requires a base resume to be on file.
 */
router.post("/smart-rank", authenticate, async (req: Request, res: Response) => {
  const { jobs } = req.body ?? {};

  if (!Array.isArray(jobs) || jobs.length === 0) {
    res
      .status(400)
      .json({ error: "`jobs` must be a non-empty array of jobs to rank." });
    return;
  }

  const normalized = jobs
    .map(toNormalizedJob)
    .filter((job): job is NormalizedJob => job !== null);

  if (normalized.length === 0) {
    res.status(400).json({ error: "No valid jobs were provided to rank." });
    return;
  }

  try {
    const baseResume = await prisma.baseResume.findFirst({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
    });

    if (!baseResume) {
      res.status(400).json({ error: "Upload a base resume to use Smart Rank" });
      return;
    }

    const resumeContent = baseResume.content as unknown as ResumeStructure;
    const ranked = await rankJobsForUser(normalized, resumeContent);

    res.json({ jobs: ranked });
  } catch (err) {
    console.error("Smart Rank failed:", err);
    res.status(500).json({ error: "Failed to rank jobs." });
  }
});

export default router;
