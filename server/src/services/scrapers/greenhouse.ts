import { NormalizedPosting, Scraper, ScrapeError } from "./types";

const GREENHOUSE_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
]);
const FETCH_TIMEOUT_MS = 8000;

/**
 * Shape of a single job in Greenhouse's public job-board API. Only the fields
 * we consume are typed; the endpoint returns more. Everything is optional
 * because it's an external contract we don't control.
 */
interface GreenhouseJob {
  id?: number;
  title?: string;
  content?: string;
  absolute_url?: string;
  updated_at?: string;
  company_name?: string;
  location?: { name?: string };
  offices?: Array<{ name?: string }>;
  pay_input_ranges?: Array<{
    min_cents?: number;
    max_cents?: number;
    currency_type?: string;
    title?: string;
  }>;
}

/**
 * Greenhouse publishes every board as JSON, so this is an API client, not an
 * HTML scraper. A posting URL is `https://boards.greenhouse.io/{board}/jobs/{id}`
 * (also served from `job-boards.greenhouse.io` and the `/embed/job_app` form);
 * the board token names the board in the public API and the numeric id is the
 * job we fetch.
 */
export const greenhouseScraper: Scraper = {
  source: "greenhouse",

  matches(url: URL): boolean {
    return GREENHOUSE_HOSTS.has(url.hostname);
  },

  async scrape(url: URL): Promise<NormalizedPosting> {
    const { boardToken, jobId } = parseGreenhouseUrl(url);

    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      boardToken
    )}/jobs/${encodeURIComponent(jobId)}?pay_transparency=true`;

    let res: Response;
    try {
      res = await fetch(apiUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Couldn't reach Greenhouse. Please try again in a moment."
      );
    }

    // A 404 here means the board or the job id doesn't exist.
    if (res.status === 404) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or the URL is wrong."
      );
    }
    if (!res.ok) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Greenhouse returned an unexpected error. Please try again in a moment."
      );
    }

    let job: GreenhouseJob;
    try {
      job = (await res.json()) as GreenhouseJob;
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Greenhouse returned a response we couldn't read. Please try again."
      );
    }

    return {
      title: job.title?.trim() || "Untitled role",
      companyName:
        job.company_name?.trim() || companyNameFromSlug(boardToken),
      location: normalizeLocations(job),
      salary: formatPay(job.pay_input_ranges),
      description: htmlToPlainText(job.content) || null,
      // Prefer Greenhouse's canonical URL; fall back to what the user pasted.
      jobUrl: job.absolute_url ?? url.toString(),
      postedDate: job.updated_at ?? null,
    };
  },
};

/**
 * Pulls the board token and numeric job id out of a Greenhouse posting URL.
 * Handles the two path forms (`/{board}/jobs/{id}`) and the embedded
 * `/embed/job_app?token={id}&for={board}` form. Throws when the path isn't a
 * recognizable single posting.
 */
function parseGreenhouseUrl(url: URL): { boardToken: string; jobId: string } {
  // Embedded application form: token=jobId, for=boardToken.
  if (url.pathname.replace(/\/+$/, "") === "/embed/job_app") {
    const jobId = url.searchParams.get("token")?.trim();
    const boardToken = url.searchParams.get("for")?.trim();
    if (boardToken && jobId && /^\d+$/.test(jobId)) {
      return { boardToken, jobId };
    }
    throw unsupported();
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const jobsIdx = segments.indexOf("jobs");
  const boardToken = segments[0];
  const jobId = jobsIdx >= 0 ? segments[jobsIdx + 1] : undefined;

  if (
    !boardToken ||
    jobsIdx <= 0 ||
    !jobId ||
    !/^\d+$/.test(jobId)
  ) {
    throw unsupported();
  }

  return { boardToken, jobId };
}

function unsupported(): ScrapeError {
  return new ScrapeError(
    "UNSUPPORTED_URL",
    "That doesn't look like a single Greenhouse job posting. Paste the URL of a specific role."
  );
}

/**
 * Greenhouse's single-job object doesn't always carry the company's display
 * name, so we derive a readable default from the board token
 * (`acme-corp` -> `Acme Corp`). It's a prefill the user can correct.
 */
function companyNameFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Merges the primary location and any office names into a deduped string array.
 */
function normalizeLocations(job: GreenhouseJob): string[] {
  const values: string[] = [];
  if (typeof job.location?.name === "string" && job.location.name.trim()) {
    values.push(job.location.name.trim());
  }
  if (Array.isArray(job.offices)) {
    for (const office of job.offices) {
      if (typeof office?.name === "string" && office.name.trim()) {
        values.push(office.name.trim());
      }
    }
  }
  return [...new Set(values)];
}

/**
 * Formats the first pay range into a human-readable summary
 * (`$150,000 - $200,000` / `$150,000 - $200,000 CAD`). Amounts arrive in cents.
 * Returns null when no usable range is present.
 */
function formatPay(
  ranges: GreenhouseJob["pay_input_ranges"]
): string | null {
  const range = ranges?.find(
    (r) => typeof r.min_cents === "number" || typeof r.max_cents === "number"
  );
  if (!range) return null;

  const currency =
    range.currency_type && range.currency_type !== "USD"
      ? ` ${range.currency_type}`
      : "";
  const min =
    typeof range.min_cents === "number" ? formatDollars(range.min_cents) : null;
  const max =
    typeof range.max_cents === "number" ? formatDollars(range.max_cents) : null;

  if (min && max) return `${min} - ${max}${currency}`;
  return `${min ?? max}${currency}`;
}

function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Greenhouse returns the job description as an HTML-escaped HTML string. This
 * unescapes it, drops the markup (keeping block boundaries as line breaks), and
 * decodes any entities left in the text, yielding readable plain text similar
 * to what other boards expose directly.
 */
function htmlToPlainText(content: string | undefined): string {
  if (!content) return "";

  // 1. Unescape the outer layer to recover the real HTML.
  const html = decodeEntities(content);
  // 2. Preserve block boundaries, then strip all remaining tags.
  const stripped = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  // 3. Decode entities that lived inside the description text itself.
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decodes the small set of HTML entities Greenhouse content uses. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*160;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    // Ampersand last so we don't re-trigger the named entities above.
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
