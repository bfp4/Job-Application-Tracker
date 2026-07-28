import type { Application } from "@/lib/types";

/**
 * Sorting and filtering for the applications list. Lives here rather than in
 * the page component so it can be exercised directly, without mounting the
 * page and its Next.js/Firebase dependencies.
 */

export const SORT_OPTIONS = [
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "appliedDate-desc", label: "Applied date (newest)" },
  { value: "appliedDate-asc", label: "Applied date (oldest)" },
  { value: "company-asc", label: "Company (A–Z)" },
  { value: "title-asc", label: "Title (A–Z)" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["value"];

export function compareApplications(
  sortKey: SortKey,
  a: Application,
  b: Application
): number {
  switch (sortKey) {
    case "createdAt-desc":
      return b.createdAt.localeCompare(a.createdAt);
    case "createdAt-asc":
      return a.createdAt.localeCompare(b.createdAt);
    case "appliedDate-desc":
    case "appliedDate-asc": {
      // Applications without an applied date sort last in either direction.
      if (!a.appliedDate && !b.appliedDate) return 0;
      if (!a.appliedDate) return 1;
      if (!b.appliedDate) return -1;
      return sortKey === "appliedDate-desc"
        ? b.appliedDate.localeCompare(a.appliedDate)
        : a.appliedDate.localeCompare(b.appliedDate);
    }
    case "company-asc":
      return (a.jobPosting?.company?.name ?? "").localeCompare(
        b.jobPosting?.company?.name ?? "",
        undefined,
        { sensitivity: "base" }
      );
    case "title-asc":
      return (a.jobPosting?.title ?? "").localeCompare(b.jobPosting?.title ?? "", undefined, {
        sensitivity: "base",
      });
  }
}

/** `query` is expected pre-trimmed and lowercased by the caller. */
export function matchesSearch(app: Application, query: string): boolean {
  const haystack = [
    app.jobPosting?.company?.name,
    app.jobPosting?.title,
    app.source,
    ...(app.jobPosting?.location ?? []),
  ];
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

/** Filters by search text, then sorts — the order the list renders in. */
export function visibleApplications(
  applications: Application[],
  search: string,
  sortKey: SortKey
): Application[] {
  const query = search.trim().toLowerCase();
  const filtered = query
    ? applications.filter((app) => matchesSearch(app, query))
    : applications;
  return [...filtered].sort((a, b) => compareApplications(sortKey, a, b));
}
