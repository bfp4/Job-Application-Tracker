"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { SearchResultJob } from "@/lib/types";

const JOB_SEARCH_DISABLED_MESSAGE =
  "Job search is temporarily unavailable while resume handling is being updated.";

export default function SearchPage() {
  const [results, setResults] = useState<SearchResultJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadResults() {
    setLoading(true);
    setError(null);
    try {
      const resultsData = await apiJson<{ results: SearchResultJob[] }>("/api/search/results");
      setResults(resultsData.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadResults();
  }, []);

  async function handleTrack(jobPostingId: string) {
    setTrackingId(jobPostingId);
    setError(null);
    try {
      const response = await apiFetch("/api/applications", {
        method: "POST",
        body: JSON.stringify({ jobPostingId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to track job.");
      }
      setResults((prev) =>
        prev.map((job) => (job.id === jobPostingId ? { ...job, isTracked: true } : job))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to track job.");
    } finally {
      setTrackingId(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Search</h1>
            <p className="mt-1 text-sm text-gray-500">
              The job-search agent searches the web for postings matching your resume.
            </p>
          </div>
          <button
            type="button"
            disabled
            title={JOB_SEARCH_DISABLED_MESSAGE}
            className="shrink-0 cursor-not-allowed rounded-md bg-gray-400 px-4 py-2 text-sm font-medium text-white opacity-60"
          >
            Run search
          </button>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Job search is not available right now</p>
          <p className="mt-1">{JOB_SEARCH_DISABLED_MESSAGE}</p>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">Loading results…</p>
        ) : results.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-gray-500">
              No past results to show. Upload a resume in{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>{" "}
              so you&apos;re ready when search is back.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">
              Showing results from previous searches. New searches cannot be run until job search
              is re-enabled.
            </p>
            <ul className="space-y-3">
              {results.map((job) => (
                <li
                  key={job.id}
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a
                        href={job.jobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {job.title}
                      </a>
                      <p className="text-sm text-gray-600">
                        {job.company?.name ?? "—"}
                        {job.location ? ` · ${job.location}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {job.matchScore !== null && (
                        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                          {job.matchScore}% match
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleTrack(job.id)}
                        disabled={job.isTracked || trackingId === job.id}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {job.isTracked
                          ? "Tracked"
                          : trackingId === job.id
                            ? "Tracking…"
                            : "Track this job"}
                      </button>
                    </div>
                  </div>

                  {job.description && (
                    <p className="mt-3 text-sm text-gray-600">{job.description}</p>
                  )}

                  {job.matchReasons.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {job.matchReasons.map((reason, i) => (
                        <li
                          key={i}
                          className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700"
                        >
                          {reason}
                        </li>
                      ))}
                    </ul>
                  )}

                  {job.postedDate && (
                    <p className="mt-3 text-xs text-gray-400">
                      Posted {formatDate(job.postedDate)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
