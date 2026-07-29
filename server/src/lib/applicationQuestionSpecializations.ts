import type { CareerSpecialization } from "@prisma/client";
import {
  CAREER_SPECIALIZATION_LABELS,
  resolveCareerSpecialization,
} from "./careerSpecializations";

/**
 * Per-field guidance for drafting answers to application-form questions, keyed
 * by the user's Career Specialization. Labels live in careerSpecializations.ts.
 *
 * What makes an answer good is field-dependent: a consulting reviewer wants the
 * answer first and a structure under it, a nurse manager wants patient safety
 * and the outcome, a designer's reviewer wants the case-study arc. This
 * guidance sets that shape and register; the service's system prompt still
 * forbids inventing anything the candidate's materials don't contain.
 */
export const APPLICATION_QUESTION_GUIDANCE: Record<CareerSpecialization, string> = {
  GENERAL:
    "For experience questions use a compact STAR arc — situation, what the candidate did, and the result with its number. For motivation questions, tie a real detail from the posting to something the candidate has actually done. Plain, specific language throughout.",
  SOFTWARE_ENGINEERING:
    "Answer with one concrete system or project rather than a survey of everything the candidate has touched. Name the technologies precisely, state the constraint or trade-off that made the work hard, and end on the measurable effect (latency, scale, users, reliability, cost). Mention collaboration — code review, on-call, working with product — where the resume supports it. Avoid buzzword stacking; engineers reading the answer discount it.",
  FINANCE:
    "Precise, measured, and conservative in tone. Ground the answer in a specific transaction, model, or analysis with the figures the resume already states, and make the candidate's own role in it unambiguous. Show attention to detail, and mention diligence, controls, compliance, or ethical judgment where the question invites it. No hyperbole, no superlatives.",
  CONSULTING:
    "Lead with the answer, then support it — top-down, the way a consulting deliverable reads. Structure the body explicitly (problem, the approach the candidate took, the quantified result), keep it MECE rather than a list of tasks, and show influence across stakeholders. Every claim of impact needs a number attached.",
  MARKETING:
    "Give the outcome and the reasoning behind it: which audience or channel the candidate chose, why they chose it, and what the funnel metrics did (reach, conversion, CAC, ROAS, pipeline or revenue influenced). Show a point of view about this employer's market or customer drawn from the posting rather than generic enthusiasm.",
  SALES:
    "Direct and numbers-forward. Open with the result — quota attainment, revenue closed, deal size, or ranking — then explain the method behind it: the territory or segment, how the candidate sourced and qualified, and how they handled the objection or the loss. Confident without being boastful, and specific about the customer profile the posting describes.",
  HEALTHCARE:
    "Use a clear STAR arc and lead with patient safety and the patient outcome, not the task. Be clinically specific — setting, acuity, ratios or caseload — and quantify where the resume allows. Show escalation, advocacy, and multidisciplinary teamwork, and keep every credential exactly as the resume states it. Never include identifiable patient details.",
  DESIGN:
    "Shape the answer like a short case study: the user problem, what the research or evidence showed, how the candidate iterated, the constraints they worked within, and the measured impact (adoption, engagement, task success, conversion). Naming what they could not do and why reads as senior. Show collaboration with engineering and product, and reference the portfolio only if the resume links one.",
  DATA_ANALYTICS:
    "Structure the answer as question → data and method → insight → the decision it changed. Name the tools and techniques precisely, be honest about data quality limits and assumptions, and end on the business outcome rather than the model metric. Show how the candidate communicated the result to non-technical stakeholders where the materials support it.",
};

export interface ApplicationQuestionSpecialization {
  label: string;
  guidance: string;
}

/** The application-answer guidance for a field, falling back to General. */
export function applicationQuestionGuidance(
  value: CareerSpecialization | null | undefined
): ApplicationQuestionSpecialization {
  const key = resolveCareerSpecialization(value);
  return {
    label: CAREER_SPECIALIZATION_LABELS[key],
    guidance: APPLICATION_QUESTION_GUIDANCE[key],
  };
}
