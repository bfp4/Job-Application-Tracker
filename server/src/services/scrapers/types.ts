/**
 * A job posting pulled from an external board, normalized to the fields the
 * add-job form (and `POST /api/jobs`) expects. This is a *preview* payload:
 * nothing here is written to the DB until the user confirms and submits.
 */
export interface NormalizedPosting {
  title: string;
  /**
   * Best-effort company name. Some providers (Ashby) don't return it on the
   * posting itself, so it may be derived from the URL and is meant to be
   * user-editable in the form.
   */
  companyName: string;
  location: string[];
  salary: string | null;
  description: string | null;
  /** Canonical posting URL, preferred over whatever the user pasted. */
  jobUrl: string;
  /** ISO-8601 string, or null when the board doesn't expose it. */
  postedDate: string | null;
}

/**
 * One board integration. `matches` is a cheap hostname check; `scrape` does the
 * network fetch and mapping. Providers throw {@link ScrapeError} for expected
 * failures so the route can map them to specific status codes.
 */
export interface Scraper {
  /** Stable identifier returned to the client, e.g. "ashby". */
  readonly source: string;
  matches(url: URL): boolean;
  scrape(url: URL): Promise<NormalizedPosting>;
}

export type ScrapeErrorCode =
  // Well-formed but not an http(s) URL, or not a URL at all.
  | "INVALID_URL"
  // No provider handles this host, or the path isn't a recognizable posting.
  | "UNSUPPORTED_URL"
  // Provider understood the URL but the posting doesn't exist / is unlisted.
  | "NOT_FOUND"
  // The board API failed, timed out, or returned an unexpected shape.
  | "UPSTREAM_ERROR";

/** Expected, user-facing failure. `message` is safe to show to the caller. */
export class ScrapeError extends Error {
  constructor(
    public readonly code: ScrapeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}
