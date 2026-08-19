import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeJobPosting, ScrapeError } from "..";

const ACCOUNT = "acme-corp";
const SHORTCODE = "D029850682";
const POSTING_URL = `https://apply.workable.com/${ACCOUNT}/j/${SHORTCODE}/`;
const API_BASE = `https://apply.workable.com/api/v1/accounts/${ACCOUNT}`;
const JOB_API = `${API_BASE}/jobs/${SHORTCODE}`;

function workableJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 5860580,
    shortcode: SHORTCODE,
    title: "Senior Backend Engineer",
    remote: false,
    workplace: "on_site",
    location: {
      country: "United States",
      countryCode: "US",
      city: "New York",
      region: "New York",
    },
    locations: [
      {
        country: "United States",
        countryCode: "US",
        city: "New York",
        region: "New York",
        hidden: false,
      },
    ],
    state: "published",
    published: "2026-06-03T00:00:00.000Z",
    // Workable returns real (unescaped) HTML, split across three blocks.
    description: "<p>Build the thing.</p>",
    requirements: "<p>Tom &amp; Jerry.</p>",
    benefits: "<p>Good ones.</p>",
    ...overrides,
  };
}

/**
 * Stubs global fetch, routing the two calls the scraper makes (the job, and the
 * account it reads the display name from) by URL.
 */
function mockWorkable(
  opts: {
    job?: unknown;
    jobStatus?: number;
    account?: unknown;
    accountStatus?: number;
  } = {}
) {
  const fetchMock = vi.fn(async (url: string) => {
    const isJob = url.includes("/jobs/");
    const status = isJob ? opts.jobStatus ?? 200 : opts.accountStatus ?? 200;
    const body = isJob
      ? opts.job ?? workableJob()
      : opts.account ?? { name: "ACME Corporation" };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("scrapeJobPosting (Workable)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a posting to the normalized shape", async () => {
    mockWorkable();

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.source).toBe("workable");
    expect(result.jobPosting).toEqual({
      title: "Senior Backend Engineer",
      companyName: "ACME Corporation",
      location: ["New York, New York, United States"],
      salary: null,
      description: "Build the thing.\n\nTom & Jerry.\n\nGood ones.",
      jobUrl: POSTING_URL,
      postedDate: "2026-06-03T00:00:00.000Z",
    });
  });

  it("calls the public job endpoint for the account and shortcode", async () => {
    const fetchMock = mockWorkable();

    await scrapeJobPosting(POSTING_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      JOB_API,
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
    expect(fetchMock).toHaveBeenCalledWith(API_BASE, expect.anything());
  });

  it("falls back to the derived slug when the account lookup fails", async () => {
    mockWorkable({ accountStatus: 500 });

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.companyName).toBe("Acme Corp");
  });

  it("still autofills when the account request rejects outright", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes("/jobs/")) throw new Error("boom");
      return { ok: true, status: 200, json: async () => workableJob() };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.companyName).toBe("Acme Corp");
    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
  });

  it("lists a remote role as Remote alongside its country", async () => {
    mockWorkable({
      job: workableJob({
        remote: true,
        workplace: "remote",
        locations: [
          { country: "United States", countryCode: "US", city: "", region: null },
        ],
      }),
    });

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.location).toEqual(["Remote", "United States"]);
  });

  it("skips locations the posting page hides", async () => {
    mockWorkable({
      job: workableJob({
        locations: [
          { country: "United States", city: "New York", region: "New York" },
          { country: "Canada", city: "Toronto", region: "Ontario", hidden: true },
        ],
      }),
    });

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.location).toEqual(["New York, New York, United States"]);
  });

  it("formats a published pay range", async () => {
    mockWorkable({
      job: workableJob({
        salary: {
          salary_from: 180000,
          salary_to: 220000,
          salary_currency: "USD",
        },
      }),
    });

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.salary).toBe("$180,000 - $220,000");
  });

  it("formats a single-bound non-USD pay figure", async () => {
    mockWorkable({
      job: workableJob({
        salary: { salary_to: 90000, salary_currency: "eur" },
      }),
    });

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.salary).toBe("$90,000 EUR");
  });

  it("falls back to null description when every block is empty", async () => {
    mockWorkable({
      job: workableJob({
        description: "   ",
        requirements: undefined,
        benefits: null,
      }),
    });

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.description).toBeNull();
  });

  it("supports the legacy per-account host", async () => {
    const fetchMock = mockWorkable();

    const result = await scrapeJobPosting(
      `https://${ACCOUNT}.workable.com/j/${SHORTCODE}`
    );

    expect(fetchMock).toHaveBeenCalledWith(JOB_API, expect.anything());
    // The canonical apply.workable.com URL replaces the legacy one.
    expect(result.jobPosting.jobUrl).toBe(POSTING_URL);
  });

  it("tolerates a trailing /apply segment and query params", async () => {
    const fetchMock = mockWorkable();

    const result = await scrapeJobPosting(
      `${POSTING_URL}apply/?utm_source=linkedin`
    );

    expect(fetchMock).toHaveBeenCalledWith(JOB_API, expect.anything());
    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
  });

  it("throws NOT_FOUND when the posting 404s", async () => {
    mockWorkable({ jobStatus: 404, job: {} });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toBeInstanceOf(
      ScrapeError
    );
    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws UPSTREAM_ERROR when the job fetch rejects (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws UPSTREAM_ERROR on a 500", async () => {
    mockWorkable({ jobStatus: 500, job: {} });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects a Workable board listing with no shortcode", async () => {
    await expect(
      scrapeJobPosting(`https://apply.workable.com/${ACCOUNT}/`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("rejects a shortcode that isn't one", async () => {
    await expect(
      scrapeJobPosting(`https://apply.workable.com/${ACCOUNT}/j/not-a-shortcode`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("doesn't claim the workable.com marketing site", async () => {
    await expect(
      scrapeJobPosting("https://www.workable.com/j/D029850682")
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });
});
