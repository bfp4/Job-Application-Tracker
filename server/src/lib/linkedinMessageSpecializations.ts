import type { CareerSpecialization } from "@prisma/client";
import {
  CAREER_SPECIALIZATION_LABELS,
  resolveCareerSpecialization,
} from "./careerSpecializations";

/**
 * Per-field guidance for the LinkedIn connection-request note, keyed by the
 * user's Career Specialization. Labels live in careerSpecializations.ts.
 *
 * The note is capped at 300 characters, so this guidance decides what the one
 * credibility detail and the one reason to connect should be for that field —
 * and how formal the register should be. Grounded in current (2026) outreach
 * practice: personalized notes that name a concrete, genuine reason are
 * accepted at roughly three times the rate of blank ones.
 *
 * This file sets register and subject matter only. The note's directness — a
 * stated ask rather than a hedged close — is fixed for every field in the
 * system prompt, so guidance here must not tell the model to soften or drop it.
 */
export const LINKEDIN_MESSAGE_GUIDANCE: Record<CareerSpecialization, string> = {
  GENERAL:
    "Give one concrete, genuine reason to connect drawn from the contact's role or the team's work, and one short credibility detail from the resume. Plain, warm, jargon-free.",
  SOFTWARE_ENGINEERING:
    "Anchor the note in the technical work: the product, the stack, or the engineering problem the team owns as the posting describes it. The credibility line should be one concrete thing the candidate built or scaled, named precisely (the system and its technology), not a list of languages. Peer-to-peer and low-key — engineers read hype as noise.",
  FINANCE:
    "Keep the register formal and conservative: full sentences, no exclamation marks, no emoji, no casual slang. The credibility line should be the candidate's credential or deal/coverage exposure exactly as the resume states it (designation, group, sector, transaction type). Discretion matters — never name deal specifics beyond what the resume already states publicly.",
  CONSULTING:
    "Write it the way a consultant writes an email: crisp, structured, and specific. Lead with the practice area, industry, or type of problem the contact works on, and make the credibility line one engagement or analysis with its result. Polished and professional, never chatty.",
  MARKETING:
    "Personalize on something the team's marketing actually does — the brand, the campaign, the channel, or the audience the posting describes. The credibility line should be one growth or campaign outcome from the resume. Warm and personable, but skip the growth-hacking jargon.",
  SALES:
    "Confident, direct, and human — a peer reaching out about a job, not a rep working a lead. Reference the segment, territory, or customer the team sells into, and use one performance number from the resume as the credibility line. Because this is a sales candidate, keep the note clear of anything that reads as prospecting: no value props, no calendar links, no multi-step close. The one ask is about the candidate's application, nothing else.",
  HEALTHCARE:
    "Warm, professional, and patient-centered. Open on the unit, specialty, or care setting the contact works in, and make the credibility line the candidate's licensure and clinical experience exactly as the resume states it (e.g. RN with ICU experience). Never imply a credential the resume doesn't list, and never include anything resembling patient information.",
  DESIGN:
    "Personalize on the product, brand, or design work the team is responsible for — designers notice whether you actually looked. The credibility line should be the candidate's most relevant work or, if the resume includes a portfolio link, a brief pointer to it. Friendly and human, and let the writing itself show some craft.",
  DATA_ANALYTICS:
    "Anchor the note in the data problem or domain the team works on as the posting describes it. The credibility line should be one analysis, model, or dashboard from the resume and the decision or outcome it drove — concrete and quantified over tool name-dropping.",
};

export interface LinkedinMessageSpecialization {
  label: string;
  guidance: string;
}

/** The connection-note guidance for a field, falling back to General. */
export function linkedinMessageGuidance(
  value: CareerSpecialization | null | undefined
): LinkedinMessageSpecialization {
  const key = resolveCareerSpecialization(value);
  return {
    label: CAREER_SPECIALIZATION_LABELS[key],
    guidance: LINKEDIN_MESSAGE_GUIDANCE[key],
  };
}
