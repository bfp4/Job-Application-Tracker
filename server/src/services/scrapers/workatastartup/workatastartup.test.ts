import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeJobPosting, ScrapeError } from "..";

const JOB_ID = "104197";
const POSTING_URL = `https://www.workatastartup.com/jobs/${JOB_ID}`;

function waasJob(overrides: Record<string, unknown> = {}) {
  return {
    id: Number(JOB_ID),
    title: "Founding Engineer",
    salaryRange: "$150K - $250K",
    equityRange: null,
    location: "San Francisco, CA, US",
    jobType: "Full-time",
    minExperience: "1+ years",
    skills: ["TypeScript", "PostgreSQL"],
    // Work at a Startup returns real (unescaped) HTML inside the JSON.
    descriptionHtml: "<h1>About Sira</h1>\n<p>Build the thing.</p>",
    interviewProcessHtml: "<ol><li>Intro call.</li><li>Take-home.</li></ol>",
    ...overrides,
  };
}

function waasCompany(overrides: Record<string, unknown> = {}) {
  return { name: "Sira", slug: "sira", batch: "S25", ...overrides };
}

function waasPage(overrides: Record<string, unknown> = {}) {
  return {
    component: "jobs/public/pages/JobDetailPage",
    props: { job: waasJob(), company: waasCompany() },
    url: `/jobs/${JOB_ID}`,
    version: "ce5de37d26c24729ae2cd0c459885adb2f5acdb4",
    ...overrides,
  };
}

/** Escapes a value into an HTML attribute the way the Rails view does. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Renders the Inertia shell the way the posting page serves it. */
function waasHtml(page: unknown): string {
  return [
    "<!DOCTYPE html><html><head><title>Founding Engineer at Sira</title></head>",
    `<body><div data-page="${escapeAttribute(JSON.stringify(page))}"></div>`,
    "</body></html>",
  ].join("");
}

/** Stubs global fetch with an HTML document response. */
function mockPage(html: string, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("scrapeJobPosting (Work at a Startup)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a posting to the normalized shape", async () => {
    mockPage(waasHtml(waasPage()));

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.source).toBe("workatastartup");
    expect(result.jobPosting).toEqual({
      title: "Founding Engineer",
      companyName: "Sira",
      location: ["San Francisco, CA, US"],
      salary: "$150K - $250K",
      description:
        "About Sira\n\nBuild the thing.\n\n" +
        "Skills: TypeScript, PostgreSQL\n\n" +
        "Interview process\nIntro call.\nTake-home.",
      jobUrl: POSTING_URL,
      // The page carries no publication date.
      postedDate: null,
    });
  });

  it("requests the posting with an HTML Accept header", async () => {
    // The site answers 406 to fetch's default wildcard Accept.
    const fetchMock = mockPage(waasHtml(waasPage()));

    await scrapeJobPosting(POSTING_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      POSTING_URL,
      expect.objectContaining({
        headers: { accept: "text/html,application/xhtml+xml" },
      })
    );
  });

  it.each([
    ["a no-www host", `https://workatastartup.com/jobs/${JOB_ID}`],
    ["a trailing slash", `${POSTING_URL}/`],
    ["tracking params", `${POSTING_URL}?utm_source=linkedin`],
  ])("normalizes %s onto the canonical posting URL", async (_label, url) => {
    const fetchMock = mockPage(waasHtml(waasPage()));

    const result = await scrapeJobPosting(url);

    expect(fetchMock).toHaveBeenCalledWith(POSTING_URL, expect.anything());
    expect(result.jobPosting.jobUrl).toBe(POSTING_URL);
  });

  it("splits the slash-joined location list, keeping commas inside an entry", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: {
            job: waasJob({ location: "TX, US / Remote (TX, US)" }),
            company: waasCompany(),
          },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.location).toEqual(["TX, US", "Remote (TX, US)"]);
  });

  it("returns an empty location list when the posting has none", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: { job: waasJob({ location: null }), company: waasCompany() },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.location).toEqual([]);
  });

  it.each([
    ["pay and equity", "$150K - $250K", "0.10% - 1.00%", "$150K - $250K + 0.10% - 1.00% equity"],
    ["pay only", "$150K - $250K", null, "$150K - $250K"],
    ["equity only", null, "0.50% - 2.00%", "0.50% - 2.00% equity"],
    ["neither", null, null, null],
  ])(
    "formats compensation given %s",
    async (_label, salaryRange, equityRange, expected) => {
      mockPage(
        waasHtml(
          waasPage({
            props: {
              job: waasJob({ salaryRange, equityRange }),
              company: waasCompany(),
            },
          })
        )
      );

      const result = await scrapeJobPosting(POSTING_URL);

      expect(result.jobPosting.salary).toBe(expected);
    }
  );

  it("omits the skills and interview sections when the posting has neither", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: {
            job: waasJob({ skills: [], interviewProcessHtml: undefined }),
            company: waasCompany(),
          },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.description).toBe("About Sira\n\nBuild the thing.");
  });

  it("returns a null description when the posting carries no text at all", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: {
            job: waasJob({
              descriptionHtml: "   ",
              skills: undefined,
              interviewProcessHtml: undefined,
            }),
            company: waasCompany(),
          },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.description).toBeNull();
  });

  // The page object is escaped once into the attribute, so an entity the
  // description itself contains is double-escaped on the wire and must survive
  // exactly one round of decoding.
  it("decodes the page attribute exactly once", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: {
            job: waasJob({
              title: 'Engineer, "Growth" & Retention',
              descriptionHtml: "<p>Tom &amp; Jerry — 5 &lt; 6.</p>",
              skills: [],
              interviewProcessHtml: undefined,
            }),
            company: waasCompany(),
          },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.title).toBe('Engineer, "Growth" & Retention');
    expect(result.jobPosting.description).toBe("Tom & Jerry — 5 < 6.");
  });

  it("falls back to the company slug when no display name is given", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: {
            job: waasJob(),
            company: waasCompany({ name: undefined, slug: "legion-health" }),
          },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.companyName).toBe("Legion Health");
  });

  it("falls back to a placeholder title when the posting has none", async () => {
    mockPage(
      waasHtml(
        waasPage({
          props: { job: waasJob({ title: "  " }), company: waasCompany() },
        })
      )
    );

    const result = await scrapeJobPosting(POSTING_URL);

    expect(result.jobPosting.title).toBe("Untitled role");
  });

  it("throws NOT_FOUND when the posting 404s", async () => {
    mockPage("<html><title>Y Combinator | File Not Found</title></html>", {
      status: 404,
    });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toBeInstanceOf(
      ScrapeError
    );
    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // A company page and the logged-out landing page are both served as 200s
  // with a page object, so the component name is what rules them out.
  it("throws NOT_FOUND when the page isn't a job detail page", async () => {
    mockPage(
      waasHtml({
        component: "jobs/public/pages/CompanyPage",
        props: { company: waasCompany() },
      })
    );

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when the page object carries no job", async () => {
    mockPage(waasHtml(waasPage({ props: { company: waasCompany() } })));

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws UPSTREAM_ERROR when the document has no page object", async () => {
    mockPage("<html><body><div id=\"app\"></div></body></html>");

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws UPSTREAM_ERROR when the page object isn't valid JSON", async () => {
    mockPage(`<div data-page="${escapeAttribute("{not json")}"></div>`);

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws UPSTREAM_ERROR when the fetch rejects (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("throws UPSTREAM_ERROR on a 500", async () => {
    mockPage("<html></html>", { status: 500 });

    await expect(scrapeJobPosting(POSTING_URL)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it.each([
    ["a company page", "https://www.workatastartup.com/companies/sira"],
    ["the job search", "https://www.workatastartup.com/jobs"],
    ["a non-numeric id", "https://www.workatastartup.com/jobs/founding-engineer"],
    ["a sub-page of a posting", `${POSTING_URL}/apply`],
    ["the home page", "https://www.workatastartup.com/"],
  ])("rejects %s without making a request", async (_label, url) => {
    const fetchMock = mockPage(waasHtml(waasPage()));

    await expect(scrapeJobPosting(url)).rejects.toMatchObject({
      code: "UNSUPPORTED_URL",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
