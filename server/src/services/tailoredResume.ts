import type { ResumeSpecialization } from "@prisma/client";
import { generateStructured } from "../lib/anthropic";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  truncate,
  type PostingWithCompany,
} from "../lib/prompt";
import { specializationGuidance } from "./../lib/resumeSpecializations";

/**
 * A resume retargeted at one posting by rephrasing and reordering the base
 * resume — never by inventing experience. This is stored as opaque JSON, so
 * KEEP IN SYNC with (1) TAILORED_RESUME_SCHEMA below, (2) the PDF renderer in
 * lib/resumeRender.ts, and (3) TailoredResumeContent in client/src/lib/types.ts.
 * Drift between them silently renders empty sections or a broken PDF.
 */
export interface TailoredResumeContent {
  header: {
    /** The candidate's name, taken verbatim from the resume. */
    name: string;
    /** Contact lines (email, phone, location, links) as they appear, one each. */
    contact: string[];
  };
  /** A short professional summary retargeted at this posting, or null. */
  summary: string | null;
  sections: {
    /** Section heading, e.g. "Experience", "Skills", "Education". */
    title: string;
    entries: {
      /** Role @ company · dates, or a skills-group label. Null if none. */
      heading: string | null;
      bullets: {
        /**
         * The original resume line this was derived from, quoted. Null when the
         * bullet is a pure reorder/regroup of existing content with no source
         * line — never used to smuggle in a new claim.
         */
        before: string | null;
        /** The retargeted wording. Facts must come from `before`/the resume. */
        after: string;
      }[];
    }[];
  }[];
  /** One-line, plain-language note on what was emphasized for this posting. */
  changeNote: string;
}

// KEEP IN SYNC with TailoredResumeContent above and client/src/lib/types.ts.
const TAILORED_RESUME_SCHEMA = {
  type: "object",
  properties: {
    header: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The candidate's name, verbatim from the resume.",
        },
        contact: {
          type: "array",
          description:
            "Contact/identity lines exactly as they appear on the resume (email, phone, location, LinkedIn, portfolio). Do not invent any that aren't present.",
          items: { type: "string" },
        },
      },
      required: ["name", "contact"],
      additionalProperties: false,
    },
    summary: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "A 2-4 sentence professional summary retargeted at this posting, built only from facts already in the resume. Null if the resume has no summary and one can't be written without inventing anything.",
    },
    sections: {
      type: "array",
      description:
        "The resume's sections, reordered so the most relevant to this posting come first. Preserve the candidate's real section set — do not add sections for experience they don't have.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                  description:
                    "Role, company, and dates (or a skills-group label), verbatim facts from the resume. Null when the entry has no heading.",
                },
                bullets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      before: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                        description:
                          "The original resume line this bullet is derived from, quoted. Null only for a pure reorder/regroup of existing content.",
                      },
                      after: {
                        type: "string",
                        description:
                          "The retargeted bullet. Every fact (skills, tools, employers, dates, metrics) must be present in `before` or elsewhere in the resume — never introduce new ones.",
                      },
                    },
                    required: ["before", "after"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["heading", "bullets"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "entries"],
        additionalProperties: false,
      },
    },
    changeNote: {
      type: "string",
      description:
        "One plain-language sentence telling the candidate what you emphasized/reordered for this posting.",
    },
  },
  required: ["header", "summary", "sections", "changeNote"],
  additionalProperties: false,
};

// The resume must fit on one printed page, so the model is given an explicit
// content budget. The renderer also hard-caps at one page, but keeping the
// content within budget means that cap trims nothing.
const ONE_PAGE_BUDGET = `HARD LENGTH LIMIT: the finished resume MUST fit on a single US Letter page. Keep it tight:
- a summary of at most 2 short sentences (or null if the resume has none),
- at most 4 sections,
- at most 4 entries in the largest section,
- at most ~18 bullets across the whole resume,
- each bullet one line — roughly 30 words or fewer.
When forced to choose, keep the content most relevant to this posting and drop the rest. Do not pad.`;

const BASE_SYSTEM_PROMPT = `You are an expert resume writer. You take a candidate's existing resume and rewrite it to target one specific job posting.

Your single hard rule: NEVER introduce a fact that isn't already in the resume. Do not add skills, tools, technologies, employers, job titles, dates, degrees, certifications, or metrics the candidate did not state. You may only:
- rephrase existing bullets to use the posting's language and foreground relevant impact,
- reorder sections, entries, and bullets so the most relevant content comes first,
- drop or de-emphasize content that's irrelevant to this posting,
- regroup existing skills.

For every bullet you output, set \`before\` to the resume line you derived it from (quoted). Use \`before: null\` only when a bullet is a pure reorder of content that already exists, never to slip in something new. If the posting wants something the resume genuinely lacks, do NOT add it — that gap is expected and is handled elsewhere. Keep the candidate's real section set and their name/contact details exactly as written.`;

/**
 * Runs the tailored-resume agent: reads the base resume markdown and the
 * posting, and returns a structured resume rewritten (rephrase/reorder only)
 * to target the posting, specialized for the user's chosen field and kept to
 * one page.
 */
export async function generateTailoredResume(
  resumeMarkdown: string,
  posting: PostingWithCompany,
  specialization?: ResumeSpecialization
): Promise<TailoredResumeContent> {
  const postingDetails = formatPostingForPrompt(posting, {
    includeSalaryAndUrl: true,
  });

  const { label, guidance } = specializationGuidance(specialization);

  const system = [
    BASE_SYSTEM_PROMPT,
    `\nThis candidate is targeting ${label} roles. Apply these field conventions (without inventing anything):\n${guidance}`,
    `\n${ONE_PAGE_BUDGET}`,
  ].join("\n");

  return generateStructured<TailoredResumeContent>({
    system,
    prompt: `Rewrite this resume to target the job posting below, following the rules exactly.\n\n<job_posting>\n${postingDetails}\n</job_posting>\n\n<resume>\n${truncate(resumeMarkdown, MAX_RESUME_CHARS)}\n</resume>`,
    schema: TAILORED_RESUME_SCHEMA,
    // Full resume output is larger than the tips analysis, and adaptive
    // thinking shares this budget with the JSON — leave generous headroom.
    maxTokens: 20000,
  });
}
