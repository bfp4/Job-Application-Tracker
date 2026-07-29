import type { CareerSpecialization } from "@prisma/client";
import {
  CAREER_SPECIALIZATION_LABELS,
  resolveCareerSpecialization,
} from "./careerSpecializations";

/**
 * Per-field guidance injected into the tailored-resume prompt, keyed by the
 * user's Career Specialization. Labels live in careerSpecializations.ts; this
 * module only says how a resume for that field should read.
 *
 * Guidance is grounded in current (2026) resume best practices — see the
 * research notes in the PR description. It never licenses inventing facts; it
 * only steers emphasis, ordering, and wording of the candidate's real content.
 */
export const TAILORED_RESUME_GUIDANCE: Record<CareerSpecialization, string> = {
  GENERAL:
    "Lead every bullet with a strong, varied action verb and pair it with a concrete result or metric. Cut filler like \"responsible for\". Keep the most relevant experience to this posting at the top.",
  SOFTWARE_ENGINEERING:
    "Foreground the exact technologies from the candidate's resume that match the posting (languages, frameworks, cloud, tools) — use precise names, not vague phrases. Prefer bullets with engineering-impact metrics already in the resume (latency, scale, throughput, users, %, uptime, cost). Use verbs like architected, built, shipped, automated, optimized. Keep any GitHub/portfolio links from the resume in the contact line. A tight, real skills list beats a long one.",
  FINANCE:
    "Emphasize deal/transaction experience and financial impact using the candidate's real figures ($ amounts, returns, AUM, cost savings). Surface finance keywords that genuinely appear in their background (valuation, DCF, LBO, comparables, due diligence, modeling, forecasting). Keep formatting conservative and precise. For candidates with real work experience, order Experience above Education.",
  CONSULTING:
    "Frame bullets around problem → action → quantified outcome, showing structured problem-solving, client/stakeholder impact, and leadership across teams. Highlight breadth of domains the candidate has actually worked in. Emphasize measurable business results (revenue, cost, efficiency) drawn from the resume.",
  MARKETING:
    "Lead with campaign and growth metrics the candidate actually achieved: ROI, CAC, conversion rate, engagement, reach, budget managed, revenue influenced. Name the channels and tools they've used (SEO, paid social, email, analytics platforms). Keep results-first phrasing.",
  SALES:
    "Put quantified sales performance first: quota attainment %, revenue/bookings generated, deals closed, pipeline built, and any ranking (e.g. top 5%). Use the candidate's real numbers and name the segments, deal sizes, and sales tools they've worked with.",
  HEALTHCARE:
    "Make licensure and certifications prominent and near the top (only those stated in the resume). Highlight clinical specialties, care settings, patient load/acuity, and any quality, safety, or outcome improvements. Keep language precise and credential-accurate.",
  DESIGN:
    "Keep the layout clean and ATS-parseable (no reliance on visual flourishes). Name the design tools the candidate uses (Figma, Adobe Creative Suite, etc.), surface notable clients/brands/projects, and keep any portfolio link in the contact line. Frame bullets around the impact of the design work (engagement, adoption, conversion) where the resume provides it.",
  DATA_ANALYTICS:
    "Foreground analytical tools and methods from the resume (SQL, Python/R, dashboards, experimentation, ML where real) and tie them to business outcomes the candidate drove (decisions influenced, revenue, cost, efficiency, accuracy). Lead with the impact of the analysis, not just the technique.",
};

export interface TailoredResumeSpecialization {
  label: string;
  guidance: string;
}

/** The tailored-resume guidance for a field, falling back to General. */
export function specializationGuidance(
  value: CareerSpecialization | null | undefined
): TailoredResumeSpecialization {
  const key = resolveCareerSpecialization(value);
  return {
    label: CAREER_SPECIALIZATION_LABELS[key],
    guidance: TAILORED_RESUME_GUIDANCE[key],
  };
}
