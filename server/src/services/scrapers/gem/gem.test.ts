import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeJobPosting, ScrapeError } from "..";

const BOARD = "acme-corp";
const POSTING_ID = "am9icG9zdDpN6-87TjRV1EFRX86qqvez";
const POSTING_URL = `https://jobs.gem.com/${BOARD}/${POSTING_ID}`;

function gemPosting(overrides: Record<string, unknown> = {}) {
  return {
    title: "Senior Backend Engineer",
    descriptionHtml: "<p>Build the thing.</p><p>Tom &amp; Jerry.</p>",
    extId: POSTING_ID,
    firstPublishedTsSec: 1_700_000_000,
    locations: [
      { name: "New York, NY", city: "New York", isoCountry: "USA" },
      { name: "Remote - US", isRemote: true },
    ],
    job: {
      teamDisplayName: "ACME Corporation",
      locations: [{ name: "All company locations" }],
    },
    jobPostSectionHtml: {
      introHtml: "<div>About ACME</div>",
      outroHtml: "<div>Equal opportunity employer.</div>",
    },
    compensationHtml: "<div>$180,000 - $220,000 USD</div>",
    ...overrides,
  };
}

function mockGraphql(
  posting: unknown = gemPosting(),
  init: { status?: number; errors?: unknown[] } = {}
) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      data: { oatsExternalJobPosting: posting },
      ...(init.errors ? { errors: init.errors } : {}),
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("scrapeJobPosting (Gem)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a posting to the normalized shape", async () => {
    mockGraphql();

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.source).toBe("gem");
    expect(result.jobPosting).toEqual({
      title: "Senior Backend Engineer",
      companyName: "ACME Corporation",
      location: ["New York, NY", "Remote - US"],
      salary: "$180,000 - $220,000 USD",
      description:
        "About ACME\n\nBuild the thing.\nTom & Jerry.\n\nEqual opportunity employer.",
      jobUrl: POSTING_URL,
      postedDate: "2023-11-14T22:13:20.000Z",
    });
  });

  it("posts the board and external id as GraphQL variables", async () => {
    const fetchMock = mockGraphql();

    await scrapeJobPosting(POSTING_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://jobs.gem.com/api/public/graphql",
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
      })
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      operationName: "ExternalJobPosting",
      variables: { boardId: BOARD, extId: POSTING_ID },
    });
  });

  it("accepts imported numeric ids and a trailing application route", async () => {
    mockGraphql(gemPosting({ extId: "8102068002" }));

    const result = await scrapeJobPosting(
      `https://jobs.gem.com/${BOARD}/8102068002/application?source=linkedin`
    );

    expect(result.jobPosting.jobUrl).toBe(
      `https://jobs.gem.com/${BOARD}/8102068002`
    );
  });

  it("falls back to the board slug and job locations", async () => {
    mockGraphql(
      gemPosting({
        locations: [],
        job: {
          teamDisplayName: " ",
          locations: [
            { city: "London", isoCountry: "GBR" },
            { isRemote: true },
            { isRemote: true },
          ],
        },
      })
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.companyName).toBe("Acme Corp");
    expect(result.jobPosting.location).toEqual(["London, GBR", "Remote"]);
  });

  it("returns null for absent optional text and an invalid date", async () => {
    mockGraphql(
      gemPosting({
        descriptionHtml: null,
        compensationHtml: " ",
        firstPublishedTsSec: "not-a-date",
        jobPostSectionHtml: null,
      })
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.description).toBeNull();
    expect(result.jobPosting.salary).toBeNull();
    expect(result.jobPosting.postedDate).toBeNull();
  });

  it("throws NOT_FOUND when Gem returns a null posting", async () => {
    mockGraphql(null);

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws UPSTREAM_ERROR for a GraphQL error", async () => {
    mockGraphql(null, { errors: [{ message: "failed" }] });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws NOT_FOUND when the endpoint 404s", async () => {
    mockGraphql(null, { status: 404 });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toBeInstanceOf(
      ScrapeError
    );
    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws UPSTREAM_ERROR when the fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws UPSTREAM_ERROR when the JSON response cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json");
        },
      })
    );

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("rejects a Gem board listing with no posting id", async () => {
    await expect(
      scrapeJobPosting(`https://jobs.gem.com/${BOARD}`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });

  it("rejects unexpected path segments and unsafe posting ids", async () => {
    await expect(
      scrapeJobPosting(`${POSTING_URL}/something-else`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
    await expect(
      scrapeJobPosting(`https://jobs.gem.com/${BOARD}/bad%20id`)
    ).rejects.toMatchObject({ code: "UNSUPPORTED_URL" });
  });
});
