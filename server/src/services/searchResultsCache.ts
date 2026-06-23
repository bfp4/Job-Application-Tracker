import { prisma } from "../lib/prisma";
import type { IngestionSummary } from "./jobIngestion";

/** How long identical searches reuse stored results before re-fetching Adzuna. */
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SearchCacheLookup {
  userId: string;
  query: string;
  location: string;
  postedWithin: string;
  experienceLevel: string;
  keywordsUsed: boolean;
  page: number;
  pageSize: number;
}

/** Stored job rows — scored fields optional (Smart Search only). */
export interface CachedSearchJob {
  id: string;
  title: string;
  description: string | null;
  relevanceScore?: number;
  matchedKeywords?: string[];
  postedDate: Date | string | null;
  [key: string]: unknown;
}

export interface CachedSearchPayload {
  summary: IngestionSummary;
  /** Scored or plain job rows; tracked / matches-only filters applied on read. */
  jobs: CachedSearchJob[];
  adzunaTotalCount: number;
}

export interface SearchCacheHit {
  payload: CachedSearchPayload;
  cachedAt: Date;
}

export function searchCacheExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + SEARCH_CACHE_TTL_MS);
}

export function buildSearchCacheLookup(input: {
  userId: string;
  query: string;
  location: string;
  postedWithin?: string | null;
  experienceLevel?: string | null;
  keywordsUsed: boolean;
  page: number;
  pageSize: number;
  smartSearchPoolSize: number;
}): SearchCacheLookup {
  return {
    userId: input.userId,
    query: input.query,
    location: input.location,
    postedWithin: input.postedWithin ?? "",
    experienceLevel: input.experienceLevel ?? "",
    keywordsUsed: input.keywordsUsed,
    // Smart Search always caches the full ranked pool under a fixed key.
    page: input.keywordsUsed ? 1 : input.page,
    pageSize: input.keywordsUsed ? input.smartSearchPoolSize : input.pageSize,
  };
}

const CACHE_UNIQUE_KEY =
  "userId_query_location_postedWithin_experienceLevel_keywordsUsed_page_pageSize" as const;

function toCacheWhere(lookup: SearchCacheLookup) {
  return { [CACHE_UNIQUE_KEY]: lookup };
}

export async function getValidSearchCache(
  lookup: SearchCacheLookup
): Promise<SearchCacheHit | null> {
  const row = await prisma.searchResultsCache.findUnique({
    where: toCacheWhere(lookup),
  });

  if (!row || row.expiresAt <= new Date()) {
    return null;
  }

  return {
    payload: row.payload as unknown as CachedSearchPayload,
    cachedAt: row.cachedAt,
  };
}

export async function saveSearchCache(
  lookup: SearchCacheLookup,
  payload: CachedSearchPayload
): Promise<void> {
  const expiresAt = searchCacheExpiresAt();

  await prisma.searchResultsCache.upsert({
    where: toCacheWhere(lookup),
    create: {
      ...lookup,
      payload: payload as object,
      expiresAt,
    },
    update: {
      payload: payload as object,
      cachedAt: new Date(),
      expiresAt,
    },
  });

  // Best-effort cleanup so the table doesn't grow forever.
  void prisma.searchResultsCache
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((err) => console.error("Search cache cleanup failed:", err));
}
