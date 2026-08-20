import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeJobPosting, ScrapeError } from "..";

const TENANT = "acmecorp";
const HOST = `${TENANT}.wd5.myworkdayjobs.com`;
const SITE = "AcmeExternalCareerSite";
const JOB_PATH = "US-NC-Durham/Senior-Backend-Engineer_JR2017578";
const POSTING_URL = `https://${HOST}/en-US/${SITE}/job/${JOB_PATH}`;
const CXS_URL = `https://${HOST}/wday/cxs/${TENANT}/${SITE}/job/${JOB_PATH}`;

function workdayJob(overrides: Record<string, unknown> = {}) {
  return {
    jobPostingInfo: {
      id: "3f8e2cb5bf0f10064a99686db1780000",
      title: "Senior Backend Engineer",
      // Workday returns real (unescaped) HTML.
      jobDescription: "<p>Build the thing.</p><p>Tom &amp; Jerry.</p>",
      location: "US, NC, Durham",
      additionalLocations: ["US, CA, Remote"],
      postedOn: "Posted Today",
      startDate: "2026-08-18",
      jobReqId: "JR2017578",
      externalUrl: `https://${HOST}/${SITE}/job/${JOB_PATH}`,
      ...overrides,
    },
  };
}

/** Stubs global fetch with a JSON job-detail response. */
function mockJob(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

describe("scrapeJobPosting (Workday)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a posting to the normalized shape", async () => {
    mockJob(workdayJob());

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.source).toBe("workday");
    expect(result.jobPosting).toEqual({
      title: "Senior Backend Engineer",
      companyName: "Acmecorp",
      location: ["US, NC, Durham", "US, CA, Remote"],
      // Workday's posting API exposes no pay range.
      salary: null,
      description: "Build the thing.\nTom & Jerry.",
      jobUrl: `https://${HOST}/${SITE}/job/${JOB_PATH}`,
      postedDate: "2026-08-18",
    });
  });

  it("calls the tenant's CXS endpoint on the same host", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => workdayJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobPosting(POSTING_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      CXS_URL,
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  it("supports a URL with no locale segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => workdayJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobPosting(`https://${HOST}/${SITE}/job/${JOB_PATH}`);

    expect(fetchMock).toHaveBeenCalledWith(CXS_URL, expect.anything());
  });

  it("rewrites the /details/ link form onto the CXS /job/ endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => workdayJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobPosting(
      `https://${HOST}/en-US/${SITE}/details/Senior-Backend-Engineer_JR2017578`
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `https://${HOST}/wday/cxs/${TENANT}/${SITE}/job/Senior-Backend-Engineer_JR2017578`,
      expect.anything()
    );
  });

  it("tolerates query params and a trailing slash", async () => {
    // The CXS endpoint 422s on a trailing slash, so it must not be forwarded.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => workdayJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobPosting(`${POSTING_URL}/?utm_source=linkedin`);

    expect(result.jobPosting.title).toBe("Senior Backend Engineer");
    expect(fetchMock).toHaveBeenCalledWith(CXS_URL, expect.anything());
  });

  it("keeps job-path segments percent-encoded as Workday wrote them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => workdayJob(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobPosting(
      `https://${HOST}/${SITE}/job/San-Jose/Staff-Engineer%2C-Platform_R1`
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `https://${HOST}/wday/cxs/${TENANT}/${SITE}/job/San-Jose/Staff-Engineer%2C-Platform_R1`,
      expect.anything()
    );
  });

  it("falls back to the pasted URL when externalUrl is absent", async () => {
    mockJob(workdayJob({ externalUrl: undefined }));

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.jobUrl).toBe(POSTING_URL);
  });

  it("falls back to null description and an empty location list", async () => {
    mockJob(
      workdayJob({
        jobDescription: "   ",
        location: undefined,
        additionalLocations: undefined,
      })
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.description).toBeNull();
    expect(result.jobPosting.location).toEqual([]);
  });

  it("dedupes a location repeated in additionalLocations", async () => {
    mockJob(
      workdayJob({ additionalLocations: ["US, NC, Durham", "US, CA, Remote"] })
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.location).toEqual([
      "US, NC, Durham",
      "US, CA, Remote",
    ]);
  });

  it("throws NOT_FOUND when the posting 404s", async () => {
    mockJob({ errorCode: "S21" }, { status: 404 });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toBeInstanceOf(
      ScrapeError
    );
    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND for the 422 Workday returns on an unknown tenant", async () => {
    mockJob({ errorCode: "HTTP_422" }, { status: 422 });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when the response carries no jobPostingInfo", async () => {
    mockJob({});

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

  it("throws UPSTREAM_ERROR on a 500", async () => {
    mockJob({}, { status: 500 });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects a Workday career-site listing with no job path", async () => {
    await expect(
      scrapeJobPosting(`https://${HOST}/en-US/${SITE}`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  // A career-site id can look exactly like a locale, and a locale-less URL has
  // the same segment count as a prefixed one — so these must be told apart by
  // where the `job` marker sits, not by length.
  it.each([
    ["a two-letter site id and no locale prefix", "hp"],
    ["a site id shaped like a locale with a suffix", "gm-careers"],
  ])("accepts a posting with %s", async (_label, site) => {
    mockJob(workdayJob());

    const result = await scrapeJobPosting(`https://${HOST}/${site}/job/${JOB_PATH}`);

    expect(result.source).toBe("workday");
    expect(global.fetch).toHaveBeenCalledWith(
      `https://${HOST}/wday/cxs/${TENANT}/${site}/job/${JOB_PATH}`,
      expect.anything()
    );
  });

  it("strips an uppercased locale prefix", async () => {
    mockJob(workdayJob());

    await scrapeJobPosting(`https://${HOST}/EN-US/${SITE}/job/${JOB_PATH}`);

    expect(global.fetch).toHaveBeenCalledWith(CXS_URL, expect.anything());
  });

  it("rejects a Workday URL whose path isn't a job or details link", async () => {
    await expect(
      scrapeJobPosting(`https://${HOST}/en-US/${SITE}/search/Engineer`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("doesn't claim a non-Workday host", async () => {
    await expect(
      scrapeJobPosting("https://careers.example.com/en-US/Site/job/X_JR1")
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });
});
