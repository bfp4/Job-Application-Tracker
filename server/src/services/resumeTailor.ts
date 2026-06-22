import { generateJson } from "../lib/anthropic";
import { isResumeStructure } from "./resumeParser";
import type { ResumeStructure } from "../types/resume";

/**
 * Claude's tailoring response: the rewritten resume plus a one-sentence summary
 * of what changed (stored as TailoredResume.aiNotes).
 */
export interface TailoredResumeResult {
  resume: ResumeStructure;
  changes: string;
}

interface TailorResponse {
  resume: ResumeStructure;
  changes: string;
}

function isTailorResponse(value: unknown): value is TailorResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { resume?: unknown; changes?: unknown };
  return isResumeStructure(v.resume) && typeof v.changes === "string";
}

function buildPrompt(baseResume: ResumeStructure, jobDescription: string): string {
  const baseResumeJSON = JSON.stringify(baseResume, null, 2);

  return `You are an expert resume writer following Harvard Career Services guidelines. Given a candidate's base resume and a job description, rewrite the resume to better match the role.

CONTENT RULES (non-negotiable):
1. NEVER invent experience, skills, or achievements the candidate does not already have
2. Reorder and reword existing bullets to emphasize the most relevant experience
3. Adjust skills to highlight tools mentioned in the job description that the candidate already knows
4. Use keywords and terminology from the job description where they accurately reflect what the candidate did
5. NEVER remove skills from the skills section that exist in the base resume. You may reorder skills within a category to prioritize relevance, and you may add skills from the job description that the candidate already listed elsewhere in their resume — but never delete existing skills entries.

LANGUAGE RULES (follow strictly):
- Start every bullet with a strong action verb (e.g. Built, Engineered, Led, Designed, Developed, Implemented, Optimized, Launched)
- Be specific rather than general — include concrete details and numbers where they already exist in the base resume
- Be concise — each bullet should be a tight phrase, not a full sentence
- Never use personal pronouns (no 'I', 'my', 'we')
- Never use passive voice ('was responsible for', 'helped with', 'assisted in')
- Never use flowery or impressive-sounding filler language ('leveraged synergies', 'utilized best practices', 'drove impactful results')
- Quantify achievements wherever the base resume already has numbers — do not invent numbers
- Keep bullets under 120 characters — cut ruthlessly, every word must earn its place

STRUCTURE RULES:
- Keep the same sections as the base resume — do not add or remove sections
- Within each section, keep entries in reverse chronological order (most recent first)
- Do not add a summary section unless one already exists in the base resume

Return a JSON object with two fields:
1. 'resume': the full tailored ResumeStructure JSON (same shape as input)
2. 'changes': a single sentence (max 20 words) summarizing what was changed and why, e.g. 'Emphasized backend and API experience to match the role's focus on distributed systems.'

Return ONLY valid JSON — no explanation, no markdown backticks.

Base resume (JSON):
${baseResumeJSON}

Job description:
${jobDescription}`;
}

/**
 * Tailors a base resume to a specific job description using Claude. Retries once
 * on malformed output (handled inside generateJson).
 */
export async function tailorResume(
  baseResume: ResumeStructure,
  jobDescription: string
): Promise<TailoredResumeResult> {
  const response = await generateJson<TailorResponse>({
    prompt: buildPrompt(baseResume, jobDescription),
    maxTokens: 8192,
    validate: isTailorResponse,
  });

  return { resume: response.resume, changes: response.changes };
}
