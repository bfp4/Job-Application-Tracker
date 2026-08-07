import { describe, expect, it } from "vitest";
import {
  compareApplications,
  matchesSearch,
  visibleApplications,
  type SortKey,
} from "./applicationList";
import type { Application } from "../types";

function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    userId: "user-1",
    jobPostingId: "posting-1",
    status: "APPLIED",
    notes: null,
    source: null,
    appliedDate: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    jobPosting: {
      id: "posting-1",
      userId: "user-1",
      companyId: "company-1",
      title: "Software Engineer",
      description: null,
      location: ["New York, NY"],
      salary: null,
      jobUrl: "https://example.com/jobs/1",
      postedDate: null,
      fetchedAt: "2026-07-01T00:00:00.000Z",
      company: { id: "company-1", name: "Acme" },
    },
    ...overrides,
  } as Application;
}

/** Sorts ids by the given key, so assertions read as an expected order. */
function order(sortKey: SortKey, apps: Application[]): string[] {
  return [...apps].sort((a, b) => compareApplications(sortKey, a, b)).map((a) => a.id);
}

describe("compareApplications", () => {
  const older = makeApplication({ id: "older", createdAt: "2026-06-01T00:00:00.000Z" });
  const newer = makeApplication({ id: "newer", createdAt: "2026-07-01T00:00:00.000Z" });

  it("sorts by creation date in both directions", () => {
    expect(order("createdAt-desc", [older, newer])).toEqual(["newer", "older"]);
    expect(order("createdAt-asc", [older, newer])).toEqual(["older", "newer"]);
  });

  // Undated applications are the common case (nothing applied yet); they must
  // not push dated ones out of the way in either direction.
  it("sorts applications with no applied date last in both directions", () => {
    const dated = makeApplication({ id: "dated", appliedDate: "2026-07-01T00:00:00.000Z" });
    const alsoDated = makeApplication({
      id: "also-dated",
      appliedDate: "2026-06-01T00:00:00.000Z",
    });
    const undated = makeApplication({ id: "undated", appliedDate: null });

    expect(order("appliedDate-desc", [undated, dated, alsoDated])).toEqual([
      "dated",
      "also-dated",
      "undated",
    ]);
    expect(order("appliedDate-asc", [undated, dated, alsoDated])).toEqual([
      "also-dated",
      "dated",
      "undated",
    ]);
  });

  it("treats two undated applications as equal", () => {
    const a = makeApplication({ id: "a" });
    const b = makeApplication({ id: "b" });
    expect(compareApplications("appliedDate-desc", a, b)).toBe(0);
  });

  it("sorts company and title case-insensitively", () => {
    const zebra = makeApplication({
      id: "zebra",
      jobPosting: { ...makeApplication().jobPosting!, company: { id: "c", name: "zebra" } },
    });
    const apple = makeApplication({
      id: "apple",
      jobPosting: { ...makeApplication().jobPosting!, company: { id: "c", name: "Apple" } },
    });
    expect(order("company-asc", [zebra, apple])).toEqual(["apple", "zebra"]);
  });

  it("tolerates a missing posting or company", () => {
    const bare = makeApplication({ id: "bare", jobPosting: undefined });
    const named = makeApplication({ id: "named" });
    expect(() => order("company-asc", [bare, named])).not.toThrow();
    expect(() => order("title-asc", [bare, named])).not.toThrow();
  });
});

describe("matchesSearch", () => {
  const app = makeApplication({ source: "LinkedIn" });

  it.each([
    ["company", "acme"],
    ["title", "engineer"],
    ["source", "linkedin"],
    ["location", "new york"],
  ])("matches on %s", (_field, query) => {
    expect(matchesSearch(app, query)).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesSearch(app, "globex")).toBe(false);
  });

  it("does not throw when the fields it searches are absent", () => {
    const bare = makeApplication({ jobPosting: undefined, source: null });
    expect(matchesSearch(bare, "anything")).toBe(false);
  });
});

describe("visibleApplications", () => {
  const acme = makeApplication({ id: "acme", createdAt: "2026-06-01T00:00:00.000Z" });
  const globex = makeApplication({
    id: "globex",
    createdAt: "2026-07-01T00:00:00.000Z",
    jobPosting: { ...makeApplication().jobPosting!, company: { id: "c2", name: "Globex" } },
  });

  it("returns everything when the search is blank or whitespace", () => {
    expect(visibleApplications([acme, globex], "   ", "createdAt-desc")).toHaveLength(2);
  });

  it("filters before sorting", () => {
    const result = visibleApplications([acme, globex], "globex", "createdAt-desc");
    expect(result.map((a) => a.id)).toEqual(["globex"]);
  });

  it("does not mutate the input array", () => {
    const input = [acme, globex];
    visibleApplications(input, "", "createdAt-asc");
    expect(input.map((a) => a.id)).toEqual(["acme", "globex"]);
  });
});
