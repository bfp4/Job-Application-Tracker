import { generateJson } from "../lib/anthropic";
import type { NormalizedJob } from "../jobSources/types";
import type { ResumeStructure, ResumeExperience } from "../types/resume";

/**
 * A job enriched with an AI-generated fit assessment for a specific candidate.
 *
 * `fitScore`/`fitReason` are null when ranking could not be produced (Claude
 * failed or returned malformed JSON); callers should fall back to showing the
 * jobs in their original order.
 */
export interface RankedJob extends NormalizedJob {
  /** 0-100 fit score, or null when ranking was unavailable. */
  fitScore: number | null;
  /** One-sentence (max 15 words) explanation, or null when unavailable. */
  fitReason: string | null;
}

/** Truncated job shape sent to Claude to keep token usage low. */
interface JobForPrompt {
  id: string;
  title: string;
  companyName: string;
  description: string;
}

/** Per-job score returned by Claude. */
interface ScoreItem {
  id: string;
  fitScore: number;
  fitReason: string;
}

const MAX_DESCRIPTION_WORDS = 150;

/**
 * Truncates text to its first {@link MAX_DESCRIPTION_WORDS} words, collapsing
 * runs of whitespace so the model isn't billed for layout noise.
 */
function truncateDescription(description: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_DESCRIPTION_WORDS) return words.join(" ");
  return words.slice(0, MAX_DESCRIPTION_WORDS).join(" ");
}

/**
 * Parses a resume date string into a year/month pair. Handles the common
 * formats the parser emits ("2021-03", "March 2021", "Mar 2021", "2021").
 * Returns null when the value can't be interpreted.
 */
function parseYearMonth(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // ISO-ish: 2021-03 or 2021/03 or 2021-03-15
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }

  // Month name + year: "March 2021", "Mar 2021"
  const named = trimmed.match(/([A-Za-z]+)\.?\s+(\d{4})/);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    const year = Number(named[2]);
    if (month) return { year, month };
  }

  // Bare year: "2021"
  const bare = trimmed.match(/^(\d{4})$/);
  if (bare) return { year: Number(bare[1]), month: 1 };

  // Fallback to Date parsing for anything else.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
  }

  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Whole months between two year/month points (inclusive of the start month). */
function monthsBetween(
  start: { year: number; month: number },
  end: { year: number; month: number }
): number {
  const diff = (end.year - start.year) * 12 + (end.month - start.month);
  return diff > 0 ? diff : 0;
}

/**
 * Sums tenure across all experience entries and converts to years (1 decimal).
 * Open-ended ("present") roles count up to the current month.
 */
function calculateYearsOfExperience(experience: ResumeExperience[]): number {
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth() + 1 };

  let totalMonths = 0;
  for (const entry of experience) {
    const start = parseYearMonth(entry.startDate);
    if (!start) continue;
    const end = parseYearMonth(entry.endDate) ?? today;
    totalMonths += monthsBetween(start, end);
  }

  return Math.round((totalMonths / 12) * 10) / 10;
}

/** Flattens every skill category into a single comma-separated list. */
function collectSkills(skills: ResumeStructure["skills"]): string {
  return [
    ...skills.languages,
    ...skills.frontend,
    ...skills.backend,
    ...skills.databases,
    ...skills.tools,
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

/** Picks the most recent experience entry by start date (resume order first). */
function mostRecentRole(
  experience: ResumeExperience[]
): { title: string; company: string } | null {
  if (experience.length === 0) return null;

  let best = experience[0];
  let bestStart = parseYearMonth(best.startDate);
  for (const entry of experience.slice(1)) {
    const start = parseYearMonth(entry.startDate);
    if (!start) continue;
    if (
      !bestStart ||
      start.year > bestStart.year ||
      (start.year === bestStart.year && start.month > bestStart.month)
    ) {
      best = entry;
      bestStart = start;
    }
  }

  return { title: best.title, company: best.company };
}

function buildPrompt(
  jobs: JobForPrompt[],
  profile: {
    yearsOfExperience: number;
    skills: string;
    mostRecentTitle: string;
    mostRecentCompany: string;
  }
): string {
  return `You are a job fit scorer. Given a candidate's profile and a list of job postings, score each job for fit.

Candidate profile:
- Years of experience: ${profile.yearsOfExperience}
- Skills: ${profile.skills} (comma-separated list from all skill categories)
- Most recent role: ${profile.mostRecentTitle} at ${profile.mostRecentCompany}

Scoring rules:
- Score 0-100 based on how well the job matches the candidate's actual skills and experience level
- Penalize heavily (-30 points) if the job requires significantly more years of experience than the candidate has
- Penalize heavily (-30 points) if the job requires a primary technology the candidate has no experience with (e.g. Angular when candidate only knows React)
- Reward (+20 points) if the job's required skills closely match the candidate's top skills
- Reward (+10 points) if the seniority level matches the candidate's years of experience
- Be strict — a score above 70 should mean a genuinely strong match

Jobs to score (JSON array):
${JSON.stringify(jobs)}
Each job has: id, title, companyName, description (truncated to 150 words)

Return a JSON array where each item has:
{
  id: string,        // same id as the input job
  fitScore: number,  // 0-100
  fitReason: string  // one sentence max 15 words explaining the score
}

Return ONLY valid JSON — no explanation, no markdown backticks.`;
}

function isScoreArray(value: unknown): value is ScoreItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ScoreItem).id === "string" &&
        typeof (item as ScoreItem).fitScore === "number" &&
        typeof (item as ScoreItem).fitReason === "string"
    )
  );
}

/** Wraps each job with null scores, preserving the original order. */
function unranked(jobs: NormalizedJob[]): RankedJob[] {
  return jobs.map((job) => ({ ...job, fitScore: null, fitReason: null }));
}

/**
 * Scores each job against the candidate's resume with a single batched Claude
 * call and returns the jobs sorted by fit (highest first).
 *
 * The job descriptions are truncated to the first 150 words here (not by the
 * caller) before the prompt is built. If Claude fails or returns malformed
 * JSON, the original jobs are returned in their original order with null
 * scores.
 */
export async function rankJobsForUser(
  jobs: NormalizedJob[],
  resumeContent: ResumeStructure
): Promise<RankedJob[]> {
  if (jobs.length === 0) return [];

  const yearsOfExperience = calculateYearsOfExperience(resumeContent.experience);
  const skills = collectSkills(resumeContent.skills);
  const recent = mostRecentRole(resumeContent.experience);

  const jobsForPrompt: JobForPrompt[] = jobs.map((job) => ({
    id: job.externalId,
    title: job.title,
    companyName: job.companyName,
    description: truncateDescription(job.description),
  }));

  try {
    const scores = await generateJson<ScoreItem[]>({
      prompt: buildPrompt(jobsForPrompt, {
        yearsOfExperience,
        skills,
        mostRecentTitle: recent?.title ?? "Unknown",
        mostRecentCompany: recent?.company ?? "Unknown",
      }),
      maxTokens: 1000,
      validate: isScoreArray,
    });

    const scoreById = new Map(scores.map((s) => [s.id, s]));

    const ranked: RankedJob[] = jobs.map((job) => {
      const match = scoreById.get(job.externalId);
      return {
        ...job,
        fitScore: match ? match.fitScore : null,
        fitReason: match ? match.fitReason : null,
      };
    });

    ranked.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
    return ranked;
  } catch (err) {
    console.error("Smart Rank scoring failed:", err);
    return unranked(jobs);
  }
}
