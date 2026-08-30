import { NormalizedPosting, Scraper, ScrapeError } from "../types";
import { companyNameFromSlug, htmlToPlainText } from "../html";

const GEM_HOST = "jobs.gem.com";
const GEM_API = `https://${GEM_HOST}/api/public/graphql`;
const BOARD_ID_RE = /^[a-z0-9][a-z0-9-]*$/i;
// Gem-native ids are URL-safe base64-like strings; imported ATS ids may be
// numeric. Both use only this URL-safe character set.
const POSTING_ID_RE = /^[a-z0-9_-]+$/i;
const FETCH_TIMEOUT_MS = 8000;

const EXTERNAL_JOB_POSTING_QUERY = `
  query ExternalJobPosting($boardId: String!, $extId: String!) {
    oatsExternalJobPosting(boardId: $boardId, extId: $extId) {
      title
      descriptionHtml
      extId
      firstPublishedTsSec
      locations {
        name
        city
        isoCountry
        isRemote
      }
      job {
        teamDisplayName
        locations {
          name
          city
          isoCountry
          isRemote
        }
      }
      jobPostSectionHtml {
        introHtml
        outroHtml
      }
      compensationHtml
    }
  }
`;

interface GemLocation {
  name?: string | null;
  city?: string | null;
  isoCountry?: string | null;
  isRemote?: boolean | null;
}

interface GemJobPosting {
  title?: string | null;
  descriptionHtml?: string | null;
  extId?: string | null;
  firstPublishedTsSec?: number | string | null;
  locations?: GemLocation[] | null;
  job?: {
    teamDisplayName?: string | null;
    locations?: GemLocation[] | null;
  } | null;
  jobPostSectionHtml?: {
    introHtml?: string | null;
    outroHtml?: string | null;
  } | null;
  compensationHtml?: string | null;
}

interface GemGraphqlResponse {
  data?: { oatsExternalJobPosting?: GemJobPosting | null } | null;
  errors?: unknown;
}

/**
 * Gem Career Sites are backed by a public GraphQL endpoint. The posting route
 * is `https://jobs.gem.com/{boardId}/{externalPostingId}` and the page itself
 * requests `oatsExternalJobPosting` with those two path values.
 */
export const gemScraper: Scraper = {
  source: "gem",

  matches(url: URL): boolean {
    return url.hostname.toLowerCase() === GEM_HOST;
  },

  async scrape(url: URL): Promise<NormalizedPosting> {
    const { boardId, postingId } = parseGemUrl(url);

    let res: Response;
    try {
      res = await fetch(GEM_API, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operationName: "ExternalJobPosting",
          variables: { boardId, extId: postingId },
          query: EXTERNAL_JOB_POSTING_QUERY,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Couldn't reach Gem. Please try again in a moment."
      );
    }

    if (res.status === 404) {
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that Gem posting — it may have been closed or the URL is wrong."
      );
    }
    if (!res.ok) {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Gem returned an unexpected error. Please try again in a moment."
      );
    }

    let payload: GemGraphqlResponse;
    try {
      payload = (await res.json()) as GemGraphqlResponse;
    } catch {
      throw new ScrapeError(
        "UPSTREAM_ERROR",
        "Gem returned a response we couldn't read. Please try again."
      );
    }

    const posting = payload.data?.oatsExternalJobPosting;
    // Gem returns a successful GraphQL response with a null posting when the
    // board/id pair is unknown or the role is no longer public.
    if (!posting) {
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new ScrapeError(
          "UPSTREAM_ERROR",
          "Gem returned an unexpected error. Please try again in a moment."
        );
      }
      throw new ScrapeError(
        "NOT_FOUND",
        "Couldn't find that Gem posting — it may have been closed or unlisted."
      );
    }

    return {
      title: posting.title?.trim() || "Untitled role",
      companyName:
        posting.job?.teamDisplayName?.trim() || companyNameFromSlug(boardId),
      location: normalizeLocations(posting),
      salary: htmlToPlainText(posting.compensationHtml) || null,
      description: buildDescription(posting),
      jobUrl: `https://${GEM_HOST}/${boardId}/${postingId}`,
      postedDate: normalizePublishedDate(posting.firstPublishedTsSec),
    };
  },
};

/** Accepts a posting link, plus Gem's optional trailing `/application` route. */
function parseGemUrl(url: URL): { boardId: string; postingId: string } {
  const segments = url.pathname.split("/").filter(Boolean);
  const [boardId, postingId, ...rest] = segments;
  const allowedSuffix =
    rest.length === 0 ||
    (rest.length === 1 && rest[0].toLowerCase() === "application");

  if (
    !boardId ||
    !postingId ||
    !BOARD_ID_RE.test(boardId) ||
    !POSTING_ID_RE.test(postingId) ||
    !allowedSuffix
  ) {
    throw new ScrapeError(
      "UNSUPPORTED_URL",
      "That doesn't look like a single Gem job posting. Paste the URL of a specific role."
    );
  }

  return { boardId, postingId };
}

/** The posting-specific locations take precedence over all locations on the job. */
function normalizeLocations(posting: GemJobPosting): string[] {
  const locations =
    posting.locations && posting.locations.length > 0
      ? posting.locations
      : posting.job?.locations ?? [];

  const values = locations
    .map((location) => {
      const name = location?.name?.trim();
      if (name) return name;
      if (location?.isRemote) return "Remote";
      return [location?.city, location?.isoCountry]
        .map((part) => part?.trim() || "")
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean);

  return [...new Set(values)];
}

/** Gem renders the board intro, role body, and board outro in that order. */
function buildDescription(posting: GemJobPosting): string | null {
  const text = [
    posting.jobPostSectionHtml?.introHtml,
    posting.descriptionHtml,
    posting.jobPostSectionHtml?.outroHtml,
  ]
    .map((section) => htmlToPlainText(section))
    .filter(Boolean)
    .join("\n\n");

  return text || null;
}

/** Gem publishes Unix seconds; invalid or absent values should stay empty. */
function normalizePublishedDate(
  value: number | string | null | undefined
): string | null {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
