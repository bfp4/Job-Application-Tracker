import { ashbyScraper } from "./ashby";
import { greenhouseScraper } from "./greenhouse";
import { NormalizedPosting, Scraper, ScrapeError } from "./types";

export { ScrapeError } from "./types";
export type { NormalizedPosting } from "./types";

/**
 * Registered board providers, tried in order. Adding a new board (Lever, an
 * AI/HTML fallback) is a matter of appending a {@link Scraper} here — the route
 * and the client contract don't change.
 */
const scrapers: Scraper[] = [ashbyScraper, greenhouseScraper];

export interface ScrapeResult {
  /** Which provider handled the URL, e.g. "ashby". */
  source: string;
  jobPosting: NormalizedPosting;
}

/**
 * Resolves a pasted job URL to a normalized posting preview. Throws
 * {@link ScrapeError} for every expected failure (bad URL, unsupported host,
 * missing posting, upstream error) so callers can map codes to HTTP statuses.
 */
export async function scrapeJobPosting(rawUrl: string): Promise<ScrapeResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ScrapeError("INVALID_URL", "That isn't a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError("INVALID_URL", "Only http(s) URLs are supported.");
  }

  const scraper = scrapers.find((s) => s.matches(url));
  if (!scraper) {
    throw new ScrapeError(
      "UNSUPPORTED_URL",
      "Only AshbyHQ and Greenhouse job URLs are supported right now."
    );
  }

  const jobPosting = await scraper.scrape(url);
  return { source: scraper.source, jobPosting };
}
