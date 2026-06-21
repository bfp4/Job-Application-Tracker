"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type {
  JobPosting,
  JobSearchPagination,
} from "@/lib/types";

type PostedWithin = "any" | "day" | "week" | "month";

const POSTED_OPTIONS: { value: PostedWithin; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "day", label: "Past 24 hours" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

type TrackState = "idle" | "tracking" | "tracked" | "error";

function pageNumbers(current: number, total: number): number[] {
  if (total <= 1) return [1];
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");

  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [pagination, setPagination] = useState<JobSearchPagination | null>(
    null
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasSearched, setHasSearched] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [trackState, setTrackState] = useState<Record<string, TrackState>>({});

  const runSearch = useCallback(
    async (options?: {
      page?: number;
      pageSize?: number;
      resetTrack?: boolean;
    }) => {
      const targetPage = options?.page ?? page;
      const targetPageSize = options?.pageSize ?? pageSize;

      setError(null);
      setLoading(true);
      if (options?.resetTrack) setTrackState({});

      try {
        const res = await apiFetch("/api/jobs/search", {
          method: "POST",
          body: JSON.stringify({
            query: query.trim(),
            location: location.trim(),
            page: targetPage,
            resultsPerPage: targetPageSize,
            ...(postedWithin !== "any" ? { postedWithin } : {}),
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Search failed. Please try again.");
        }

        const data = (await res.json()) as {
          jobs: JobPosting[];
          pagination: JobSearchPagination;
        };

        setJobs(data.jobs);
        setPagination(data.pagination);
        setPage(data.pagination.page);
        setPageSize(data.pagination.pageSize);
        setHasSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
        setJobs(null);
        setPagination(null);
      } finally {
        setLoading(false);
      }
    },
    [query, location, postedWithin, page, pageSize]
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
    setPage(nextPage);
    runSearch({ page: nextPage });
  }

  function handlePageSizeChange(nextSize: number) {
    setPageSize(nextSize);
    setPage(1);
    if (hasSearched) {
      runSearch({ page: 1, pageSize: nextSize });
    }
  }

  async function handleTrack(jobPostingId: string) {
    setTrackState((prev) => ({ ...prev, [jobPostingId]: "tracking" }));
    try {
      const res = await apiFetch("/api/applications", {
        method: "POST",
        body: JSON.stringify({ jobPostingId }),
      });
      if (!res.ok) throw new Error("Failed to track job.");
      setTrackState((prev) => ({ ...prev, [jobPostingId]: "tracked" }));
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
              No jobs found. Try a different title or location.
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
              <p className="text-sm text-gray-600">
                Showing {rangeStart}–{rangeEnd} of {totalCount} results
              </p>
              <div className="flex items-center gap-2">
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

                      <div className="shrink-0">
                        {state === "tracked" ? (
                          <Link
                            href="/applications"
                            className="inline-flex items-center rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-200 hover:bg-green-100"
                          >
                            Tracked ✓
                          </Link>
                        ) : (
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
                        )}
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
