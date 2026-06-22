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

type ExperienceLevel = "entry" | "mid" | "senior";

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

type TrackState = "idle" | "tracking" | "tracked" | "error";

type RankState = "idle" | "ranking" | "ranked";

/** A search result optionally enriched with an AI Smart Rank fit assessment. */
type RankedJobPosting = JobPosting & {
  fitScore?: number | null;
  fitReason?: string | null;
};

function pageNumbers(current: number, total: number): number[] {
  if (total <= 1) return [1];
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/** Color-codes a fit score badge: green 70+, yellow 40-69, red below 40. */
function fitBadgeClasses(score: number): string {
  if (score >= 70) return "bg-green-50 text-green-700 ring-green-200";
  if (score >= 40) return "bg-yellow-50 text-yellow-700 ring-yellow-200";
  return "bg-red-50 text-red-700 ring-red-200";
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");
  const [experienceLevel, setExperienceLevel] =
    useState<ExperienceLevel | null>(null);

  const [jobs, setJobs] = useState<RankedJobPosting[] | null>(null);
  const [pagination, setPagination] = useState<JobSearchPagination | null>(
    null
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasSearched, setHasSearched] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [trackState, setTrackState] = useState<Record<string, TrackState>>({});

  const [rankState, setRankState] = useState<RankState>("idle");
  const [toast, setToast] = useState<string | null>(null);

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
      // A fresh page of results invalidates any prior Smart Rank ordering.
      setRankState("idle");
      setToast(null);

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
    [query, location, postedWithin, experienceLevel, page, pageSize]
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

  async function handleSmartRank() {
    if (!jobs || jobs.length === 0) return;

    setRankState("ranking");
    setToast(null);

    try {
      const res = await apiFetch("/api/jobs/smart-rank", {
        method: "POST",
        body: JSON.stringify({ jobs }),
      });

      if (!res.ok) {
        if (res.status === 400) {
          setToast("Upload a resume in Settings to use Smart Rank");
        } else {
          setToast(
            "Smart ranking unavailable — showing results by date instead"
          );
        }
        setRankState("idle");
        return;
      }

      const data = (await res.json()) as {
        jobs: Array<{
          externalId: string;
          fitScore: number | null;
          fitReason: string | null;
        }>;
      };

      // Claude failed if every returned job came back without a score; the
      // server preserved the original order, so keep showing results by date.
      const anyScored = data.jobs.some((j) => j.fitScore !== null);
      if (!anyScored) {
        setToast(
          "Smart ranking unavailable — showing results by date instead"
        );
        setRankState("idle");
        return;
      }

      // Merge scores back onto the current postings (matched by externalId) and
      // reorder to mirror the server's fitScore-descending ranking.
      const byExternalId = new Map(jobs.map((job) => [job.externalId, job]));
      const reordered: RankedJobPosting[] = [];
      for (const scored of data.jobs) {
        const original = byExternalId.get(scored.externalId);
        if (!original) continue;
        reordered.push({
          ...original,
          fitScore: scored.fitScore,
          fitReason: scored.fitReason,
        });
        byExternalId.delete(scored.externalId);
      }
      // Append any postings the server didn't return a score for, in case.
      for (const leftover of byExternalId.values()) {
        reordered.push(leftover);
      }

      setJobs(reordered);
      setRankState("ranked");
    } catch {
      setToast("Smart ranking unavailable — showing results by date instead");
      setRankState("idle");
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

        {toast && (
          <div className="flex items-start justify-between gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="shrink-0 font-medium text-amber-700 hover:text-amber-900"
              aria-label="Dismiss"
            >
              ✕
            </button>
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
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSmartRank}
                  disabled={rankState === "ranking"}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset disabled:opacity-50 ${
                    rankState === "ranked"
                      ? "bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100"
                      : "bg-gray-900 text-white ring-gray-900 hover:bg-gray-800"
                  }`}
                >
                  {rankState === "ranking"
                    ? "Ranking…"
                    : rankState === "ranked"
                      ? "✓ Smart Ranked · Re-rank"
                      : "✨ Smart Rank"}
                </button>
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
                        <div className="flex items-center gap-2">
                          {typeof job.fitScore === "number" && (
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${fitBadgeClasses(
                                job.fitScore
                              )}`}
                            >
                              {job.fitScore}
                            </span>
                          )}
                          <h2 className="font-medium text-gray-900">
                            {job.title}
                          </h2>
                        </div>
                        {job.fitReason && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            {job.fitReason}
                          </p>
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
