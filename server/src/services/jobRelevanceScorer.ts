import type { ResumeKeywords } from "../types/keywords";

/**
 * Minimum fields a job needs for relevance scoring. Kept structural (rather
 * than tied to NormalizedJob) so the scorer works directly on the persisted
 * JobPosting rows the search route hands back — preserving their `id`,
 * `company`, etc. for the client.
 */
export interface ScorableJob {
  title: string;
  description: string | null;
  postedDate: Date | string | null;
}

/** A job enriched with an in-process keyword relevance score. */
export type ScoredJob<T extends ScorableJob = ScorableJob> = T & {
  /** 0-100 relevance score (0 when scoring was not applied). */
  relevanceScore: number;
  /** Technology keywords that matched, for display. */
  matchedKeywords: string[];
};

export interface ScoreOptions {
  /** When true, drop jobs with relevanceScore 0 after sorting. */
  matchesOnly?: boolean;
}

const TECH_POINTS = 8;
const TECH_TITLE_BONUS = 4;
const TECH_CAP = 60;

const ROLE_WORD_POINTS = 5;
const ROLE_CAP = 25;

const DOMAIN_WORD_POINTS = 5;
const DOMAIN_CAP = 15;

/** Words shorter than this are too generic to score on (e.g. "a", "of"). */
const MIN_WORD_LENGTH = 3;

/** Strips HTML tags and normalises whitespace — never truncates content. */
function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lowercases and treats common tech-list separators (/, |, ,, etc.) as word
 * boundaries so "Typescript/React/Javascript" tokenises cleanly.
 */
function normalizeForMatching(value: string): string {
  return plainText(value)
    .toLowerCase()
    .replace(/[/\\|,;+&·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses a token for fuzzy tech comparison (Node.js → nodejs). */
function foldToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits normalised text into tokens (handles slash/comma-separated lists). */
function tokenize(text: string): string[] {
  return normalizeForMatching(text)
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= MIN_WORD_LENGTH);
}

/**
 * Case-insensitive whole-term match with separator-aware token comparison.
 * Always searches the full `text` — tokens are an optional precomputed index.
 */
function containsTerm(text: string, term: string, tokens?: string[]): boolean {
  const needle = normalizeForMatching(term);
  if (!needle) return false;

  const haystack = normalizeForMatching(text);
  const termTokens = tokenize(needle);
  const haystackTokens = tokens ?? tokenize(haystack);
  const foldedNeedle = foldToken(needle);

  if (termTokens.length > 1) {
    const foldedHay = new Set(haystackTokens.map(foldToken));
    return termTokens.every(
      (part) =>
        haystackTokens.includes(part) || foldedHay.has(foldToken(part))
    );
  }

  for (const token of haystackTokens) {
    if (token === needle || foldToken(token) === foldedNeedle) return true;
  }

  const escaped = escapeRegex(needle);
  const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return pattern.test(haystack);
}

function toMillis(value: Date | string | null): number {
  if (value === null) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

interface ScoreResult {
  relevanceScore: number;
  matchedKeywords: string[];
}

/**
 * Scores a single job's title + full description against resume keywords.
 * The entire description is scanned for every keyword; score caps do not
 * stop matching early.
 */
function scoreJob(
  title: string,
  description: string | null,
  keywords: ResumeKeywords
): ScoreResult {
  const titleText = plainText(title);
  const descText = plainText(description ?? "");
  const titleTokens = tokenize(titleText);
  const descTokens = tokenize(descText);
  const combinedText = `${titleText} ${descText}`.trim();
  const combinedTokens = [...titleTokens, ...descTokens];

  let techScore = 0;
  const matchedKeywords: string[] = [];
  for (const tech of keywords.technologies) {
    const inTitle = containsTerm(titleText, tech, titleTokens);
    const inDesc = containsTerm(descText, tech, descTokens);
    if (!inTitle && !inDesc) continue;

    if (!matchedKeywords.includes(tech)) matchedKeywords.push(tech);

    if (techScore >= TECH_CAP) continue;

    let points = TECH_POINTS;
    if (inTitle) points += TECH_TITLE_BONUS;
    techScore = Math.min(TECH_CAP, techScore + points);
  }

  let roleScore = 0;
  const roleWords = new Set(keywords.roles.flatMap((role) => tokenize(role)));
  for (const word of roleWords) {
    if (roleScore >= ROLE_CAP) break;
    if (containsTerm(combinedText, word, combinedTokens)) {
      roleScore = Math.min(ROLE_CAP, roleScore + ROLE_WORD_POINTS);
    }
  }

  let domainScore = 0;
  const domainWords = new Set(
    keywords.domains.flatMap((domain) => tokenize(domain))
  );
  for (const word of domainWords) {
    if (domainScore >= DOMAIN_CAP) break;
    if (containsTerm(combinedText, word, combinedTokens)) {
      domainScore = Math.min(DOMAIN_CAP, domainScore + DOMAIN_WORD_POINTS);
    }
  }

  return {
    relevanceScore: techScore + roleScore + domainScore,
    matchedKeywords,
  };
}

/**
 * Scores each job against the user's resume keywords and sorts by relevance.
 *
 * - When `useKeywords` is false or `keywords` is null, returns jobs untouched
 *   (original order) with relevanceScore 0 and no matched keywords.
 * - Otherwise scores each job (pure in-process string matching — no API calls),
 *   sorts by score descending with a stable tie-break on original order, and
 *   pushes zero-score jobs to the bottom ordered by postedDate descending.
 * - When `options.matchesOnly` is true, jobs with score 0 are removed.
 */
export function scoreAndSortJobs<T extends ScorableJob>(
  jobs: T[],
  keywords: ResumeKeywords | null,
  useKeywords: boolean,
  options?: ScoreOptions
): ScoredJob<T>[] {
  if (!useKeywords || keywords === null) {
    return jobs.map((job) => ({
      ...job,
      relevanceScore: 0,
      matchedKeywords: [],
    }));
  }

  const scored = jobs.map((job, index) => {
    const { relevanceScore, matchedKeywords } = scoreJob(
      job.title,
      job.description,
      keywords
    );
    return { job, index, relevanceScore, matchedKeywords };
  });

  scored.sort((a, b) => {
    if (a.relevanceScore === 0 && b.relevanceScore === 0) {
      const diff = toMillis(b.job.postedDate) - toMillis(a.job.postedDate);
      return diff !== 0 ? diff : a.index - b.index;
    }
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return a.index - b.index;
  });

  const results = scored.map(({ job, relevanceScore, matchedKeywords }) => ({
    ...job,
    relevanceScore,
    matchedKeywords,
  }));

  if (options?.matchesOnly) {
    return results.filter((job) => job.relevanceScore > 0);
  }

  return results;
}

export default scoreAndSortJobs;
