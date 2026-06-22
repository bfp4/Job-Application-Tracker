import type {
  JobSource,
  JobSearchParams,
  NormalizedJob,
  JobFetchResult,
} from "./types";

/**
 * Adzuna job board adapter.
 *
 * Docs: https://developer.adzuna.com/overview
 * Search endpoint: https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
 */

const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs";

// Default country marketplace. Adzuna requires a country code in the path.
const DEFAULT_COUNTRY = "us";
const DEFAULT_RESULTS_PER_PAGE = 20;

// Maps our generic postedWithin filter onto Adzuna's `max_days_old` param.
const MAX_DAYS_OLD: Record<NonNullable<JobSearchParams["postedWithin"]>, number> = {
  day: 1,
  week: 7,
  month: 30,
};

// Maps our generic experienceLevel onto Adzuna's `what_exclude` keyword filter,
// dropping postings whose title/description mention seniority signals that don't
// fit the requested level.
const EXPERIENCE_EXCLUDE: Record<
  NonNullable<JobSearchParams["experienceLevel"]>,
  string
> = {
  entry:
    "senior,lead,principal,staff,director,head,architect,manager,vp,10 years,8 years,7 years,6 years,5 years",
  mid: "director,vp,head,principal,staff,entry level,junior,graduate,intern,no experience",
  senior: "junior,entry level,graduate,intern,no experience,1 year,2 years",
};

/** Shape of the fields we read from Adzuna's search response. */
interface AdzunaJob {
  id?: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  location?: { display_name?: string };
  company?: { display_name?: string };
}

interface AdzunaSearchResponse {
  count?: number;
  results?: AdzunaJob[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const adzunaSource: JobSource = {
  name: "adzuna",

  async fetchJobs(params: JobSearchParams): Promise<JobFetchResult> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      throw new Error(
        "Missing Adzuna credentials. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in your environment."
      );
    }

    const country = process.env.ADZUNA_COUNTRY?.trim() || DEFAULT_COUNTRY;
    const page = params.page && params.page > 0 ? params.page : 1;
    const resultsPerPage = params.resultsPerPage ?? DEFAULT_RESULTS_PER_PAGE;

    const search = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      what: params.query,
      where: params.location,
      results_per_page: String(resultsPerPage),
      "content-type": "application/json",
    });

    // Only constrain by date when the caller asked for it.
    if (params.postedWithin) {
      search.set("max_days_old", String(MAX_DAYS_OLD[params.postedWithin]));
    }

    // Only constrain by seniority when the caller asked for it. If a
    // what_exclude value already exists (future-proofing), merge rather than
    // overwrite so neither filter is lost.
    if (params.experienceLevel) {
      const levelExclude = EXPERIENCE_EXCLUDE[params.experienceLevel];
      const existingExclude = search.get("what_exclude");
      search.set(
        "what_exclude",
        existingExclude ? `${existingExclude},${levelExclude}` : levelExclude
      );
    }

    const url = `${ADZUNA_BASE_URL}/${country}/search/${page}?${search.toString()}`;

    const response = await fetchWithRetry(url);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Adzuna request failed with ${response.status} ${response.statusText}${
          body ? `: ${body}` : ""
        }`
      );
    }

    const data = (await response.json()) as AdzunaSearchResponse;
    const results = data.results ?? [];

    return {
      jobs: results.map(normalizeAdzunaJob),
      totalCount: data.count ?? results.length,
    };
  },
};

/**
 * Performs the request, retrying exactly once after a short delay if Adzuna
 * responds with 429 (Too Many Requests).
 */
async function fetchWithRetry(url: string): Promise<Response> {
  const response = await fetch(url);

  if (response.status === 429) {
    await sleep(1500);
    return fetch(url);
  }

  return response;
}

function normalizeAdzunaJob(job: AdzunaJob): NormalizedJob {
  return {
    externalId: String(job.id ?? ""),
    source: "adzuna",
    title: job.title ?? "",
    description: job.description ?? "",
    location: job.location?.display_name ?? "",
    jobUrl: job.redirect_url ?? "",
    companyName: job.company?.display_name?.trim() || "Unknown",
    postedDate: job.created ?? null,
  };
}
