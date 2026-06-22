"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import BaseResumeSection from "@/components/BaseResumeSection";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import type { SearchQuery } from "@/lib/types";

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();

  const [searches, setSearches] = useState<SearchQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/search-preferences");
        if (!res.ok) throw new Error("Failed to load search preferences.");
        const data = (await res.json()) as { searches: SearchQuery[] };
        if (!cancelled) setSearches(data.searches);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  async function handleTogglePin(search: SearchQuery) {
    setBusyId(search.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/search-preferences/${search.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !search.pinned }),
      });
      if (!res.ok) throw new Error("Failed to update search.");
      const data = (await res.json()) as { search: SearchQuery };
      setSearches((prev) =>
        prev.map((s) => (s.id === search.id ? data.search : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update search.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(search: SearchQuery) {
    setBusyId(search.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/search-preferences/${search.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to remove search.");
      }
      setSearches((prev) => prev.filter((s) => s.id !== search.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove search.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your resume and job search preferences.
          </p>
        </div>

        <section>
          <h2 className="text-lg font-semibold text-gray-900">
            Search preferences
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            We use your most frequent recent searches to recommend jobs each
            morning. Pin a search to always include it regardless of how often
            you use it.
          </p>

          {error && (
            <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
            {loading ? (
              <p className="p-6 text-center text-sm text-gray-500">
                Loading your searches…
              </p>
            ) : searches.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">
                No searches yet. Run a job search and it&apos;ll show up here.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {searches.map((search) => {
                  const busy = busyId === search.id;
                  return (
                    <li
                      key={search.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">
                          {search.query}
                          <span className="font-normal text-gray-500">
                            {" · "}
                            {search.location}
                          </span>
                          {search.pinned && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
                              Pinned
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          Searched {search.searchCount}{" "}
                          {search.searchCount === 1 ? "time" : "times"} · last on{" "}
                          {formatDate(search.lastSearchedAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleTogglePin(search)}
                          disabled={busy}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {search.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(search)}
                          disabled={busy}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <BaseResumeSection />
      </div>
    </AppShell>
  );
}
