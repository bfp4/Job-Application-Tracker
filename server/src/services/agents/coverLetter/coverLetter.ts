import type { CareerSpecialization } from "@prisma/client";
import { generateStructured } from "../../../lib/anthropic/anthropic";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  truncate,
  type PostingWithCompany,
} from "../../../lib/prompt";
import { coverLetterGuidance } from "../../../lib/coverLetterSpecializations";

/**
 * A cover letter written for one posting from the candidate's real resume.
 * Stored as opaque JSON, so KEEP IN SYNC with (1) COVER_LETTER_SCHEMA below,
 * (2) the PDF renderer in lib/coverLetterRender.ts, and (3) CoverLetterContent
 * in client/src/lib/types.ts. Drift between them silently renders an empty
 * letter or a broken PDF.
 *
 * There is deliberately no date field: the date belongs to the day the letter
 * is sent, so the renderer stamps it at download time rather than freezing the
 * generation date into the draft.
 */
export interface CoverLetterContent {
  header: {
    /** The candidate's name, taken verbatim from the resume. */
    name: string;
    /** Contact lines (email, phone, location, links) as they appear. */
    contact: string[];
  };
  /** Addressee block. Every field is null unless the posting actually names it. */
  recipient: {
    name: string | null;
    title: string | null;
    company: string | null;
  };
  /** Salutation line, e.g. "Dear Hiring Manager,". */
  greeting: string;
  /** Body paragraphs in order — 3 or 4 of them, ~250-400 words total. */
  paragraphs: string[];
  /** Sign-off line, e.g. "Sincerely,". */
  closing: string;
  /** The name typed under the sign-off. */
  signature: string;
  /** One plain-language line on the angle the letter takes, for the user. */
  approachNote: string;
}

/**
 * Runtime check that an arbitrary JSON value is a usable CoverLetterContent.
 *
 * The generate path is constrained by COVER_LETTER_SCHEMA, but PATCH accepts a
 * client-supplied body, and the PDF renderer reads this shape without guards
 * (`content.header.contact.filter(...)`). Without this, a malformed PATCH is
 * accepted and only fails later, as a 500, on download.
 * KEEP IN SYNC with CoverLetterContent above.
 */
export function isCoverLetterContent(value: unknown): value is CoverLetterContent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;

  const header = c.header as Record<string, unknown> | undefined;
  if (
    typeof header !== "object" ||
    header === null ||
    typeof header.name !== "string" ||
    !isStringArray(header.contact)
  ) {
    return false;
  }

  const recipient = c.recipient as Record<string, unknown> | undefined;
  if (typeof recipient !== "object" || recipient === null) return false;
  for (const field of ["name", "title", "company"] as const) {
    if (recipient[field] !== null && typeof recipient[field] !== "string") return false;
  }

  if (!isStringArray(c.paragraphs)) return false;

  for (const field of ["greeting", "closing", "signature", "approachNote"] as const) {
    if (typeof c[field] !== "string") return false;
  }

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

// KEEP IN SYNC with CoverLetterContent above and client/src/lib/types.ts.
const COVER_LETTER_SCHEMA = {
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
            "Contact lines exactly as they appear on the resume (email, phone, location, LinkedIn, portfolio). Do not invent any that aren't present.",
          items: { type: "string" },
        },
      },
      required: ["name", "contact"],
      additionalProperties: false,
    },
    recipient: {
      type: "object",
      description:
        "Who the letter is addressed to. Use only names and titles the posting actually states — null otherwise. Never guess a hiring manager's name.",
      properties: {
        name: { anyOf: [{ type: "string" }, { type: "null" }] },
        title: { anyOf: [{ type: "string" }, { type: "null" }] },
        company: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "The hiring company's name, if known.",
        },
      },
      required: ["name", "title", "company"],
      additionalProperties: false,
    },
    greeting: {
      type: "string",
      description:
        "The salutation line, including its comma — e.g. \"Dear Hiring Manager,\". Use a real name only if the posting names the hiring contact.",
    },
    paragraphs: {
      type: "array",
      description:
        "Body paragraphs in order: an opening that names the role and the single strongest reason this candidate fits; one or two evidence paragraphs built on real resume accomplishments mapped to the posting's needs; and a close on why this employer specifically, with a direct ask for a conversation. 3 or 4 paragraphs, 250-400 words total.",
      items: { type: "string" },
    },
    closing: {
      type: "string",
      description: "Sign-off line including its comma — e.g. \"Sincerely,\".",
    },
    signature: {
      type: "string",
      description: "The candidate's name as typed under the sign-off.",
    },
    approachNote: {
      type: "string",
      description:
        "One plain-language sentence telling the candidate what angle this letter takes and which of their experiences it leans on.",
    },
  },
  required: [
    "header",
    "recipient",
    "greeting",
    "paragraphs",
    "closing",
    "signature",
    "approachNote",
  ],
  additionalProperties: false,
};

// Recruiters spend under a minute on a cover letter and consistently report
// preferring short ones, so the length ceiling is part of the contract rather
// than a style note. The renderer also fits to one page, but staying inside
// this budget means nothing has to shrink.
const LENGTH_BUDGET = `HARD LENGTH LIMIT: 250-400 words of body text across exactly 3 or 4 paragraphs. Every paragraph must earn its place — if a sentence doesn't tell the reader something the resume can't, cut it.`;

// Two failure modes drive these rules: letters that restate the resume (which
// wastes the one document that can add context), and letters that read as
// machine-written boilerplate, which hiring managers report screening out.
const BASE_SYSTEM_PROMPT = `You are an expert cover letter writer. You write one letter for one candidate applying to one specific job, using only that candidate's real resume and the posting.

Your single hard rule: NEVER introduce a fact that isn't already in the resume. Do not add skills, tools, employers, job titles, dates, degrees, certifications, or metrics the candidate did not state. Do not claim familiarity with the company's products, mission, or news beyond what the job posting itself says. If the posting asks for something the resume genuinely lacks, do not fake it — either connect the closest real experience honestly or leave it out.

Write a letter that does the job a resume can't:
- SUPPORT the resume, don't repeat it. The resume lists what the candidate did; the letter explains why it matters for this role. Never restate a bullet verbatim.
- Be specific to this posting. Name the role, and draw on the responsibilities and requirements the posting actually states. A letter that could be sent to any employer is a failed letter.
- Lead with value to the employer, not what the candidate wants from the job.
- Ground each claim in one concrete accomplishment from the resume, with its real numbers where the resume gives them.

Write in a natural human voice. Avoid the patterns that make a letter read as generated: no "I am writing to express my keen interest", no "I am passionate about", no stacked adjectives, no superlatives without evidence, no closing that thanks the reader for their time and consideration in that exact phrasing. Prefer short, plain, declarative sentences and concrete nouns. Vary sentence length. Do not use markdown, bullet points, or headings — this is a letter, so \`paragraphs\` holds continuous prose.

Address the letter to a named person ONLY if the posting names one; otherwise use "Dear Hiring Manager,". Never invent a recipient name.`;

/**
 * Runs the cover-letter agent: reads the base resume markdown and the posting,
 * and returns a structured letter written for that posting, specialized for the
 * user's chosen field and kept within a recruiter-friendly length.
 */
export async function generateCoverLetter(
  resumeMarkdown: string,
  posting: PostingWithCompany,
  specialization?: CareerSpecialization
): Promise<CoverLetterContent> {
  const postingDetails = formatPostingForPrompt(posting, {
    includeSalaryAndUrl: true,
  });

  const { label, guidance } = coverLetterGuidance(specialization);

  const system = [
    BASE_SYSTEM_PROMPT,
    `\nThis candidate is targeting ${label} roles. Apply these field conventions (without inventing anything):\n${guidance}`,
    `\n${LENGTH_BUDGET}`,
  ].join("\n");

  return generateStructured<CoverLetterContent>({
    system,
    prompt: `Write a cover letter for this candidate applying to the job posting below, following the rules exactly.\n\n<job_posting>\n${postingDetails}\n</job_posting>\n\n<resume>\n${truncate(resumeMarkdown, MAX_RESUME_CHARS)}\n</resume>`,
    schema: COVER_LETTER_SCHEMA,
    // Mapping real accomplishments onto a posting's needs is worth reasoning
    // about, but not at Sonnet's default `high` — the letter is 400 words.
    reasoning: "medium",
    // The letter itself is short, but thinking shares this budget with the
    // JSON — leave headroom so the output is never truncated mid-object.
    maxTokens: 12000,
  });
}
