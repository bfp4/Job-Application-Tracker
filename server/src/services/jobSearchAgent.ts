import { generateWithWebSearch } from "../lib/anthropic";
import { prisma } from "../lib/prisma";
import type { ResumeProfile } from "../types/resume";
import type { JobSearchResult, JobSearchResultItem } from "../types/jobSearchResult";

const JOB_SEARCH_RESULT_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      description: "Real, currently-open job postings found via web search/fetch that genuinely fit the candidate's resume.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          companyName: { type: "string" },
          location: { type: ["string", "null"] },
          jobUrl: {
            type: "string",
            description: "Direct URL to the job posting or application page — must be a URL actually returned by web search/fetch, never fabricated.",
          },
          description: {
            type: "string",
            description: "2-4 sentence summary of the role drawn from the posting.",
          },
          postedDate: {
            type: ["string", "null"],
            description: "ISO 8601 date if the posting states one, otherwise null.",
          },
          matchScore: {
            type: "integer",
            description: "0-100 rating of how well this posting matches the candidate's resume.",
          },
          matchReasons: {
            type: "array",
            description: "2-4 short bullet reasons this posting was scored the way it was, referencing specific resume skills/experience.",
            items: { type: "string" },
          },
        },
        required: [
          "title",
          "companyName",
          "location",
          "jobUrl",
          "description",
          "postedDate",
          "matchScore",
          "matchReasons",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["jobs"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a job-search agent with web search and web fetch access. You'll be given a candidate's full resume profile. Find real, currently-open job postings that genuinely fit — by running an adaptive search → observe → decide loop, not a fixed script.

Before you make any tool calls, write 1-3 sentences stating your plan: which roles/seniority phrasings you'll start with and what kind of sources you expect to check. Then begin searching.

How to search:
- Search per target role SEPARATELY — never combine multiple job titles into one query.
- Vary seniority phrasing across searches, since real postings don't use one consistent term: try variations like "New Grad", "Junior", "Associate", "Engineer I", "Entry Level" (pick the ones appropriate to the candidate's actual level — don't apply new-grad phrasing to a senior candidate).
- Do broad discovery searches first, watching for high-value sources: ATS job boards (Greenhouse, Lever, Ashby, Workable) and curated aggregators/trackers for the candidate's field and career stage.
- When you find a promising ATS board or aggregator, use web_fetch on it directly — search snippets are truncated and low-signal; fetching gets you the real, current list of openings.
- Don't lock into your initial query list. Adapt based on what you find: follow a good aggregator when you spot one, drop a phrasing that yields nothing, try a new angle.
- Expect this to take real effort: plan on 10-15+ tool calls (searches and fetches combined) before you're done. Don't stop after 2-3 searches.

Before including a posting:
- Check its tech stack and seniority level against the candidate's actual skills and experience in the resume profile. Discard postings that don't genuinely fit — don't include loosely-related roles just to pad the list.
- Only include postings you actually found via search/fetch — never fabricate a URL, company, or listing.
- Favor postings that appear to be currently open / posted within roughly the last 30 days; skip anything that looks stale or closed.
- Prefer direct application links (the ATS page itself) over aggregator/search-result pages when you can find the direct link.
- Never include a URL listed under "Already-known postings" in the user message — those were already found in a previous run.
- Deduplicate identical listings within your own results.

Score each match honestly and explain why in matchReasons. Return every real, currently-open, genuinely-fitting posting you find — this could be anywhere from 1 to 15+ depending on what turns up. A smaller set of accurate, well-matched postings is far better than padding the list.

Your final message must be valid JSON matching the required schema and nothing else.`;

function buildPrompt(profile: ResumeProfile, excludeUrls: string[]): string {
  const excludeSection =
    excludeUrls.length > 0
      ? `\n\nAlready-known postings (do not re-include these URLs):\n${excludeUrls.join("\n")}`
      : "";
  return `Candidate resume profile:\n\n${JSON.stringify(profile, null, 2)}${excludeSection}`;
}

/**
 * Returns the jobUrls already stored, so the agent doesn't waste search
 * budget re-discovering (or re-including) postings it already found.
 */
async function getKnownJobUrls(limit = 300): Promise<string[]> {
  const postings = await prisma.jobPosting.findMany({
    select: { jobUrl: true },
    orderBy: { fetchedAt: "desc" },
    take: limit,
  });
  return postings.map((p) => p.jobUrl);
}

/**
 * Runs the merged strategy+search agent: a single adaptive loop that plans,
 * searches, fetches promising sources, and judges fit — all in one call.
 */
export async function findMatchingJobs(
  profile: ResumeProfile,
  excludeUrls: string[]
): Promise<{ jobs: JobSearchResultItem[]; plan: string | null; trace: unknown[] }> {
  const { result, plan, trace } = await generateWithWebSearch<JobSearchResult>({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(profile, excludeUrls),
    schema: JOB_SEARCH_RESULT_SCHEMA,
    maxTokens: 16000,
    maxSearches: 15,
    maxFetches: 10,
  });

  return { jobs: result.jobs, plan, trace };
}

/**
 * Runs the job-search agent for a user's latest resume, persists results as
 * Company/JobPosting rows (upserted on the unique jobUrl), and logs the run
 * (plan + tool-call trace) for debugging — since this is a non-deterministic
 * loop, the trace is what explains a given run, not the prompt text alone.
 */
export async function runJobSearch(userId: string): Promise<{
  resultCount: number;
  jobPostingIds: string[];
  plan: string | null;
}> {
  const baseResume = await prisma.baseResume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (!baseResume) {
    throw new Error("Upload a resume before running a job search.");
  }

  const excludeUrls = await getKnownJobUrls();
  const { jobs, plan, trace } = await findMatchingJobs(
    baseResume.parsed as unknown as ResumeProfile,
    excludeUrls
  );

  const jobPostingIds: string[] = [];

  for (const job of jobs) {
    const company = await prisma.company.upsert({
      where: { name: job.companyName },
      update: {},
      create: { name: job.companyName },
    });

    const posting = await prisma.jobPosting.upsert({
      where: { jobUrl: job.jobUrl },
      update: {
        title: job.title,
        location: job.location,
        description: job.description,
        matchScore: job.matchScore,
        matchReasons: job.matchReasons,
        postedDate: job.postedDate ? new Date(job.postedDate) : null,
        companyId: company.id,
      },
      create: {
        title: job.title,
        location: job.location,
        jobUrl: job.jobUrl,
        description: job.description,
        matchScore: job.matchScore,
        matchReasons: job.matchReasons,
        postedDate: job.postedDate ? new Date(job.postedDate) : null,
        companyId: company.id,
      },
    });

    jobPostingIds.push(posting.id);
  }

  await prisma.searchRun.create({
    data: {
      userId,
      baseResumeId: baseResume.id,
      resultCount: jobs.length,
      plan,
      trace: trace as object[],
    },
  });

  return { resultCount: jobs.length, jobPostingIds, plan };
}
