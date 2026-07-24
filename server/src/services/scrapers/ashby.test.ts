import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeJobPosting, ScrapeError } from "./index";

const ORG = "acme-corp";
const POSTING_ID = "11111111-2222-3333-4444-555555555555";
const POSTING_URL = `https://jobs.ashbyhq.com/${ORG}/${POSTING_ID}`;

function ashbyJob(overrides: Record<string, unknown> = {}) {
  return {
    id: POSTING_ID,
    title: "Senior Backend Engineer",
    location: "New York, NY",
    secondaryLocations: [{ location: "Remote - US" }],
    jobUrl: `https://jobs.ashbyhq.com/${ORG}/${POSTING_ID}`,
    descriptionPlain: "Build the thing.",
    publishedAt: "2026-07-01T12:00:00.000Z",
    compensation: { compensationTierSummary: "$180K - $220K" },
    ...overrides,
  };
}

/** Stubs global fetch with a JSON board response. */
function mockBoard(jobs: unknown[], init: { status?: number } = {}) {
  const status = init.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ jobs }),
    })
  );
}

describe("scrapeJobPosting (Ashby)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a posting to the normalized shape", async () => {
    mockBoard([ashbyJob()]);

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.source).toBe("ashby");
    expect(result.jobPosting).toEqual({
      title: "Senior Backend Engineer",
      companyName: "Acme Corp",
      location: ["New York, NY", "Remote - US"],
      salary: "$180K - $220K",
      description: "Build the thing.",
      jobUrl: `https://jobs.ashbyhq.com/${ORG}/${POSTING_ID}`,
      postedDate: "2026-07-01T12:00:00.000Z",
    });
  });

  it("calls the org's board API with compensation included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jobs: [ashbyJob()] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobPosting(POSTING_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.ashbyhq.com/posting-api/job-board/${ORG}?includeCompensation=true`,
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  it("tolerates a trailing /application segment and query params", async () => {
    mockBoard([ashbyJob()]);

    const result = await scrapeJobPosting(
      `${POSTING_URL}/application?utm_source=linkedin`
    );

    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
  });

  it("falls back to null salary/description when absent", async () => {
    mockBoard([
      ashbyJob({ compensation: undefined, descriptionPlain: "  " }),
    ]);

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.salary).toBeNull();
    expect(result.jobPosting.description).toBeNull();
  });

  it("throws NOT_FOUND when the posting id isn't on the board", async () => {
    mockBoard([ashbyJob({ id: "99999999-0000-0000-0000-000000000000" })]);

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when the board itself 404s", async () => {
    mockBoard([], { status: 404 });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toBeInstanceOf(
      ScrapeError
    );
    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws UPSTREAM_ERROR when the fetch rejects (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects a non-posting Ashby URL (board listing, no posting id)", async () => {
    await expect(
      scrapeJobPosting(`https://jobs.ashbyhq.com/${ORG}`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("rejects a URL from an unsupported host", async () => {
    await expect(
      scrapeJobPosting("https://jobs.lever.co/acme/some-role")
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("rejects a non-http(s) or malformed URL", async () => {
    await expect(
      scrapeJobPosting("javascript:alert(1)")
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(scrapeJobPosting("not a url")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });
});
