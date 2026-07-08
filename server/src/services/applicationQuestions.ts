import { generateStructured } from "../lib/anthropic";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  truncate,
  type PostingWithCompany,
} from "../lib/prompt";

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "The drafted answer, written in the candidate's voice (first person), ready to paste into the application form. Plain text — no markdown headings or bullets unless the question clearly calls for a list.",
    },
  },
  required: ["answer"],
  additionalProperties: false,
};

// Caps for the segments only this prompt has; the resume/description caps
// live in lib/prompt.ts.
const MAX_NOTES_CHARS = 10_000;
const MAX_QUESTION_CHARS = 5_000;
const MAX_DRAFT_CHARS = 10_000;

/**
 * Drafts an answer to one application-form question, grounded in the
 * candidate's resume, the job posting, and their notes on this application.
 *
 * When `existingDraft` is provided the call refines it — the draft's
 * substance and voice lead, the other materials support — instead of
 * writing a fresh answer.
 */
export async function generateQuestionAnswer(
  question: string,
  resumeMarkdown: string,
  posting: PostingWithCompany,
  applicationNotes: string | null,
  existingDraft: string | null = null
): Promise<string> {
  const postingDetails = formatPostingForPrompt(posting);

  const sections = [
    `<question>\n${truncate(question, MAX_QUESTION_CHARS)}\n</question>`,
    `<job_posting>\n${postingDetails}\n</job_posting>`,
    `<resume>\n${truncate(resumeMarkdown, MAX_RESUME_CHARS)}\n</resume>`,
  ];
  if (applicationNotes?.trim()) {
    sections.push(
      `<candidate_notes>\n${truncate(applicationNotes, MAX_NOTES_CHARS)}\n</candidate_notes>`
    );
  }
  if (existingDraft?.trim()) {
    sections.push(
      `<candidate_draft>\n${truncate(existingDraft, MAX_DRAFT_CHARS)}\n</candidate_draft>`
    );
  }

  const instruction = existingDraft?.trim()
    ? "Refine the candidate's draft answer to this job-application question. The draft is the primary source: keep its substance, angle, and any personal details it adds beyond the resume, and preserve the candidate's voice. Improve clarity, structure, grammar, and impact, and strengthen it with relevant specifics from the resume — do not discard the draft's ideas and start over."
    : "Draft an answer to this job-application question for the candidate.";

  const { answer } = await generateStructured<{ answer: string }>({
    system:
      "You ghost-write answers to job-application form questions on behalf of a candidate. Write in the candidate's voice, in the first person, grounded strictly in their resume, notes, and any draft they provide — never invent employers, projects, metrics, or dates that aren't there. Where a compelling answer needs a specific detail the materials don't provide, insert a short [bracketed placeholder] describing what the candidate should fill in. Tailor the answer to the specific company and posting. Match the answer's length to the question: most application answers should be roughly 100–250 words — concise, concrete, and free of clichés and filler.",
    prompt: `${instruction}\n\n${sections.join("\n\n")}`,
    schema: ANSWER_SCHEMA,
    // Adaptive thinking shares this budget with the JSON output — keep headroom.
    maxTokens: 8000,
  });

  return answer;
}
