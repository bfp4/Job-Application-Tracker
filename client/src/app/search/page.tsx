"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AppShell from "@/components/AppShell";
import KeywordGroups from "@/components/KeywordGroups";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type {
  JobPosting,
  JobSearchPagination,
  ResumeKeywords,
} from "@/lib/types";

type PostedWithin = "any" | "day" | "week" | "month";

const POSTED_OPTIONS: { value: PostedWithin; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "day", label: "Past 24 hours" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
];

type ExperienceLevel = "entry" | "mid" | "senior";

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

const MAX_KEYWORD_CHIPS = 4;

type TrackState = "idle" | "tracking" | "error";

/** A search result enriched with the server's keyword relevance scoring. */
type ScoredJobPosting = JobPosting & {
  relevanceScore?: number;
  matchedKeywords?: string[];
};

function pageNumbers(current: number, total: number): number[] {
  if (total <= 1) return [1];
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function paginateJobs<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function buildPagination(
  totalCount: number,
  page: number,
  pageSize: number
): JobSearchPagination {
  return {
    page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");
  const [experienceLevel, setExperienceLevel] =
    useState<ExperienceLevel | null>(null);

  const [jobs, setJobs] = useState<ScoredJobPosting[] | null>(null);
  /** Full ranked pool from Smart Search — paginated client-side. */
  const [rankedPool, setRankedPool] = useState<ScoredJobPosting[] | null>(null);
  const [keywordsUsed, setKeywordsUsed] = useState(false);
  const [pagination, setPagination] = useState<JobSearchPagination | null>(
    null
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasSearched, setHasSearched] = useState(false);
  const [resultsCached, setResultsCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [trackState, setTrackState] = useState<Record<string, TrackState>>({});

  // Smart Search: resume keywords are appended to the query server-side.
  const [keywords, setKeywords] = useState<ResumeKeywords | null>(null);
  const [smartSearch, setSmartSearch] = useState(false);
  const [savingPref, setSavingPref] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);

  const hasKeywords =
    keywords !== null && keywords.technologies.length > 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/user/keywords");
        if (!res.ok) return;
        const data = (await res.json()) as {
          keywords: ResumeKeywords | null;
          keywordsEnabled: boolean;
        };
        if (cancelled) return;
        setKeywords(data.keywords);
        setSmartSearch(data.keywordsEnabled && data.keywords !== null);
      } catch {
        // Non-fatal: Smart Search simply stays off if we can't load keywords.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleSmartSearch() {
    const next = !smartSearch;
    setSmartSearch(next);
    setSavingPref(true);
    try {
      const res = await apiFetch("/api/user/preferences", {
        method: "PATCH",
        body: JSON.stringify({ keywordsEnabled: next }),
      });
      if (!res.ok) throw new Error("Failed to update preference.");
    } catch {
      // Revert the optimistic toggle if the save failed.
      setSmartSearch(!next);
    } finally {
      setSavingPref(false);
    }
  }

  const runSearch = useCallback(
    async (options?: {
      page?: number;
      pageSize?: number;
      resetTrack?: boolean;
      refresh?: boolean;
    }) => {
      const targetPage = options?.page ?? page;
      const targetPageSize = options?.pageSize ?? pageSize;

      setError(null);
      setLoading(true);
      if (options?.resetTrack) setTrackState({});

      const smartSearchActive = smartSearch && hasKeywords;

      try {
        const res = await apiFetch("/api/jobs/search", {
          method: "POST",
          body: JSON.stringify({
            query: query.trim(),
            location: location.trim(),
            page: targetPage,
            resultsPerPage: targetPageSize,
            ...(postedWithin !== "any" ? { postedWithin } : {}),
            ...(experienceLevel ? { experienceLevel } : {}),
            useKeywords: smartSearchActive,
            ...(options?.refresh ? { refresh: true } : {}),
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Search failed. Please try again.");
        }

        const data = (await res.json()) as {
          jobs: ScoredJobPosting[];
          keywordsUsed?: boolean;
          clientPagination?: boolean;
          cached?: boolean;
          cachedAt?: string;
          pagination: JobSearchPagination;
        };

        setResultsCached(data.cached ?? false);
        setCachedAt(data.cachedAt ?? null);

        if (data.clientPagination) {
          setRankedPool(data.jobs);
          setKeywordsUsed(true);
          setPage(targetPage);
          setPageSize(targetPageSize);
          setJobs(paginateJobs(data.jobs, targetPage, targetPageSize));
          setPagination(
            buildPagination(data.jobs.length, targetPage, targetPageSize)
          );
        } else {
          setRankedPool(null);
          setJobs(data.jobs);
          setKeywordsUsed(data.keywordsUsed ?? false);
          setPagination(data.pagination);
          setPage(data.pagination.page);
          setPageSize(data.pagination.pageSize);
        }
        setHasSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
        setJobs(null);
        setRankedPool(null);
        setPagination(null);
        setResultsCached(false);
        setCachedAt(null);
      } finally {
        setLoading(false);
      }
    },
    [
      query,
      location,
      postedWithin,
      experienceLevel,
      page,
      pageSize,
      smartSearch,
      hasKeywords,
    ]
  );

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    runSearch({ page: 1, resetTrack: true });
  }

  function handlePageChange(nextPage: number) {
    if (
      loading ||
      !pagination ||
      nextPage < 1 ||
      nextPage > pagination.totalPages
    ) {
      return;
    }

    if (rankedPool) {
      setPage(nextPage);
      setJobs(paginateJobs(rankedPool, nextPage, pageSize));
      setPagination(buildPagination(rankedPool.length, nextPage, pageSize));
      return;
    }

    setPage(nextPage);
    runSearch({ page: nextPage });
  }

  function handlePageSizeChange(nextSize: number) {
    setPageSize(nextSize);
    setPage(1);
    if (!hasSearched) return;

    if (rankedPool) {
      setJobs(paginateJobs(rankedPool, 1, nextSize));
      setPagination(buildPagination(rankedPool.length, 1, nextSize));
      return;
    }

    runSearch({ page: 1, pageSize: nextSize });
  }

  async function handleTrack(jobPostingId: string) {
    setTrackState((prev) => ({ ...prev, [jobPostingId]: "tracking" }));
    try {
      const res = await apiFetch("/api/applications", {
        method: "POST",
        body: JSON.stringify({ jobPostingId }),
      });
      if (!res.ok) throw new Error("Failed to track job.");
      if (rankedPool) {
        const next = rankedPool.filter((job) => job.id !== jobPostingId);
        const newTotalPages = Math.max(1, Math.ceil(next.length / pageSize));
        const newPage = Math.min(page, newTotalPages);
        setRankedPool(next);
        setPage(newPage);
        setJobs(paginateJobs(next, newPage, pageSize));
        setPagination(buildPagination(next.length, newPage, pageSize));
      } else {
        setJobs((prev) => prev?.filter((job) => job.id !== jobPostingId) ?? prev);
      }
      setTrackState((prev) => {
        const next = { ...prev };
        delete next[jobPostingId];
        return next;
      });
    } catch {
      setTrackState((prev) => ({ ...prev, [jobPostingId]: "error" }));
    }
  }

  const totalCount = pagination?.totalCount ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const rangeStart =
    totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Search jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Find postings and track the ones you want to apply to.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                ✨ Smart Search
              </p>
              <p className="mt-0.5 text-sm text-gray-500">
                Enhances your search with keywords from your resume
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={smartSearch}
              aria-label="Smart Search"
              disabled={!hasKeywords || savingPref}
              onClick={handleToggleSmartSearch}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                smartSearch && hasKeywords ? "bg-violet-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  smartSearch && hasKeywords ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {!hasKeywords && (
            <p className="mt-2 text-xs text-gray-400">
              Upload a resume to enable Smart Search
            </p>
          )}

          {hasKeywords && smartSearch && keywords && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => setShowKeywords((v) => !v)}
                className="text-sm font-medium text-violet-700 hover:text-violet-900"
              >
                {showKeywords ? "Hide your keywords ▴" : "See your keywords ▾"}
              </button>
              {showKeywords && (
                <div className="mt-3 space-y-2">
                  <KeywordGroups keywords={keywords} />
                  <p className="text-xs text-gray-400">
                    These were extracted from your resume. Re-upload your resume
                    to update them.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSearch}
          className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end"
        >
          <div>
            <label
              htmlFor="query"
              className="block text-sm font-medium text-gray-700"
            >
              Job title
            </label>
            <input
              id="query"
              type="text"
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Frontend Engineer"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="location"
              className="block text-sm font-medium text-gray-700"
            >
              Location
            </label>
            <input
              id="location"
              type="text"
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Remote, New York"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="postedWithin"
              className="block text-sm font-medium text-gray-700"
            >
              Posted within
            </label>
            <select
              id="postedWithin"
              value={postedWithin}
              onChange={(e) => setPostedWithin(e.target.value as PostedWithin)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            >
              {POSTED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>

          <div className="sm:col-span-full">
            <span className="block text-sm font-medium text-gray-700">
              Experience level{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </span>
            <div className="mt-1 inline-flex rounded-md border border-gray-300 p-0.5">
              {EXPERIENCE_OPTIONS.map((opt) => {
                const active = experienceLevel === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setExperienceLevel((prev) =>
                        prev === opt.value ? null : opt.value
                      )
                    }
                    className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </form>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-sm text-gray-500">Fetching the latest postings…</p>
        )}

        {!loading && hasSearched && jobs !== null && jobs.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              {totalCount > 0
                ? "No new jobs on this page — you may have already tracked these results. Try another page or search."
                : "No jobs found. Try a different title or location."}
            </p>
          </div>
        )}

        {!loading && !hasSearched && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              Search for a job title and location to see results.
            </p>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-600">
                  Showing {rangeStart}–{rangeEnd} of {totalCount} results
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {keywordsUsed
                    ? "Sorted by relevance to your skills"
                    : "Sorted by date"}
                  {resultsCached && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => runSearch({ refresh: true })}
                        disabled={loading}
                        className="text-violet-600 hover:text-violet-800 disabled:opacity-50"
                        title={
                          cachedAt
                            ? `Cached at ${new Date(cachedAt).toLocaleString()}`
                            : undefined
                        }
                      >
                        Cached results — refresh
                      </button>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="pageSize"
                  className="text-sm text-gray-600"
                >
                  Per page
                </label>
                <select
                  id="pageSize"
                  value={pageSize}
                  disabled={loading}
                  onChange={(e) =>
                    handlePageSizeChange(Number(e.target.value))
                  }
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none disabled:opacity-50"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <ul className="space-y-3">
              {jobs.map((job) => {
                const state = trackState[job.id] ?? "idle";
                const matched =
                  keywordsUsed && job.matchedKeywords
                    ? job.matchedKeywords
                    : [];
                return (
                  <li
                    key={job.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h2 className="font-medium text-gray-900">
                          {job.title}
                        </h2>
                        {matched.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {matched.slice(0, MAX_KEYWORD_CHIPS).map((kw) => (
                              <span
                                key={kw}
                                className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200"
                              >
                                {kw}
                              </span>
                            ))}
                            {matched.length > MAX_KEYWORD_CHIPS && (
                              <span className="inline-flex items-center text-xs font-medium text-gray-400">
                                +{matched.length - MAX_KEYWORD_CHIPS} more
                              </span>
                            )}
                          </div>
                        )}
                        <p className="mt-0.5 text-sm text-gray-600">
                          {job.company?.name ?? "Unknown company"}
                          {job.location ? ` · ${job.location}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          Posted {formatDate(job.postedDate)}
                          {job.jobUrl && (
                            <>
                              {" · "}
                              <a
                                href={job.jobUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-600 underline hover:text-gray-900"
                              >
                                View original
                              </a>
                            </>
                          )}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleTrack(job.id)}
                          disabled={state === "tracking"}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {state === "tracking"
                            ? "Tracking…"
                            : state === "error"
                              ? "Retry"
                              : "Track this job"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {totalPages > 1 && (
              <nav
                className="flex flex-wrap items-center justify-center gap-1"
                aria-label="Search results pages"
              >
                <button
                  type="button"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={loading || page <= 1}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>

                {pageNumbers(page, totalPages).map((pageNum) => (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => handlePageChange(pageNum)}
                    disabled={loading}
                    className={`min-w-[2.25rem] rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                      pageNum === page
                        ? "bg-gray-900 text-white"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={loading || page >= totalPages}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </nav>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
