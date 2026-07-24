import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeJobPosting, ScrapeError } from "./index";

const BOARD = "acme-corp";
const JOB_ID = "4200042";
const POSTING_URL = `https://boards.greenhouse.io/${BOARD}/jobs/${JOB_ID}`;

function greenhouseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: Number(JOB_ID),
    title: "Senior Backend Engineer",
    // Greenhouse returns the description as HTML-escaped HTML.
    content:
      "&lt;p&gt;Build the thing.&lt;/p&gt;&lt;p&gt;Tom &amp;amp; Jerry.&lt;/p&gt;",
    absolute_url: `https://boards.greenhouse.io/${BOARD}/jobs/${JOB_ID}`,
    updated_at: "2026-07-01T12:00:00.000Z",
    location: { name: "New York, NY" },
    offices: [{ name: "Remote - US" }],
    pay_input_ranges: [
      { min_cents: 18000000, max_cents: 22000000, currency_type: "USD" },
    ],
    ...overrides,
  };
}

/** Stubs global fetch with a JSON job response. */
function mockJob(job: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => job,
    })
  );
}

describe("scrapeJobPosting (Greenhouse)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a posting to the normalized shape", async () => {
    mockJob(greenhouseJob());

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.source).toBe("greenhouse");
    expect(result.jobPosting).toEqual({
      title: "Senior Backend Engineer",
      companyName: "Acme Corp",
      location: ["New York, NY", "Remote - US"],
      salary: "$180,000 - $220,000",
      description: "Build the thing.\nTom & Jerry.",
      jobUrl: `https://boards.greenhouse.io/${BOARD}/jobs/${JOB_ID}`,
      postedDate: "2026-07-01T12:00:00.000Z",
    });
  });

  it("fetches the single-job API for the board and job id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => greenhouseJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobPosting(POSTING_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs/${JOB_ID}?pay_transparency=true`,
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  it("prefers the API's company_name over the derived slug", async () => {
    mockJob(greenhouseJob({ company_name: "ACME Corporation" }));

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.companyName).toBe("ACME Corporation");
  });

  it("supports the job-boards.greenhouse.io host", async () => {
    mockJob(greenhouseJob());

    const result = await scrapeJobPosting(
      `https://job-boards.greenhouse.io/${BOARD}/jobs/${JOB_ID}`
    );

    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
  });

  it("supports the /embed/job_app form", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => greenhouseJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobPosting(
      `https://boards.greenhouse.io/embed/job_app?token=${JOB_ID}&for=${BOARD}`
    );

    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs/${JOB_ID}?pay_transparency=true`,
      expect.anything()
    );
  });

  it("tolerates query params and a trailing slash", async () => {
    mockJob(greenhouseJob());

    const result = await scrapeJobPosting(
      `${POSTING_URL}/?utm_source=linkedin`
    );

    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
  });

  it("falls back to null salary/description when absent", async () => {
    mockJob(
      greenhouseJob({ pay_input_ranges: [], content: "   " })
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.salary).toBeNull();
    expect(result.jobPosting.description).toBeNull();
  });

  it("formats a non-USD single-bound range", async () => {
    mockJob(
      greenhouseJob({
        pay_input_ranges: [{ max_cents: 15000000, currency_type: "CAD" }],
      })
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.salary).toBe("$150,000 CAD");
  });

  it("throws NOT_FOUND when the job 404s", async () => {
    mockJob({}, { status: 404 });

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

  it("rejects a non-posting Greenhouse URL (board listing, no job id)", async () => {
    await expect(
      scrapeJobPosting(`https://boards.greenhouse.io/${BOARD}`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("rejects a Greenhouse URL with a non-numeric job id", async () => {
    await expect(
      scrapeJobPosting(`https://boards.greenhouse.io/${BOARD}/jobs/not-a-number`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });
});
