/**
 * Shared contract for all job board sources.
 *
 * Every external job API (Adzuna, JSearch, etc.) is wrapped in an adapter that
 * implements {@link JobSource}. Adapters accept the same dynamic
 * {@link JobSearchParams} and normalize their wildly different responses into the
 * common {@link NormalizedJob} shape, so the rest of the system never has to know
 * which API a job came from.
 */

/** Dynamic search inputs. These are expected to eventually come from the UI. */
export interface JobSearchParams {
  query: string;
  location: string;
  resultsPerPage?: number;
  page?: number;
  /**
   * How recently the job was posted. Each {@link JobSource} maps this to whatever
   * date-filter mechanism its API supports. If an API has no equivalent, the
   * adapter simply ignores it.
   */
  postedWithin?: "day" | "week" | "month";
  /**
   * Target seniority. Adapters translate this into whatever keyword-filtering
   * their API supports to exclude irrelevant seniority levels. Ignored by
   * adapters with no equivalent mechanism.
   */
  experienceLevel?: "entry" | "mid" | "senior";
  /**
   * When true, the route handler has already attached resume keywords via
   * {@link keywordFilters} for Smart Search enrichment.
   */
  useKeywords?: boolean;
  /**
   * Resume keywords passed to adapters as optional filters (Adzuna `what_or` /
   * `what_and`). The main {@link query} stays the user's job title only.
   */
  keywordFilters?: string[];
  /**
   * How resume keywords are matched: `or` = any keyword (broad, default),
   * `and` = all top keywords must appear (strict).
   */
  keywordMode?: "or" | "and";
}

/** A single job normalized into our canonical shape, source-agnostic. */
export interface NormalizedJob {
  externalId: string;
  source: string;
  title: string;
  description: string;
  location: string;
  jobUrl: string;
  companyName: string;
  /** ISO 8601 string, or null when the source doesn't provide a posted date. */
  postedDate: string | null;
}

/** Result from a single source fetch, including total matches for pagination. */
export interface JobFetchResult {
  jobs: NormalizedJob[];
  /** Total matching jobs reported by the source (may be 0 if unknown). */
  totalCount: number;
}

/** Adapter contract every job board source must implement. */
export interface JobSource {
  /** Stable identifier persisted as JobPosting.source (e.g. "adzuna"). */
  name: string;
  fetchJobs(params: JobSearchParams): Promise<JobFetchResult>;
}
