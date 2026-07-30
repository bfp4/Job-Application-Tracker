import { createHash } from "crypto";
import type { ApplicationStatus, CareerSpecialization } from "@prisma/client";
import { HAIKU, generateStructured } from "../lib/anthropic";
import { MAX_CONNECT_MESSAGE_CHARS } from "../lib/contactInput";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  jobPostingFingerprint,
  truncate,
  type PostingWithCompany,
} from "../lib/prompt";
import { linkedinMessageGuidance } from "../lib/linkedinMessageSpecializations";

// Small caps for the free-text segments unique to this prompt.
const MAX_NOTES_CHARS = 4_000;
const MAX_CONTACT_NOTES_CHARS = 2_000;

const MESSAGE_SCHEMA = {
  type: "object",
  properties: {
    // No `maxLength` here: string length constraints aren't part of the JSON
    // Schema subset structured outputs supports. The limit is enforced by the
    // prompt and, definitively, by the trim below.
    message: {
      type: "string",
      description: `The LinkedIn connection-request note, ready to paste. Plain text, first person, no greeting line breaks needed, and at most ${MAX_CONNECT_MESSAGE_CHARS} characters including spaces.`,
    },
  },
  required: ["message"],
  additionalProperties: false,
};

/** The pieces of a contact this prompt personalizes around. */
export interface ContactForMessage {
  name: string;
  position: string | null;
  notes: string | null;
}

/**
 * Hash of every input this service's prompt reads. The route stores it next to
 * the note it produced and refuses a regenerate while it still matches, so an
 * untouched contact can't spend a model call reproducing the same note.
 *
 * The resume is identified by id rather than content: BaseResume rows are
 * append-only, so a new upload means a new id — and taking the id lets the
 * route decide to refuse before paying for the S3 read of the markdown.
 *
 * KEEP IN SYNC with the inputs generateConnectMessage below actually reads.
 * A prompt input missing here makes the gate refuse regenerates the user is
 * entitled to, which looks like the button being broken.
 */
export interface ConnectMessageInputs {
  contact: ContactForMessage;
  posting: PostingWithCompany;
  applicationStatus: ApplicationStatus;
  applicationNotes: string | null;
  baseResumeId: string | null;
  specialization: CareerSpecialization | null;
}

export function connectMessageFingerprint(input: ConnectMessageInputs): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.contact.name,
        input.contact.position,
        input.contact.notes,
        // Covers the posting's title, company, location, salary, description,
        // and URL — a superset of what this prompt renders, so a salary-only
        // edit permits a regenerate that wouldn't change the note. Erring that
        // way keeps one definition of "the posting changed" across features.
        jobPostingFingerprint(input.posting),
        input.applicationStatus,
        input.applicationNotes,
        input.baseResumeId,
        input.specialization,
      ])
    )
    .digest("hex");
}

/** The application-side inputs a note is drafted from, shared by its contacts. */
export type ConnectMessageContext = Omit<ConnectMessageInputs, "contact">;

/**
 * Builds that shared context from an application row joined with its posting,
 * so the routes don't each restate which application fields feed the prompt.
 */
export function connectMessageContext(
  application: {
    status: ApplicationStatus;
    notes: string | null;
    jobPosting: PostingWithCompany;
  },
  baseResumeId: string | null,
  specialization: CareerSpecialization | null
): ConnectMessageContext {
  return {
    posting: application.jobPosting,
    applicationStatus: application.status,
    applicationNotes: application.notes,
    baseResumeId,
    specialization,
  };
}

/** The Contact fields the up-to-date check reads. */
export type ContactWithMessage = ContactForMessage & {
  connectMessage: string | null;
  connectMessageHash: string | null;
};

/**
 * Attaches `connectMessageUpToDate` to a contact on its way out of the API.
 *
 * The generate route refuses while a saved note still matches its inputs, so
 * every response that carries a contact carries this too — otherwise the client
 * can only discover the refusal by clicking the button and reading a 409.
 * Generic over the row so Prisma's other Contact fields pass through untouched.
 */
export function serializeContact<T extends ContactWithMessage>(
  contact: T,
  context: ConnectMessageContext
): T & { connectMessageUpToDate: boolean } {
  return {
    ...contact,
    connectMessageUpToDate: Boolean(
      contact.connectMessage &&
        contact.connectMessageHash ===
          connectMessageFingerprint({ ...context, contact })
    ),
  };
}

/**
 * How the candidate's application stands is the single biggest lever on what
 * the note should say — you can't tell a recruiter you applied if you haven't,
 * and an active interview is a stronger, more specific hook than a fresh
 * application. Each status maps to one line of guidance the model must follow.
 */
function statusGuidance(status: ApplicationStatus): string {
  switch (status) {
    case "NOT_APPLIED":
      return "The candidate has NOT applied yet — they are about to. Express genuine interest in the role and that they plan to apply; do NOT claim they already applied.";
    case "APPLIED":
      return "The candidate has applied and is waiting to hear back. Mention that they recently applied for the role.";
    case "PHONE_SCREEN":
      return "The candidate has applied and completed (or scheduled) a phone screen. Mention they applied and are early in the process; keep it warm and low-pressure.";
    case "INTERVIEW":
      return "The candidate is actively interviewing for the role. Reference that they are in the interview process — this is a strong, specific hook worth naming.";
    case "OFFER":
      return "The candidate is in the final stages / has an offer for the role. Reference being far along in the process and wanting to connect with the team.";
    case "REJECTED":
      return "The candidate applied but was not moved forward. Do NOT dwell on the rejection; frame it as having been interested in the role and wanting to stay connected for the future.";
    default:
      return "Reference the candidate's interest in the role.";
  }
}

/**
 * Drafts a LinkedIn connection-request note (max 300 chars) introducing the
 * candidate to a contact tied to a specific application, grounded in the
 * posting, the candidate's resume, the application's status, and any notes.
 *
 * The note is deliberately short: research on connection requests shows notes
 * of ~120–180 chars outperform ones that fill the whole 300, and that a
 * request should open a relationship (a specific, genuine reason to connect),
 * not pitch or ask for a job outright.
 *
 * Within those 300 characters the register and the one credibility detail vary
 * by field — a finance note reads nothing like a design note — so the
 * candidate's Career Specialization steers both. It falls back to General when
 * the user hasn't chosen one.
 */
export async function generateConnectMessage(
  contact: ContactForMessage,
  posting: PostingWithCompany,
  applicationStatus: ApplicationStatus,
  applicationNotes: string | null,
  resumeMarkdown: string | null,
  specialization?: CareerSpecialization
): Promise<string> {
  const contactLines = [`Name: ${contact.name}`];
  if (contact.position?.trim()) {
    contactLines.push(`Role/title: ${contact.position.trim()}`);
  }
  if (contact.notes?.trim()) {
    contactLines.push(
      `What the candidate knows about them: ${truncate(contact.notes.trim(), MAX_CONTACT_NOTES_CHARS)}`
    );
  }

  const sections = [
    `<contact>\n${contactLines.join("\n")}\n</contact>`,
    `<job_posting>\n${formatPostingForPrompt(posting)}\n</job_posting>`,
    `<application_status>\n${statusGuidance(applicationStatus)}\n</application_status>`,
  ];
  if (resumeMarkdown?.trim()) {
    sections.push(
      `<candidate_resume>\n${truncate(resumeMarkdown, MAX_RESUME_CHARS)}\n</candidate_resume>`
    );
  }
  if (applicationNotes?.trim()) {
    sections.push(
      `<application_notes>\n${truncate(applicationNotes, MAX_NOTES_CHARS)}\n</application_notes>`
    );
  }

  const { label, guidance } = linkedinMessageGuidance(specialization);

  const { message } = await generateStructured<{ message: string }>({
    system: [
      "You ghost-write LinkedIn connection-request notes for a job candidate reaching out to a contact at a company they are applying to. The goal is to open a relationship that improves the visibility of the candidate's application — not to pitch or ask for a job in the note itself.",
      `This candidate is targeting ${label} roles. Write the note the way it lands in that field:\n${guidance}`,
      "Hard rules:",
      "- HARD LIMIT: at most 300 characters including spaces. Aim for 180–260 characters — concise beats comprehensive.",
      "- Write in the first person as the candidate, warm and professional, never stiff or salesy.",
      "- Address the contact by their first name.",
      "- Name the specific role and company, and tie the reason for connecting to it, guided strictly by the application status.",
      "- Ground any claim about the candidate's background only in their resume; never invent employers, titles, metrics, or shared history. If a personalizing detail would help but isn't in the materials, leave it out rather than fabricating it.",
      "- Do NOT ask for a referral, a call, or a job in the note. A soft, low-pressure close (e.g. wanting to connect / follow the team's work) is the ceiling.",
      "- Return plain text with no surrounding quotes, no subject line, and no '[bracketed placeholders]'.",
    ].join("\n"),
    prompt: `Write the LinkedIn connection-request note.\n\n${sections.join("\n\n")}`,
    schema: MESSAGE_SCHEMA,
    // The cheapest call in the app: a 300-character note from rules this
    // explicit doesn't need Sonnet, and doesn't need to reason first either.
    model: HAIKU,
    reasoning: "off",
    maxTokens: 2000,
  });

  const trimmed = message.trim();
  // Safety net: the schema and prompt both cap length, but never let a stray
  // over-limit draft reach the DB / LinkedIn. Trim at a word boundary.
  if (trimmed.length <= MAX_CONNECT_MESSAGE_CHARS) return trimmed;
  const hardCut = trimmed.slice(0, MAX_CONNECT_MESSAGE_CHARS);
  const lastSpace = hardCut.lastIndexOf(" ");
  return (lastSpace > 200 ? hardCut.slice(0, lastSpace) : hardCut).trim();
}
