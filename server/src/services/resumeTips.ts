import { createHash } from "crypto";
import type { Company, JobPosting } from "@prisma/client";
import { generateStructured } from "../lib/anthropic";

/** Structured tips the agent produces for one (resume, job posting) pair. */
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

type PostingWithCompany = JobPosting & { company: Company | null };

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
 * Runs the resume-coach agent: reads the full resume markdown and the full
 * posting, and returns structured, posting-specific advice.
 */
export async function generateResumeTips(
  resumeMarkdown: string,
  posting: PostingWithCompany
): Promise<ResumeTipsContent> {
  const postingDetails = [
    `Title: ${posting.title}`,
    `Company: ${posting.company?.name ?? "Unknown"}`,
    `Location(s): ${posting.location.length ? posting.location.join(", ") : "Not specified"}`,
    `Salary: ${posting.salary ?? "Not specified"}`,
    `URL: ${posting.jobUrl}`,
    `Description:\n${posting.description ?? "No description provided."}`,
  ].join("\n");

  return generateStructured<ResumeTipsContent>({
    system:
      "You are an expert career coach and technical recruiter. You compare a candidate's resume against a specific job posting and produce concrete, honest, actionable advice. Ground every point in the actual resume and posting text — never invent experience the candidate doesn't have, and prefer specific wording over generic advice. When the posting's description is thin, reason from the title, company, and industry norms for that role, and say when you're doing so.",
    prompt: `Analyze how well this resume fits this job posting and produce tailored advice.\n\n<job_posting>\n${postingDetails}\n</job_posting>\n\n<resume>\n${resumeMarkdown}\n</resume>`,
    schema: RESUME_TIPS_SCHEMA,
    maxTokens: 8192,
  });
}
