import type { JobPosting } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { jobSources } from "../jobSources";
import type {
  JobSource,
  JobSearchParams,
  NormalizedJob,
} from "../jobSources/types";

/** Per-source breakdown of how a single ingestion run went. */
export interface SourceSummary {
  fetched: number;
  newJobs: number;
  existingJobs: number;
}

/** Aggregated result returned by {@link ingestJobs}. */
export interface IngestionSummary {
  totalFetched: number;
  newJobs: number;
  existingJobs: number;
  bySource: Record<string, SourceSummary>;
}

export interface IngestionResult {
  summary: IngestionSummary;
  /** Total matches reported by job sources (used for pagination). */
  totalCount: number;
  /** Job postings persisted for this page, with company included. */
  jobs: JobPosting[];
}

/**
 * Fetches jobs from the given sources and persists them.
 *
 * For every normalized job we find-or-create its Company (matched on name), then
 * upsert a JobPosting keyed on the unique [source, externalId] pair so re-running
 * the same search updates rows instead of duplicating them.
 *
 * @param params  Dynamic search inputs (query/location/postedWithin/...).
 * @param sources Sources to query. Defaults to every registered source.
 */
export async function ingestJobs(
  params: JobSearchParams,
  sources: JobSource[] = jobSources
): Promise<IngestionResult> {
  const summary: IngestionSummary = {
    totalFetched: 0,
    newJobs: 0,
    existingJobs: 0,
    bySource: {},
  };

  let totalCount = 0;
  const postingIds: string[] = [];

  for (const source of sources) {
    const { jobs, totalCount: sourceTotal } = await source.fetchJobs(params);
    totalCount = Math.max(totalCount, sourceTotal);

    const sourceSummary: SourceSummary = {
      fetched: jobs.length,
      newJobs: 0,
      existingJobs: 0,
    };

    for (const job of jobs) {
      // Skip records that can't satisfy the unique [source, externalId] key.
      if (!job.externalId) continue;

      const { isNew, postingId } = await persistJob(job);
      postingIds.push(postingId);
      if (isNew) {
        sourceSummary.newJobs += 1;
      } else {
        sourceSummary.existingJobs += 1;
      }
    }

    summary.bySource[source.name] = sourceSummary;
    summary.totalFetched += sourceSummary.fetched;
    summary.newJobs += sourceSummary.newJobs;
    summary.existingJobs += sourceSummary.existingJobs;
  }

  const jobs =
    postingIds.length === 0
      ? []
      : await prisma.jobPosting.findMany({
          where: { id: { in: postingIds } },
          include: { company: true },
          orderBy: { postedDate: "desc" },
        });

  return { summary, totalCount, jobs };
}

/**
 * Persists a single normalized job.
 *
 * @returns whether the row was newly created and the persisted posting id.
 */
async function persistJob(job: NormalizedJob): Promise<{
  isNew: boolean;
  postingId: string;
}> {
  const company = await findOrCreateCompany(job.companyName);

  const existing = await prisma.jobPosting.findUnique({
    where: {
      source_externalId: { source: job.source, externalId: job.externalId },
    },
    select: { id: true },
  });

  const data = {
    companyId: company.id,
    title: job.title,
    description: job.description || null,
    location: job.location || null,
    jobUrl: job.jobUrl || null,
    postedDate: job.postedDate ? new Date(job.postedDate) : null,
  };

  const posting = await prisma.jobPosting.upsert({
    where: {
      source_externalId: { source: job.source, externalId: job.externalId },
    },
    create: {
      source: job.source,
      externalId: job.externalId,
      ...data,
    },
    update: data,
    select: { id: true },
  });

  return { isNew: existing === null, postingId: posting.id };
}

/** Company has no unique name constraint, so match-then-create manually. */
async function findOrCreateCompany(name: string) {
  const existing = await prisma.company.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.company.create({ data: { name } });
}
