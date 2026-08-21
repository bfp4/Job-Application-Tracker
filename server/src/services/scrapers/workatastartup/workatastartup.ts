import { NormalizedPosting, Scraper, ScrapeError } from "../types";
import { companyNameFromSlug, decodeEntities, htmlToPlainText } from "../html";

/** `workatastartup.com`, with or without the `www.` label. */
const WAAS_HOST_RE = /^(www\.)?workatastartup\.com$/i;
/** Postings are addressed by a numeric id: `/jobs/104197`. */
const JOB_ID_RE = /^\d+$/;
/**
 * The Inertia page object the server embeds in the document. There's exactly
 * one per page, and the attribute value is HTML-escaped, so a `"` inside the
 * JSON is always `&quot;` and can't terminate the match early.
 */
const DATA_PAGE_RE = /data-page="([^"]*)"/;
/** Inertia component name for a single posting, as opposed to a company page. */
const JOB_COMPONENT = "JobDetailPage";
/**
 * Work at a Startup answers 406 to a request whose `Accept` is the wildcard
 * that fetch sends by default, so this header is required, not cosmetic.
 */
const ACCEPT_HTML = "text/html,application/xhtml+xml";
const FETCH_TIMEOUT_MS = 8000;

/**
 * Shape of the `props` on a job page. Only the fields we consume are typed; the
 * page carries more (founder bios, the company's other roles, the apply URL).
 * Everything is optional because it's an external contract we don't control.
 */
interface WaasPage {
  component?: string;
  props?: {
    job?: WaasJob;
    company?: WaasCompany;
  };
}

interface WaasJob {
  id?: number;
  title?: string;
  /** Pre-rendered ranges, e.g. `$150K - $250K` and `0.10% - 1.00%`. */
  salaryRange?: string | null;
  equityRange?: string | null;
  /** One string; several locations are joined with ` / `. */
  location?: string | null;
  skills?: unknown;
  descriptionHtml?: string;
  interviewProcessHtml?: string;
}

interface WaasCompany {
  name?: string;
  slug?: string;
}

/**
 * Work at a Startup (YC's job board) is an Inertia.js app: the server renders
 * the shell with the page's entire prop tree serialized into a single
 * `data-page` attribute, and the client hydrates from it. So one GET of the
 * posting URL yields the same structured JSON the page itself renders from —
 * no DOM traversal, and nothing that depends on markup or class names.
 *
 * Requesting that JSON directly (Inertia's `X-Inertia` header) isn't an option:
 * the server answers 409 unless the request echoes the current asset version,
 * which is a per-deploy hash only obtainable from the HTML we'd be skipping.
 *
 * Postings are public — only *applying* needs a YC account — and robots.txt
 * disallows nothing.
 */
export const workatastartupScraper: Scraper = {
  source: "workatastartup",

  matches(url: URL): boolean {
    return WAAS_HOST_RE.test(url.hostname);
  },

  async scrape(url: URL): Promise<NormalizedPosting> {
    const jobId = parseWaasUrl(url);
    const pageUrl = `https://www.workatastartup.com/jobs/${jobId}`;

    let res: Response;
    try {
      res = await fetch(pageUrl, {
        headers: { accept: ACCEPT_HTML },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Couldn't reach Work at a Startup. Please try again in a moment."
      );
    }

    // A closed or never-existent posting is a plain 404 error page.
    if (res.status === 404) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or the URL is wrong."
      );
    }
    if (!res.ok) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Work at a Startup returned an unexpected error. Please try again in a moment."
      );
    }

    let html: string;
    try {
      html = await res.text();
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Work at a Startup returned a response we couldn't read. Please try again."
      );
    }

    const page = parsePageData(html);
    const job = page.props?.job;
    // The component name is what separates a posting from the company page and
    // the logged-out landing page, both of which are served as a 200.
    if (!job || !page.component?.includes(JOB_COMPONENT)) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that posting — it may have been closed or unlisted."
      );
    }
    const company = page.props?.company ?? {};

    return {
      title: job.title?.trim() || "Untitled role",
      companyName: company.name?.trim() || companyNameFromSlug(company.slug ?? ""),
      location: normalizeLocations(job.location),
      salary: formatCompensation(job),
      description: buildDescription(job),
      // Canonical posting URL, rebuilt so a no-www or query-tagged link
      // normalizes to the one YC itself links.
      jobUrl: pageUrl,
      // The page exposes no publication date, in the props or the markup.
      postedDate: null,
    };
  },
};

/**
 * Pulls the posting id out of a `/jobs/{id}` URL. Anything else on the host —
 * `/companies/{slug}`, the signed-in job search, the marketing pages — is not a
 * single posting and is rejected before a request goes out.
 */
function parseWaasUrl(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const [section, id, ...rest] = segments;

  if (section !== "jobs" || !id || !JOB_ID_RE.test(id) || rest.length > 0) {
    throw new ScrapeError(
      "UNSUPPORTED_URL",
      "That doesn't look like a single Work at a Startup job posting. Paste the URL of a specific role."
    );
  }

  return id;
}

/**
 * Extracts and decodes the Inertia page object. The attribute is HTML-escaped
 * exactly once, so decoding it once yields the original JSON — including any
 * entity the description text legitimately contains (an escaped `&amp;` arrives
 * as `&amp;amp;` and decodes back to `&amp;`, not to a bare `&`).
 */
function parsePageData(html: string): WaasPage {
  const encoded = html.match(DATA_PAGE_RE)?.[1];
  if (!encoded) {
    throw new ScrapeError(
      "UPSTREAM_ERROR",
      "Work at a Startup returned a page we couldn't read. Please try again."
    );
  }

  try {
    return JSON.parse(decodeEntities(encoded)) as WaasPage;
  } catch {
    throw new ScrapeError(
      "UPSTREAM_ERROR",
      "Work at a Startup returned a page we couldn't read. Please try again."
    );
  }
}

/**
 * Splits YC's single location string into the tracker's list. Multiple
 * locations are joined with ` / ` ("San Francisco / Remote (US)"); the commas
 * inside one entry are part of it ("TX, US"), so only the slash separates.
 */
function normalizeLocations(location: string | null | undefined): string[] {
  if (typeof location !== "string") return [];

  const values = location
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return [...new Set(values)];
}

/**
 * Builds the free-text salary field. YC publishes equity beside pay and it's a
 * real part of the offer at this stage, so both are kept when both are given:
 * `$150K - $250K + 0.10% - 1.00% equity`. The ranges are already formatted for
 * display, so they're passed through as written.
 */
function formatCompensation(job: WaasJob): string | null {
  const salary = job.salaryRange?.trim();
  const equity = job.equityRange?.trim();

  const parts: string[] = [];
  if (salary) parts.push(salary);
  if (equity) parts.push(`${equity} equity`);

  return parts.join(" + ") || null;
}

/**
 * The posting page renders the role description, the skills the company tagged
 * it with, and its interview process as three separate blocks; the tracker
 * stores one description, so they're concatenated in page order. The latter two
 * are labelled, because a bare list of technologies or of interview stages
 * reads as part of the description without one.
 */
function buildDescription(job: WaasJob): string | null {
  const sections = [
    htmlToPlainText(job.descriptionHtml),
    formatSkills(job.skills),
    prefixed("Interview process", htmlToPlainText(job.interviewProcessHtml)),
  ].filter(Boolean);

  return sections.join("\n\n") || null;
}

function prefixed(label: string, body: string): string {
  return body ? `${label}\n${body}` : "";
}

function formatSkills(skills: unknown): string {
  if (!Array.isArray(skills)) return "";

  const values = skills
    .map((skill) => (typeof skill === "string" ? skill.trim() : ""))
    .filter(Boolean);

  return values.length > 0 ? `Skills: ${values.join(", ")}` : "";
}
