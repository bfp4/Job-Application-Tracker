import { generateJson } from "../lib/anthropic";
import type { ResumeStructure } from "../types/resume";
import { isResumeKeywords, type ResumeKeywords } from "../types/keywords";

const KEYWORDS_MAX_TOKENS = 500;

function buildPrompt(resumeJSON: string): string {
  return `You are a job search optimization expert. Analyze this candidate's resume and extract keywords to improve their job search results.

Extract the following:

1. technologies: All specific technical skills, languages, frameworks, tools, and platforms the candidate has real hands-on experience with. Include only things explicitly mentioned in their experience, projects, or skills sections — do not infer or add technologies they haven't used.
   Examples: React, TypeScript, Node.js, PostgreSQL, AWS Lambda, Firebase

2. roles: 2-4 job role titles that best describe this candidate based on their actual experience. Be specific to their level and focus area.
   Examples: Frontend Developer, Fullstack Engineer, ML Engineer, Backend Developer

3. domains: 2-4 broad technical domains this candidate works in, inferred from their overall experience pattern.
   Examples: Web Development, Machine Learning, Data Engineering, Mobile Development, Cloud Infrastructure

4. searchTerms: 3-6 ready-to-use job search query strings that would find the most relevant roles for this candidate. Each should be 2-5 words. Order from most specific to most general. These will be typed directly into a job search box, so make them natural and effective.
   Examples: 'React TypeScript Fullstack', 'Frontend React Node.js', 'Fullstack Engineer JavaScript'

Rules:
- Only include technologies the candidate actually has — never suggest ones they don't have
- searchTerms should reflect the candidate's actual skill set, not aspirational skills
- Keep each array concise — quality over quantity
- For a React/Node fullstack dev, do NOT include Angular, Vue, Django etc.

Resume (JSON):
${resumeJSON}

Return ONLY a valid JSON object matching this exact shape:
{
  'technologies': string[],
  'roles': string[],
  'domains': string[],
  'searchTerms': string[]
}
No explanation, no markdown backticks.`;
}

/**
 * Extracts structured search keywords from a parsed resume using Claude.
 *
 * Designed to be called fire-and-forget after a resume upload: it never throws.
 * On any failure (Claude error, malformed JSON) it logs and returns null so the
 * caller can skip persisting keywords without affecting the upload.
 */
export async function extractKeywordsFromResume(
  resume: ResumeStructure
): Promise<ResumeKeywords | null> {
  try {
    const keywords = await generateJson<ResumeKeywords>({
      prompt: buildPrompt(JSON.stringify(resume)),
      maxTokens: KEYWORDS_MAX_TOKENS,
      validate: isResumeKeywords,
    });
    return keywords;
  } catch (err) {
    console.error("Resume keyword extraction failed:", err);
    return null;
  }
}
