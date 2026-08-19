import { NormalizedPosting, Scraper, ScrapeError } from "../types";
import { companyNameFromSlug, htmlToPlainText } from "../html";

const WORKABLE_APPLY_HOST = "apply.workable.com";
/** Legacy per-account host, `{account}.workable.com/j/{shortcode}`. */
const WORKABLE_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.workable\.com$/i;
/** Workable shortcodes are uppercase alphanumeric, e.g. `D029850682`. */
const SHORTCODE_RE = /^[A-Z0-9]{6,20}$/i;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Shape of Workable's public job endpoint. Only the fields we consume are
 * typed; the endpoint returns more. Everything is optional because it's an
 * external contract we don't control.
 */
interface WorkableJob {
  title?: string;
  location?: WorkableLocation;
  locations?: WorkableLocation[];
  workplace?: string;
  remote?: boolean;
  published?: string;
  // The description is split across three HTML blocks on the posting page.
  description?: string;
  requirements?: string;
  benefits?: string;
  // Only present when the account publishes pay for the role.
  salary?: {
    salary_from?: number;
    salary_to?: number;
    salary_currency?: string;
  };
}

interface WorkableLocation {
  country?: string;
  region?: string | null;
  city?: string;
  hidden?: boolean;
}

interface WorkableAccount {
  name?: string;
}

/**
 * Workable serves every careers page from a public JSON API — the same one the
 * apply.workable.com SPA calls — so this is an API client, not an HTML scraper.
 * A posting URL is `https://apply.workable.com/{account}/j/{shortcode}/` (older
 * links use `https://{account}.workable.com/j/{shortcode}`), and the posting
 * itself is at `/api/v1/accounts/{account}/jobs/{shortcode}`.
 */
export const workableScraper: Scraper = {
  source: "workable",

  matches(url: URL): boolean {
    if (url.hostname.toLowerCase() === WORKABLE_APPLY_HOST) return true;
    // `www.workable.com` is the marketing site, not a careers board.
    const account = url.hostname.match(WORKABLE_HOST_RE)?.[1];
    return account !== undefined && account.toLowerCase() !== "www";
  },

  async scrape(url: URL): Promise<NormalizedPosting> {
    const { account, shortcode } = parseWorkableUrl(url);
    const base = `https://${WORKABLE_APPLY_HOST}/api/v1/accounts/${encodeURIComponent(
      account
    )}`;

    // The job payload has no company name on it, so the account is fetched
    // alongside it purely for the display name. It's a prefill, so a failure
    // there falls back to the slug rather than failing the whole autofill.
    const [jobRes, accountRes] = await Promise.all([
      getJson(`${base}/jobs/${encodeURIComponent(shortcode)}`),
      getJson(base).catch(() => null),
    ]);

    // A 404 covers both a closed/unlisted posting and an account that doesn't
    // exist — Workable doesn't distinguish, and neither reading helps the user
    // any more than "check the URL".
    if (jobRes.status === 404) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or the URL is wrong."
      );
    }
    if (!jobRes.ok) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Workable returned an unexpected error. Please try again in a moment."
      );
    }

    const job = (await readJson<WorkableJob>(jobRes)) ?? null;
    if (!job) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Workable returned a response we couldn't read. Please try again."
      );
    }

    const accountName = accountRes?.ok
      ? (await readJson<WorkableAccount>(accountRes))?.name?.trim()
      : undefined;

    return {
      title: job.title?.trim() || "Untitled role",
      companyName: accountName || companyNameFromSlug(account),
      location: normalizeLocations(job),
      salary: formatSalary(job.salary),
      description: buildDescription(job),
      // Canonical posting URL, rebuilt so a legacy or /apply link normalizes.
      jobUrl: `https://${WORKABLE_APPLY_HOST}/${account}/j/${shortcode}/`,
      postedDate: job.published ?? null,
    };
  },
};

/** Fetches a URL, mapping network failures onto a ScrapeError. */
async function getJson(apiUrl: string): Promise<Response> {
  try {
    return await fetch(apiUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ScrapeError(
      "UPSTREAM_ERROR",
      "Couldn't reach Workable. Please try again in a moment."
    );
  }
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Pulls the account slug and posting shortcode out of a Workable URL. Handles
 * `apply.workable.com/{account}/j/{shortcode}` and the legacy per-account host
 * `{account}.workable.com/j/{shortcode}`, tolerating a trailing `/apply`.
 */
function parseWorkableUrl(url: URL): { account: string; shortcode: string } {
  const segments = url.pathname.split("/").filter(Boolean);
  const hostAccount = url.hostname.match(WORKABLE_HOST_RE)?.[1];

  // On the per-account host the path starts at `/j/`; on apply.workable.com the
  // account is the first path segment.
  const [account, ...rest] =
    url.hostname.toLowerCase() === WORKABLE_APPLY_HOST
      ? segments
      : [hostAccount, ...segments];

  const [marker, shortcode] = rest;
  if (!account || marker !== "j" || !shortcode || !SHORTCODE_RE.test(shortcode)) {
    throw new ScrapeError(
      "UNSUPPORTED_URL",
      "That doesn't look like a single Workable job posting. Paste the URL of a specific role."
    );
  }

  return { account, shortcode: shortcode.toUpperCase() };
}

/**
 * The posting page renders three separate HTML blocks in order; the tracker
 * stores one description field, so they're concatenated as they read.
 */
function buildDescription(job: WorkableJob): string | null {
  const text = [job.description, job.requirements, job.benefits]
    .map((part) => htmlToPlainText(part))
    .filter(Boolean)
    .join("\n\n");
  return text || null;
}

/**
 * Builds a deduped list of readable locations. Entries flagged `hidden` are the
 * ones the posting page itself doesn't show, so they're skipped. A remote role
 * is listed as such, since Workable models that as a flag rather than a place.
 */
function normalizeLocations(job: WorkableJob): string[] {
  const entries =
    job.locations && job.locations.length > 0
      ? job.locations
      : job.location
      ? [job.location]
      : [];

  const values: string[] = [];
  if (job.workplace === "remote" || job.remote === true) values.push("Remote");

  for (const entry of entries) {
    if (!entry || entry.hidden === true) continue;
    const label = [entry.city, entry.region, entry.country]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(", ");
    if (label) values.push(label);
  }

  return [...new Set(values)];
}

/** Formats a published pay range (`$150,000 - $200,000`, `€90,000 EUR`). */
function formatSalary(salary: WorkableJob["salary"]): string | null {
  const from = typeof salary?.salary_from === "number" ? salary.salary_from : null;
  const to = typeof salary?.salary_to === "number" ? salary.salary_to : null;
  if (from === null && to === null) return null;

  const currency = salary?.salary_currency?.trim().toUpperCase();
  const suffix = currency && currency !== "USD" ? ` ${currency}` : "";
  const amount = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  if (from !== null && to !== null) {
    return `${amount(from)} - ${amount(to)}${suffix}`;
  }
  return `${amount((from ?? to) as number)}${suffix}`;
}
