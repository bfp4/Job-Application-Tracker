import { NormalizedPosting, Scraper, ScrapeError } from "./types";

const ASHBY_HOST = "jobs.ashbyhq.com";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Shape of a single posting in Ashby's public job-board API. Only the fields we
 * consume are typed; the endpoint returns more. Everything is optional because
 * it's an external contract we don't control.
 */
interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: unknown;
  jobUrl?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
}

interface AshbyBoard {
  jobs?: AshbyJob[];
}

/**
 * Ashby publishes every board as JSON, so this is an API client, not an HTML
 * scraper. A posting URL is `https://jobs.ashbyhq.com/{orgSlug}/{postingId}`;
 * the org slug is also the board name in the public API, and the posting id is
 * the UUID we match against.
 */
export const ashbyScraper: Scraper = {
  source: "ashby",

  matches(url: URL): boolean {
    return url.hostname === ASHBY_HOST;
  },

  async scrape(url: URL): Promise<NormalizedPosting> {
    const { orgSlug, postingId } = parseAshbyUrl(url);

    const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
      orgSlug
    )}?includeCompensation=true`;

    let res: Response;
    try {
      res = await fetch(apiUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Couldn't reach Ashby. Please try again in a moment."
      );
    }

    // A 404 here means the board (org) itself doesn't exist.
    if (res.status === 404) {
      throw new ScrapeError(
        "NOT_FOUND",
        "That Ashby job board doesn't exist. Check the URL and try again."
      );
    }
    if (!res.ok) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Ashby returned an unexpected error. Please try again in a moment."
      );
    }

    let board: AshbyBoard;
    try {
      board = (await res.json()) as AshbyBoard;
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Ashby returned a response we couldn't read. Please try again."
      );
    }

    const job = board.jobs?.find((j) => j.id === postingId);
    if (!job) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or unlisted."
      );
    }

    return {
      title: job.title?.trim() || "Untitled role",
      companyName: companyNameFromSlug(orgSlug),
      location: normalizeLocations(job),
      salary:
        job.compensation?.compensationTierSummary ??
        job.compensation?.scrapeableCompensationSalarySummary ??
        null,
      description: job.descriptionPlain?.trim() || null,
      // Prefer Ashby's canonical URL; fall back to what the user pasted.
      jobUrl: job.jobUrl ?? url.toString(),
      postedDate: job.publishedAt ?? null,
    };
  },
};

/**
 * Pulls the org slug and posting UUID out of an Ashby posting URL. Tolerates a
 * trailing `/application` segment and query/hash noise. Throws when the path
 * isn't a recognizable posting (e.g. a bare board listing with no posting id).
 */
function parseAshbyUrl(url: URL): { orgSlug: string; postingId: string } {
  const segments = url.pathname.split("/").filter(Boolean);
  const orgSlug = segments[0];
  const postingId = segments[1];

  if (!orgSlug || !postingId || !UUID_RE.test(postingId)) {
    throw new ScrapeError(
      "UNSUPPORTED_URL",
      "That doesn't look like a single Ashby job posting. Paste the URL of a specific role."
    );
  }

  return { orgSlug, postingId };
}

/**
 * Ashby's public posting object doesn't carry the org's display name, so we
 * derive a readable default from the slug (`acme-corp` -> `Acme Corp`). It's a
 * prefill the user can correct.
 */
function companyNameFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Merges the primary and secondary locations into a deduped string array.
 * `secondaryLocations` is loosely typed in the API (strings or `{ location }`
 * objects across boards), so this coerces defensively.
 */
function normalizeLocations(job: AshbyJob): string[] {
  const values: string[] = [];
  if (typeof job.location === "string" && job.location.trim()) {
    values.push(job.location.trim());
  }
  if (Array.isArray(job.secondaryLocations)) {
    for (const entry of job.secondaryLocations) {
      const name =
        typeof entry === "string"
          ? entry
          : typeof (entry as { location?: unknown })?.location === "string"
          ? (entry as { location: string }).location
          : null;
      if (name && name.trim()) values.push(name.trim());
    }
  }
  return [...new Set(values)];
}
