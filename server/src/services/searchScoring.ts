/**
 * Recency-weighted ranking for a user's saved searches.
 *
 * This is the single source of truth for how searches are ranked. Both
 * GET /api/search-preferences and digestService.ts import {@link computeSearchScore}
 * rather than re-implementing the formula, so ranking stays consistent everywhere.
 */

/**
 * Half-life (in days) of a search's recency weight. After this many days since a
 * query was last searched, its contribution to its score is roughly halved.
 */
export const SEARCH_SCORE_HALF_LIFE_DAYS = 14;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Computes a recency-weighted score for a saved search.
 *
 * This is exponential decay: a search's contribution to its score roughly halves
 * every {@link SEARCH_SCORE_HALF_LIFE_DAYS} days since it was last searched. So a
 * query searched many times long ago naturally fades below a query searched only a
 * few times recently — frequent *and* recent searches rank highest.
 *
 * @param searchCount    How many times this query has been run.
 * @param lastSearchedAt When the query was most recently run.
 * @param now            Reference "current time" (defaults to Date.now()); injectable for tests.
 * @returns A non-negative score; higher means a stronger recommendation candidate.
 */
export function computeSearchScore(
  searchCount: number,
  lastSearchedAt: Date,
  now: Date = new Date()
): number {
  const daysSinceLastSearch =
    (now.getTime() - lastSearchedAt.getTime()) / MS_PER_DAY;
  const recencyWeight = Math.exp(
    -daysSinceLastSearch / SEARCH_SCORE_HALF_LIFE_DAYS
  );
  return searchCount * recencyWeight;
}

/** Minimal shape needed to rank a saved search. */
interface RankableSearch {
  pinned: boolean;
  searchCount: number;
  lastSearchedAt: Date;
}

/**
 * Orders saved searches the way the digest and search-preferences API both expect:
 * pinned searches first (preserving their relative order from the input — typically
 * pin order), then unpinned searches by {@link computeSearchScore} descending.
 *
 * Shared so GET /api/search-preferences and digestService.ts produce identical
 * rankings. Returns at most `limit` items.
 */
export function rankSearchQueries<T extends RankableSearch>(
  queries: T[],
  limit: number,
  now: Date = new Date()
): T[] {
  const pinned = queries.filter((q) => q.pinned);
  const unpinned = queries
    .filter((q) => !q.pinned)
    .sort(
      (a, b) =>
        computeSearchScore(b.searchCount, b.lastSearchedAt, now) -
        computeSearchScore(a.searchCount, a.lastSearchedAt, now)
    );

  return [...pinned, ...unpinned].slice(0, limit);
}
