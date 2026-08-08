import type { CareerSpecialization } from "@prisma/client";
import { generateStructured } from "../../../lib/anthropic/anthropic";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  truncate,
  type PostingWithCompany,
} from "../../../lib/prompt";
import {
  resumeTipsSpecialization,
  type ResumeTipsFocusField,
} from "../../../lib/resumeTipsSpecializations";

// jobPostingFingerprint now lives in lib/prompt so the tailored-resume service
// can share it without depending on this module. Re-exported here because
// callers (and tests) still import it from the resume-tips service.
export { jobPostingFingerprint } from "../../../lib/prompt";

/** One entry in a specialization-specific focus section. */
export interface ResumeTipsFocusItem {
  name: string;
  reason: string;
}

/**
 * Structured tips the agent produces for one (resume, job posting) pair.
 *
 * The core fields below are the same for every user. On top of them, each
 * Career Specialization contributes two focus sections of its own — software
 * engineers get `technologiesToStudy`, nurses get `certificationsToPursue`,
 * and so on (see lib/resumeTipsSpecializations.ts) — so the shape is a core
 * object plus whichever focus keys that specialization defines.
 *
 * KEEP IN SYNC with (1) resumeTipsSchema below, (2) the focus-field keys in
 * lib/resumeTipsSpecializations.ts, and (3) ResumeTipsContent in
 * client/src/lib/types.ts — the content is stored as opaque JSON, so drift
 * between them silently renders empty sections on the client.
 */
export type ResumeTipsContent = {
  summary: string;
  missingFromResume: string[];
  bulletPointSuggestions: {
    current: string | null;
    suggested: string;
    reason: string;
  }[];
  strengthsToHighlight: string[];
  additionalTips: string[];
} & {
  /** Specialization-specific sections, e.g. technologiesToStudy. */
  [focusKey: string]: unknown;
};

/** The properties every specialization's schema shares. */
const CORE_PROPERTIES = {
  summary: {
    type: "string",
    description:
      "3-5 sentence overall assessment of how well this resume fits this posting, naming the biggest strengths and gaps.",
  },
  missingFromResume: {
    type: "array",
    description:
      "Things the posting genuinely requires that the candidate does NOT have and would need to go acquire — missing skills, experience types, or certifications. Do NOT list something the candidate already has but worded differently: that is an ATS keyword-match gap they can fix right now, so route it to bulletPointSuggestions instead. Likewise route an acronym/expansion mismatch (resume says \"CPA\", posting says \"Certified Public Accountant\", or vice versa) to bulletPointSuggestions, not here.",
    items: { type: "string" },
  },
  bulletPointSuggestions: {
    type: "array",
    description:
      "Specific resume bullets to add, rewrite, or emphasize for this posting. Use this for ATS keyword-match fixes the candidate can make immediately — where they already have the experience but should mirror the posting's exact terminology, or pair an acronym with its expanded form (e.g. \"Certified Public Accountant (CPA)\").",
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
} as const;

/** A focus section: an ordered list of {name, reason} pairs. */
function focusProperty(field: ResumeTipsFocusField) {
  return {
    type: "array",
    description: `${field.description} Most important first.`,
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
  };
}

/**
 * Builds the structured-output schema for one specialization: the shared core
 * plus that field's focus sections, with the focus sections placed right after
 * the summary so the model reasons about them before writing bullet rewrites.
 *
 * Exported for tests. KEEP IN SYNC with ResumeTipsContent above.
 */
export function resumeTipsSchema(
  specialization?: CareerSpecialization | null
): Record<string, unknown> {
  const { focusFields } = resumeTipsSpecialization(specialization);

  const focusProperties = Object.fromEntries(
    focusFields.map((field) => [field.key, focusProperty(field)])
  );

  return {
    type: "object",
    properties: {
      summary: CORE_PROPERTIES.summary,
      ...focusProperties,
      missingFromResume: CORE_PROPERTIES.missingFromResume,
      bulletPointSuggestions: CORE_PROPERTIES.bulletPointSuggestions,
      strengthsToHighlight: CORE_PROPERTIES.strengthsToHighlight,
      additionalTips: CORE_PROPERTIES.additionalTips,
    },
    required: [
      "summary",
      ...focusFields.map((field) => field.key),
      "missingFromResume",
      "bulletPointSuggestions",
      "strengthsToHighlight",
      "additionalTips",
    ],
    additionalProperties: false,
  };
}

const BASE_SYSTEM_PROMPT =
  "You are an expert career coach and recruiter. You compare a candidate's resume against a specific job posting and produce concrete, honest, actionable advice. Ground every point in the actual resume and posting text — never invent experience the candidate doesn't have, and prefer specific wording over generic advice. When the posting's description is thin, reason from the title, company, and industry norms for that role, and say when you're doing so. Distinguish two kinds of gap: things the candidate genuinely lacks and must go acquire, versus things they already have but haven't worded to match the posting — the latter are ATS keyword-match fixes they can make immediately, so surface them as bullet rewrites rather than as missing items.";

/**
 * Runs the resume-coach agent: reads the resume markdown and the posting, and
 * returns structured, posting-specific advice shaped for the candidate's
 * career field (software engineers get technologies to study, nurses get
 * certifications and clinical detail, and so on). Falls back to the General
 * shape when the user hasn't chosen a specialization.
 */
export async function generateResumeTips(
  resumeMarkdown: string,
  posting: PostingWithCompany,
  specialization?: CareerSpecialization
): Promise<ResumeTipsContent> {
  const postingDetails = formatPostingForPrompt(posting, {
    includeSalaryAndUrl: true,
  });

  const { label, guidance } = resumeTipsSpecialization(specialization);

  const system = [
    BASE_SYSTEM_PROMPT,
    `\nThis candidate is targeting ${label} roles. Judge the resume by that field's hiring conventions:\n${guidance}`,
  ].join("\n");

  return generateStructured<ResumeTipsContent>({
    system,
    prompt: `Analyze how well this resume fits this job posting and produce tailored advice.\n\n<job_posting>\n${postingDetails}\n</job_posting>\n\n<resume>\n${truncate(resumeMarkdown, MAX_RESUME_CHARS)}\n</resume>`,
    schema: resumeTipsSchema(specialization),
    // Judging a resume against a posting is the most analytical of these
    // prompts, but `medium` covers it — `high` mostly bought longer reasoning.
    reasoning: "medium",
    // Thinking shares this budget with the JSON output, so leave generous
    // headroom to avoid truncation.
    maxTokens: 16000,
  });
}
