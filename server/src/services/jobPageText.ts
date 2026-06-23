import { prisma } from "../lib/prisma";

const FETCH_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Ignore tiny extractions (error pages, bot blocks, empty shells). */
const MIN_USEFUL_TEXT_LENGTH = 200;

const FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

function isFetchableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

/** Converts HTML into plain text, keeping all visible copy on the page. */
export function htmlToPlainText(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withBreaks = withoutBlocks.replace(
    /<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi,
    " "
  );

  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim();
}

async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BODY_BYTES) break;
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Fetches a job posting URL and returns all visible text from the page.
 * Returns null when the URL is invalid, the request fails, or extraction
 * yields too little content.
 */
export async function fetchJobPageText(url: string): Promise<string | null> {
  if (!isFetchableUrl(url)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: FETCH_HEADERS,
      redirect: "follow",
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }

    const html = await readResponseText(response);
    const text = htmlToPlainText(html);
    return text.length >= MIN_USEFUL_TEXT_LENGTH ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export interface JobWithPageUrl {
  id: string;
  jobUrl: string | null;
  description: string | null;
}

/**
 * Fetches each job's redirect URL, extracts the full page text, and uses that
 * for scoring. When extraction succeeds and beats the Adzuna snippet, the
 * longer text is persisted on the JobPosting row.
 */
export async function enrichJobsWithPageText<T extends JobWithPageUrl>(
  jobs: T[]
): Promise<T[]> {
  const enriched = await mapConcurrent(jobs, FETCH_CONCURRENCY, async (job) => {
    const url = job.jobUrl?.trim();
    if (!url || !isFetchableUrl(url)) return job;

    const pageText = await fetchJobPageText(url);
    if (!pageText) return job;

    const snippetLength = job.description?.trim().length ?? 0;
    if (pageText.length <= snippetLength) return job;

    try {
      await prisma.jobPosting.update({
        where: { id: job.id },
        data: { description: pageText },
      });
    } catch (err) {
      console.error(`Failed to persist full description for job ${job.id}:`, err);
    }

    return { ...job, description: pageText };
  });

  return enriched;
}
