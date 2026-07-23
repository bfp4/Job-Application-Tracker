import puppeteer, { type Browser, type Page } from "puppeteer-core";

/**
 * Fields this service can realistically fill in from a LOGGED-OUT public
 * LinkedIn profile page. Anything LinkedIn only shows to signed-in viewers
 * (email, phone, full experience history) is out of scope for the
 * public-page-only approach.
 */
export interface ScrapedLinkedInProfile {
  name: string | null;
  position: string | null;
}

/**
 * Thrown for any failure during a scrape — network error, navigation
 * timeout, LinkedIn serving a login wall instead of the profile, or a
 * non-OK HTTP response. The route handler catches this specifically to set
 * Contact.scrapedStatus to FAILED (see the ScrapedStatus enum in
 * schema.prisma) instead of treating it as an unexpected 500 — a blocked
 * scrape is an expected outcome here, not a bug.
 */
export class LinkedInScrapeError extends Error {}

const NAVIGATION_TIMEOUT_MS = 15_000;

// Debian's apt-installed Chromium path in the prod container (ARM64 — the
// bundled puppeteer download doesn't cover linux-arm64, see server/Dockerfile
// for the apt-get install step). Override locally via PUPPETEER_EXECUTABLE_PATH
// if your dev machine doesn't have Chromium installed at this path.
const EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium";

// A realistic desktop UA lowers the odds of an immediate bot-detection wall
// compared to headless Chrome's default UA string.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Candidate selectors for LinkedIn's public (logged-out) profile markup,
// most specific first. LinkedIn changes class names often and without
// notice — if scrapes start silently coming back with null fields, this is
// the first place to check against the page's current HTML.
const NAME_SELECTORS = [
  "h1.top-card-layout__title",
  "h1.text-heading-xlarge",
  "h1",
];
const POSITION_SELECTORS = [
  "h2.top-card-layout__headline",
  ".top-card-layout__headline",
  ".text-body-medium.break-words",
];

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--single-process"],
  });
}

/** Tries each selector in order, returning the first non-empty text match. */
async function extractText(
  page: Page,
  selectors: string[]
): Promise<string | null> {
  for (const selector of selectors) {
    const text = await page
      .$eval(selector, (el) => el.textContent?.trim() ?? "")
      .catch(() => "");
    if (text) return text;
  }
  return null;
}

/**
 * Scrapes the public (logged-out) LinkedIn profile page at `profileUrl` for
 * whatever fields are visible without signing in. Throws LinkedInScrapeError
 * on any failure, including LinkedIn serving a login wall instead of the
 * profile — that happens unpredictably and on its own isn't a bug.
 *
 * Caller is responsible for persisting the result: this function does not
 * touch Prisma (see server/src/services/resumeTips.ts for the same
 * separation — the route updates Contact.scrapedStatus/scrapedAt/fields,
 * not the service).
 */
export async function scrapeLinkedInProfile(
  profileUrl: string
): Promise<ScrapedLinkedInProfile> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.setUserAgent({ userAgent: USER_AGENT });
    await page.setViewport({ width: 1280, height: 900 });

    let response;
    try {
      response = await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    } catch (err) {
      throw new LinkedInScrapeError(
        `Failed to load profile page: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response || !response.ok()) {
      throw new LinkedInScrapeError(
        `LinkedIn returned an unexpected response (status ${response?.status() ?? "unknown"}).`
      );
    }

    const finalUrl = page.url();
    if (
      finalUrl.includes("/authwall") ||
      finalUrl.includes("/login") ||
      finalUrl.includes("/checkpoint")
    ) {
      throw new LinkedInScrapeError(
        "LinkedIn served a login wall instead of the profile — public scraping is blocked intermittently and this is an expected outcome, not a bug."
      );
    }

    // Give client-rendered content a beat to show up. Non-fatal if it never
    // does — extraction below just returns null for whatever isn't there.
    await page.waitForSelector("h1", { timeout: 5000 }).catch(() => {});

    const [name, position] = await Promise.all([
      extractText(page, NAME_SELECTORS),
      extractText(page, POSITION_SELECTORS),
    ]);

    return { name, position };
  } finally {
    await browser.close();
  }
}
