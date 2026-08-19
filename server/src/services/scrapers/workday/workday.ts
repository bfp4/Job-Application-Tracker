import { NormalizedPosting, Scraper, ScrapeError } from "../types";
import { companyNameFromSlug, htmlToPlainText } from "../html";

/** `{tenant}.wd{n}.myworkdayjobs.com` — the tenant is the first label. */
const WORKDAY_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.wd\d+\.myworkdayjobs\.com$/i;
/** A leading locale segment Workday puts in front of the site id, e.g. `en-US`. */
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]+)?$/;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Shape of Workday's CXS job-detail response. Only the fields we consume are
 * typed; the endpoint returns more. Everything is optional because it's an
 * external contract we don't control.
 */
interface WorkdayJobDetail {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: unknown;
    startDate?: string;
    externalUrl?: string;
  };
}

/**
 * Every Workday careers site is a SPA backed by a public "CXS" JSON endpoint —
 * the same one the page itself calls — so this is an API client, not an HTML
 * scraper. A posting URL is
 * `https://{tenant}.wd{n}.myworkdayjobs.com/[{locale}/]{site}/job/{location}/{postingId}`
 * (Workday also links the same posting as `/details/{postingId}`), and the
 * detail endpoint mirrors it at
 * `https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{...}`.
 *
 * Note that Workday exposes no compensation field here, so `salary` is always
 * null — pay, when a tenant publishes it at all, is prose inside the
 * description.
 */
export const workdayScraper: Scraper = {
  source: "workday",

  matches(url: URL): boolean {
    return WORKDAY_HOST_RE.test(url.hostname);
  },

  async scrape(url: URL): Promise<NormalizedPosting> {
    const { tenant, site, jobPath } = parseWorkdayUrl(url);

    const apiUrl = `https://${url.hostname}/wday/cxs/${tenant}/${site}/job/${jobPath}`;

    let res: Response;
    try {
      res = await fetch(apiUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Couldn't reach Workday. Please try again in a moment."
      );
    }

    // 404 is a posting that doesn't exist; Workday answers 422 for a tenant or
    // career site that doesn't exist (the hostname wildcards, so a typo'd
    // tenant resolves and still reaches us here).
    if (res.status === 404 || res.status === 422) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or the URL is wrong."
      );
    }
    if (!res.ok) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Workday returned an unexpected error. Please try again in a moment."
      );
    }

    let detail: WorkdayJobDetail;
    try {
      detail = (await res.json()) as WorkdayJobDetail;
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Workday returned a response we couldn't read. Please try again."
      );
    }

    const info = detail.jobPostingInfo;
    if (!info) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or unlisted."
      );
    }

    return {
      title: info.title?.trim() || "Untitled role",
      companyName: companyNameFromSlug(tenant),
      location: normalizeLocations(info),
      // Workday's posting API carries no pay range.
      salary: null,
      description: htmlToPlainText(info.jobDescription) || null,
      // Prefer Workday's canonical URL; fall back to what the user pasted.
      jobUrl: info.externalUrl ?? url.toString(),
      // `postedOn` is a rendered string ("Posted Today"); startDate is the date.
      postedDate: info.startDate ?? null,
    };
  },
};

/**
 * Pulls the tenant, career-site id and job path out of a Workday posting URL.
 * The tenant comes from the hostname; the path is
 * `[{locale}/]{site}/(job|details)/{...rest}`. Both link forms resolve to the
 * CXS `/job/{...rest}` endpoint, so the `details` form is simply rewritten.
 * Path segments are passed through still-encoded — job paths contain spaces and
 * slashes that must stay escaped exactly as Workday wrote them.
 */
function parseWorkdayUrl(url: URL): {
  tenant: string;
  site: string;
  jobPath: string;
} {
  const tenant = url.hostname.match(WORKDAY_HOST_RE)?.[1];
  // `matches` already gated on the host, so this is a type narrowing.
  if (!tenant) throw unsupported();

  const segments = url.pathname.split("/").filter(Boolean);
  // An optional locale prefix. Guard on there being a site id after it, so a
  // two-letter career-site name isn't mistaken for a locale.
  if (segments.length > 2 && LOCALE_RE.test(segments[0])) {
    segments.shift();
  }

  const [site, kind, ...rest] = segments;
  if (!site || (kind !== "job" && kind !== "details") || rest.length === 0) {
    throw unsupported();
  }

  return { tenant, site, jobPath: rest.join("/") };
}

function unsupported(): ScrapeError {
  return new ScrapeError(
    "UNSUPPORTED_URL",
    "That doesn't look like a single Workday job posting. Paste the URL of a specific role."
  );
}

/**
 * Merges the primary location and any additional ones into a deduped string
 * array. `additionalLocations` is a plain string array in practice, but it's an
 * external contract, so this coerces defensively.
 */
function normalizeLocations(
  info: NonNullable<WorkdayJobDetail["jobPostingInfo"]>
): string[] {
  const values: string[] = [];
  if (typeof info.location === "string" && info.location.trim()) {
    values.push(info.location.trim());
  }
  if (Array.isArray(info.additionalLocations)) {
    for (const entry of info.additionalLocations) {
      if (typeof entry === "string" && entry.trim()) values.push(entry.trim());
    }
  }
  return [...new Set(values)];
}
