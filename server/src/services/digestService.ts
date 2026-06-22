import type { FollowUp, JobPosting, Company, Application } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ingestJobs } from "./jobIngestion";
import { rankSearchQueries } from "./searchScoring";
import type { JobSearchParams, NormalizedJob } from "../jobSources/types";

/**
 * Fixed per-rank posting allocation for the digest. Index 0 is the user's #1
 * ranked search, index 1 the #2 ranked search, and so on. The sum (10) is the
 * most jobs a single digest will ever contain.
 *
 * Allocation is deliberately fixed (not weighted-random): rank 1 -> 3 jobs,
 * rank 2 -> 3, rank 3 -> 2, rank 4 -> 1, rank 5 -> 1.
 */
const PER_RANK_ALLOCATION = [3, 3, 2, 1, 1] as const;

/** How many of the user's top searches feed the digest (one per allocation slot). */
const TOP_SEARCH_LIMIT = PER_RANK_ALLOCATION.length;

const VALID_POSTED_WITHIN = ["day", "week", "month"] as const;
type PostedWithin = (typeof VALID_POSTED_WITHIN)[number];

function asPostedWithin(value: string | null): PostedWithin | undefined {
  return value && (VALID_POSTED_WITHIN as readonly string[]).includes(value)
    ? (value as PostedWithin)
    : undefined;
}

/**
 * A single recommended posting plus which saved search produced it.
 *
 * `job` is the source-agnostic {@link NormalizedJob} shape — clean to render in an
 * email and to serialize in the JSON preview. `jobPostingId` is the persisted
 * JobPosting id, kept alongside because it's needed to dedupe across searches,
 * to exclude jobs the user already tracks, and to record `recommendedJobIds` on
 * the DigestLog when the digest Lambda sends the email.
 */
export interface RecommendedJob {
  job: NormalizedJob;
  jobPostingId: string;
  fromSearchRank: number;
  fromSearchQuery: string;
}

/** A due follow-up joined with its parent application (+ company/posting). */
export type DueFollowUp = FollowUp & {
  application: Application & { company: Company; jobPosting: JobPosting };
};

export interface DigestData {
  recommendedJobs: RecommendedJob[];
  dueFollowUps: DueFollowUp[];
}

/** ingestJobs always includes the related company; assert the richer type. */
type PersistedPosting = JobPosting & { company: Company };

/**
 * Builds the data for a user's daily recommendations digest.
 *
 * Does NOT send any email — that's the digest Lambda's job. It only assembles
 * the content:
 *
 *  1. Rank the user's top {@link TOP_SEARCH_LIMIT} searches (pinned first, then by
 *     recency-weighted score — identical ranking to GET /api/search-preferences).
 *  2. Walk the ranked searches in order, giving each a fixed slice of the digest
 *     ({@link PER_RANK_ALLOCATION}). For each search:
 *       - re-run {@link ingestJobs} to fetch fresh postings,
 *       - drop postings the user already has an Application for,
 *       - drop postings already chosen by a higher-ranked search (dedupe by id),
 *       - take that search's allocation, most recent first (by postedDate).
 *     Filtering before slicing naturally "backfills" with the next most recent
 *     unique result. A search that can't fill its allocation simply contributes
 *     fewer jobs — the shortfall is NOT redistributed to other searches.
 *  3. Separately gather incomplete follow-ups that are due (followUpDate <= today).
 */
export async function generateDigestForUser(
  userId: string
): Promise<DigestData> {
  const allQueries = await prisma.searchQuery.findMany({
    where: { userId },
    orderBy: { lastSearchedAt: "desc" },
  });
  const rankedQueries = rankSearchQueries(allQueries, TOP_SEARCH_LIMIT);

  // Exclude anything the user is already tracking.
  const trackedApplications = await prisma.application.findMany({
    where: { userId },
    select: { jobPostingId: true },
  });
  const trackedPostingIds = new Set(
    trackedApplications.map((a) => a.jobPostingId)
  );

  const recommendedJobs: RecommendedJob[] = [];
  const usedPostingIds = new Set<string>();

  for (let i = 0; i < rankedQueries.length; i++) {
    const sq = rankedQueries[i];
    const rank = i + 1;
    const allocation = PER_RANK_ALLOCATION[i];

    const params: JobSearchParams = {
      query: sq.query,
      location: sq.location,
      ...(asPostedWithin(sq.postedWithin)
        ? { postedWithin: asPostedWithin(sq.postedWithin) }
        : {}),
    };

    let postings: PersistedPosting[];
    try {
      const { jobs } = await ingestJobs(params);
      postings = jobs as PersistedPosting[];
    } catch (err) {
      console.error(
        `Digest: failed to fetch jobs for search "${sq.query}" @ "${sq.location}":`,
        err
      );
      continue;
    }

    // Most recent first, skipping tracked and already-chosen postings, then take
    // this search's allocation. Filtering before slicing is what backfills with
    // the next most recent unique result. We never borrow another search's slots.
    const picks = postings
      .filter((p) => !trackedPostingIds.has(p.id) && !usedPostingIds.has(p.id))
      .sort((a, b) => postedTime(b) - postedTime(a))
      .slice(0, allocation);

    for (const posting of picks) {
      usedPostingIds.add(posting.id);
      recommendedJobs.push({
        job: toNormalizedJob(posting),
        jobPostingId: posting.id,
        fromSearchRank: rank,
        fromSearchQuery: formatSearchLabel(sq.query, sq.location),
      });
    }
  }

  // Incomplete follow-ups that are due on or before the end of today.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const dueFollowUps = (await prisma.followUp.findMany({
    where: {
      completed: false,
      followUpDate: { lte: endOfToday },
      application: { userId },
    },
    include: {
      application: { include: { company: true, jobPosting: true } },
    },
    orderBy: { followUpDate: "asc" },
  })) as DueFollowUp[];

  return { recommendedJobs, dueFollowUps };
}

/** Human-readable label for the search a job came from, e.g. "engineer, Brooklyn". */
function formatSearchLabel(query: string, location: string): string {
  return location ? `${query}, ${location}` : query;
}

/** Maps a persisted posting (+ company) back to the source-agnostic shape. */
function toNormalizedJob(posting: PersistedPosting): NormalizedJob {
  return {
    externalId: posting.externalId,
    source: posting.source,
    title: posting.title,
    description: posting.description ?? "",
    location: posting.location ?? "",
    jobUrl: posting.jobUrl ?? "",
    companyName: posting.company.name,
    postedDate: posting.postedDate ? posting.postedDate.toISOString() : null,
  };
}

/** Sort key: most recently posted first; missing postedDate sorts last. */
function postedTime(job: JobPosting): number {
  return job.postedDate ? new Date(job.postedDate).getTime() : 0;
}
