import { createHash } from "crypto";
import { generateStructured } from "../lib/anthropic";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  truncate,
  type PostingWithCompany,
} from "../lib/prompt";

/**
 * Structured tips the agent produces for one (resume, job posting) pair.
 * KEEP IN SYNC with (1) RESUME_TIPS_SCHEMA below and (2) ResumeTipsContent in
 * client/src/lib/types.ts — the content is stored as opaque JSON, so drift
 * between the three silently renders empty sections on the client.
 */
export interface ResumeTipsContent {
  summary: string;
  technologiesToStudy: { name: string; reason: string }[];
  missingFromResume: string[];
  bulletPointSuggestions: {
    current: string | null;
    suggested: string;
    reason: string;
  }[];
  strengthsToHighlight: string[];
  additionalTips: string[];
}

// KEEP IN SYNC with ResumeTipsContent above and client/src/lib/types.ts.
const RESUME_TIPS_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "3-5 sentence overall assessment of how well this resume fits this posting, naming the biggest strengths and gaps.",
    },
    technologiesToStudy: {
      type: "array",
      description:
        "The most important technologies or skills from the posting the candidate should study or deepen, most important first.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          reason: {
            type: "string",
            description:
              "Why this matters for this specific posting and how it relates to what's already on the resume.",
          },
        },
        required: ["name", "reason"],
        additionalProperties: false,
      },
    },
    missingFromResume: {
      type: "array",
      description:
        "Concrete things the posting asks for that the resume doesn't show — skills, experience types, keywords, certifications.",
      items: { type: "string" },
    },
    bulletPointSuggestions: {
      type: "array",
      description:
        "Specific resume bullet points to add, rewrite, or emphasize for this posting.",
      items: {
        type: "object",
        properties: {
          current: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description:
              "The existing resume text being revised, quoted from the resume. Null when suggesting a brand-new bullet.",
          },
          suggested: {
            type: "string",
            description: "The suggested bullet point text.",
          },
          reason: { type: "string" },
        },
        required: ["current", "suggested", "reason"],
        additionalProperties: false,
      },
    },
    strengthsToHighlight: {
      type: "array",
      description:
        "Existing resume strengths that match this posting well and deserve prominence (in the resume, cover letter, or interview).",
      items: { type: "string" },
    },
    additionalTips: {
      type: "array",
      description:
        "Any other actionable advice for this application — e.g. portfolio work, framing of experience, interview prep angles.",
      items: { type: "string" },
    },
  },
  required: [
    "summary",
    "technologiesToStudy",
    "missingFromResume",
    "bulletPointSuggestions",
    "strengthsToHighlight",
    "additionalTips",
  ],
  additionalProperties: false,
};

/**
 * Hash of every posting field the analysis actually reads. If none of these
 * changed, a re-run would see identical input — which is what "the job
 * listing has changed" is measured against.
 */
export function jobPostingFingerprint(posting: PostingWithCompany): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        posting.title,
        posting.company?.name ?? null,
        posting.location,
        posting.salary,
        posting.description,
        posting.jobUrl,
      ])
    )
    .digest("hex");
}

/**
 * Runs the resume-coach agent: reads the resume markdown and the posting,
 * and returns structured, posting-specific advice.
 */
export async function generateResumeTips(
  resumeMarkdown: string,
  posting: PostingWithCompany
): Promise<ResumeTipsContent> {
  const postingDetails = formatPostingForPrompt(posting, {
    includeSalaryAndUrl: true,
  });

  return generateStructured<ResumeTipsContent>({
    system:
      "You are an expert career coach and technical recruiter. You compare a candidate's resume against a specific job posting and produce concrete, honest, actionable advice. Ground every point in the actual resume and posting text — never invent experience the candidate doesn't have, and prefer specific wording over generic advice. When the posting's description is thin, reason from the title, company, and industry norms for that role, and say when you're doing so.",
    prompt: `Analyze how well this resume fits this job posting and produce tailored advice.\n\n<job_posting>\n${postingDetails}\n</job_posting>\n\n<resume>\n${truncate(resumeMarkdown, MAX_RESUME_CHARS)}\n</resume>`,
    schema: RESUME_TIPS_SCHEMA,
    // Adaptive thinking (on by default for this model) shares this budget
    // with the JSON output, so leave generous headroom to avoid truncation.
    maxTokens: 16000,
  });
}
