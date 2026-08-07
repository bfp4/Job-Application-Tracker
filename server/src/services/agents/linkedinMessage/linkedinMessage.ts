import { createHash } from "crypto";
import type { ApplicationStatus, CareerSpecialization } from "@prisma/client";
import { HAIKU, generateStructured } from "../../../lib/anthropic/anthropic";
import { MAX_CONNECT_MESSAGE_CHARS } from "../../../lib/contactInput";
import {
  MAX_RESUME_CHARS,
  formatPostingForPrompt,
  jobPostingFingerprint,
  truncate,
  type PostingWithCompany,
} from "../../../lib/prompt";
import { linkedinMessageGuidance } from "../../../lib/linkedinMessageSpecializations";

// Small caps for the free-text segments unique to this prompt.
const MAX_NOTES_CHARS = 4_000;
const MAX_CONTACT_NOTES_CHARS = 2_000;

/**
 * How many drafts the model returns per call.
 *
 * Language models cannot count characters — asking for one note "under 300
 * characters" reliably produces notes over it, and the old fix (hard-cutting
 * the overflow) shipped notes that stopped mid-sentence. Three independent
 * drafts in one call cost a few dozen extra output tokens and let `pickNote`
 * choose one that actually fits, so the truncation path is a genuine last
 * resort rather than the common case.
 */
const DRAFT_COUNT = 3;

const MESSAGE_SCHEMA = {
  type: "object",
  properties: {
    // No `maxLength` / `minItems` here: length constraints aren't part of the
    // JSON Schema subset structured outputs supports. Count and length are
    // enforced by the prompt and, definitively, by pickNote below.
    notes: {
      type: "array",
      items: {
        type: "string",
        description: `One complete LinkedIn connection-request note, ready to paste. Plain text, first person, single paragraph, at most ${MAX_CONNECT_MESSAGE_CHARS} characters including spaces.`,
      },
      description: `Exactly ${DRAFT_COUNT} independent drafts of the note, each a complete note on its own. Vary the opening and the wording between them; do not return one note split into parts.`,
    },
  },
  required: ["notes"],
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
 * application. Each status maps to one line of guidance the model must follow,
 * and to the one direct ask that status earns.
 *
 * The ask is stated outright on purpose. Hedged closes ("would love to connect
 * and follow the team's work") read as filler and leave the reader with nothing
 * to do; the note exists to get the application looked at, so it says so.
 */
function statusGuidance(status: ApplicationStatus): string {
  switch (status) {
    case "NOT_APPLIED":
      return "The candidate has NOT applied yet — they are about to. Do NOT claim they already applied. Say they are applying for the role, and ask directly whether this person is the right one to send it to, or would be willing to keep an eye out for it.";
    case "APPLIED":
      return "The candidate applied and is waiting to hear back. Say they applied, and ask directly for what they actually want: that this person take a look at the application, or pass it to whoever is reviewing.";
    case "PHONE_SCREEN":
      return "The candidate applied and has done (or booked) a phone screen. Say where they are in the process, and ask directly for the one thing that helps next: what the team is weighing, or a word put in before the next round.";
    case "INTERVIEW":
      return "The candidate is actively interviewing for the role — the strongest hook they have, so name it. Ask directly for what this person can actually give: what the team is really looking for, or their support internally.";
    case "OFFER":
      return "The candidate is at the final stage or holds an offer. Say so plainly and ask directly to connect with this person properly before they join.";
    case "REJECTED":
      return "The candidate applied and was not moved forward. State it in a few words without apologising or dwelling, and ask directly to be kept in mind for the next opening on the team.";
    default:
      return "Say why the candidate is writing and ask directly for the one thing they want.";
  }
}

/**
 * Picks the note to keep from the model's drafts: the longest one that fits.
 *
 * Longest-that-fits rather than shortest, because every draft is already built
 * to the same word budget — the extra characters are a concrete detail the
 * shorter drafts dropped, not padding.
 */
function pickNote(notes: string[]): string {
  const cleaned = notes
    .filter((note): note is string => typeof note === "string")
    .map((note) => note.trim())
    .filter((note) => note !== "");

  if (cleaned.length === 0) {
    throw new Error("Claude returned no usable LinkedIn note drafts.");
  }

  const fitting = cleaned.filter((note) => note.length <= MAX_CONNECT_MESSAGE_CHARS);
  if (fitting.length > 0) {
    return fitting.reduce((best, note) => (note.length > best.length ? note : best));
  }

  // Every draft overflowed. Trim the shortest — it loses the least.
  const shortest = cleaned.reduce((best, note) => (note.length < best.length ? note : best));
  return trimToLimit(shortest);
}

/**
 * Last-resort trim for a draft that overflowed the cap.
 *
 * Cuts at a sentence boundary where one is available, so the note still reads
 * as finished rather than stopping mid-thought, and falls back to a word
 * boundary only when the first sentence alone already fills the note. The
 * floor keeps either fallback from returning a stub.
 */
function trimToLimit(note: string): string {
  if (note.length <= MAX_CONNECT_MESSAGE_CHARS) return note;

  const hardCut = note.slice(0, MAX_CONNECT_MESSAGE_CHARS);
  const MIN_USEFUL = 150;

  // A terminator at the very end has no trailing space to search for, so test
  // for it separately before looking for mid-string sentence breaks.
  if (/[.!?]$/.test(hardCut)) return hardCut.trim();

  const lastStop = Math.max(
    hardCut.lastIndexOf(". "),
    hardCut.lastIndexOf("? "),
    hardCut.lastIndexOf("! ")
  );
  if (lastStop >= MIN_USEFUL) return hardCut.slice(0, lastStop + 1).trim();

  const lastSpace = hardCut.lastIndexOf(" ");
  return (lastSpace > MIN_USEFUL ? hardCut.slice(0, lastSpace) : hardCut).trim();
}

/**
 * Drafts a LinkedIn connection-request note (max 300 chars) introducing the
 * candidate to a contact tied to a specific application, grounded in the
 * posting, the candidate's resume, the application's status, and any notes.
 *
 * The note is deliberately short: research on connection requests shows notes
 * of ~120–180 chars outperform ones that fill the whole 300. It is also
 * deliberately direct — it names the role, states where the application stands,
 * and asks outright for the thing that helps (usually: look at the
 * application). Softer closes tested better on raw acceptance rate, but they
 * leave the reader nothing to act on, and getting the application read is the
 * point of sending the note at all.
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

  const { notes } = await generateStructured<{ notes: string[] }>({
    system: [
      "You ghost-write LinkedIn connection-request notes for a job candidate reaching out to someone at a company they are applying to. The note has one job: get this person to accept the request and actually look at the candidate's application. Write the note that does that, and say what the candidate wants in plain words.",
      `This candidate is targeting ${label} roles. Write the note the way it lands in that field:\n${guidance}`,
      `Return exactly ${DRAFT_COUNT} separate drafts, each a complete note on its own. Vary the opening line and the wording between them — do not return the same note three times, and never split one note across the drafts.`,
      "Length (this is the constraint drafts fail most often):",
      "- Write each note as 30–45 words. Never exceed 50 words or 300 characters including spaces — LinkedIn rejects the note above 300, and shorter notes get accepted more often.",
      "- One paragraph. No line breaks, no bullet points, no sign-off line — LinkedIn already shows the candidate's name.",
      "Voice — this is what most drafts get wrong:",
      "- Write the way a real person types to another person: short sentences, contractions, one idea per sentence. Read it back and cut any word that isn't doing work.",
      "- Be direct. Say why they're writing in the first sentence and make the ask outright in the last one. Never hint at the ask or bury it in pleasantries.",
      "- NEVER use any of these, in any variation: 'I hope this message finds you well', 'I hope you're doing well', 'I came across', 'I wanted to reach out', 'reaching out regarding', 'I'd love to connect', 'I'm passionate about', 'excited about the opportunity', 'I believe my background aligns', 'your insight would be invaluable', 'thank you for your time and consideration'.",
      "- No em dashes, no semicolons, no exclamation marks, no emoji, and none of 'dynamic', 'innovative', 'cutting-edge', 'leading', 'thrilled', 'delighted'.",
      "- Do not describe back to them what their own company or team does. They work there.",
      "- Do not flatter the contact or open by praising their career.",
      "Hard rules:",
      "- Write in the first person as the candidate. Open with the contact's first name only, no 'Dear' and no title.",
      "- Name the specific role and company once, and make the ask the one the application status calls for — follow that status guidance strictly.",
      "- Include exactly one concrete credibility detail from the resume, stated flatly with no adjectives. If the resume is missing or thin, leave it out entirely rather than padding with generic claims.",
      "- Ground every claim about the candidate's background only in their resume; never invent employers, titles, metrics, or shared history. If a personalizing detail would help but isn't in the materials, leave it out rather than fabricating it.",
      "- Return plain text with no surrounding quotes, no subject line, and no '[bracketed placeholders]'.",
    ].join("\n"),
    prompt: `Write the ${DRAFT_COUNT} LinkedIn connection-request note drafts.\n\n${sections.join("\n\n")}`,
    schema: MESSAGE_SCHEMA,
    // The cheapest call in the app: a 300-character note from rules this
    // explicit doesn't need Sonnet, and doesn't need to reason first either.
    model: HAIKU,
    reasoning: "off",
    maxTokens: 2000,
  });

  // Definitive enforcement of the cap: the prompt asks for a word budget the
  // model can hold to, but only this guarantees what reaches the DB fits.
  return pickNote(Array.isArray(notes) ? notes : []);
}
