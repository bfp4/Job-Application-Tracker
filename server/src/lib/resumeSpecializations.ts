import type { ResumeSpecialization } from "@prisma/client";

/**
 * Per-field guidance injected into the tailored-resume prompt. The keys are the
 * ResumeSpecialization enum values (KEEP IN SYNC with schema.prisma). `label`
 * is what the Settings dropdown shows; `guidance` is appended to the system
 * prompt so the rewrite follows the conventions of that field.
 *
 * Guidance is grounded in current (2026) resume best practices — see the
 * research notes in the PR description. It never licenses inventing facts; it
 * only steers emphasis, ordering, and wording of the candidate's real content.
 */
export interface Specialization {
  label: string;
  guidance: string;
}

export const SPECIALIZATIONS: Record<ResumeSpecialization, Specialization> = {
  GENERAL: {
    label: "General",
    guidance:
      "Lead every bullet with a strong, varied action verb and pair it with a concrete result or metric. Cut filler like \"responsible for\". Keep the most relevant experience to this posting at the top.",
  },
  SOFTWARE_ENGINEERING: {
    label: "Software Engineering",
    guidance:
      "Foreground the exact technologies from the candidate's resume that match the posting (languages, frameworks, cloud, tools) — use precise names, not vague phrases. Prefer bullets with engineering-impact metrics already in the resume (latency, scale, throughput, users, %, uptime, cost). Use verbs like architected, built, shipped, automated, optimized. Keep any GitHub/portfolio links from the resume in the contact line. A tight, real skills list beats a long one.",
  },
  FINANCE: {
    label: "Finance & Banking",
    guidance:
      "Emphasize deal/transaction experience and financial impact using the candidate's real figures ($ amounts, returns, AUM, cost savings). Surface finance keywords that genuinely appear in their background (valuation, DCF, LBO, comparables, due diligence, modeling, forecasting). Keep formatting conservative and precise. For candidates with real work experience, order Experience above Education.",
  },
  CONSULTING: {
    label: "Consulting",
    guidance:
      "Frame bullets around problem → action → quantified outcome, showing structured problem-solving, client/stakeholder impact, and leadership across teams. Highlight breadth of domains the candidate has actually worked in. Emphasize measurable business results (revenue, cost, efficiency) drawn from the resume.",
  },
  MARKETING: {
    label: "Marketing",
    guidance:
      "Lead with campaign and growth metrics the candidate actually achieved: ROI, CAC, conversion rate, engagement, reach, budget managed, revenue influenced. Name the channels and tools they've used (SEO, paid social, email, analytics platforms). Keep results-first phrasing.",
  },
  SALES: {
    label: "Sales",
    guidance:
      "Put quantified sales performance first: quota attainment %, revenue/bookings generated, deals closed, pipeline built, and any ranking (e.g. top 5%). Use the candidate's real numbers and name the segments, deal sizes, and sales tools they've worked with.",
  },
  HEALTHCARE: {
    label: "Healthcare & Nursing",
    guidance:
      "Make licensure and certifications prominent and near the top (only those stated in the resume). Highlight clinical specialties, care settings, patient load/acuity, and any quality, safety, or outcome improvements. Keep language precise and credential-accurate.",
  },
  DESIGN: {
    label: "Design & Creative",
    guidance:
      "Keep the layout clean and ATS-parseable (no reliance on visual flourishes). Name the design tools the candidate uses (Figma, Adobe Creative Suite, etc.), surface notable clients/brands/projects, and keep any portfolio link in the contact line. Frame bullets around the impact of the design work (engagement, adoption, conversion) where the resume provides it.",
  },
  DATA_ANALYTICS: {
    label: "Data & Analytics",
    guidance:
      "Foreground analytical tools and methods from the resume (SQL, Python/R, dashboards, experimentation, ML where real) and tie them to business outcomes the candidate drove (decisions influenced, revenue, cost, efficiency, accuracy). Lead with the impact of the analysis, not just the technique.",
  },
};

const DEFAULT_SPECIALIZATION: ResumeSpecialization = "GENERAL";

/** All specialization values (for enum validation on the settings route). */
export const SPECIALIZATION_VALUES = Object.keys(
  SPECIALIZATIONS
) as ResumeSpecialization[];

export function isResumeSpecialization(
  value: unknown
): value is ResumeSpecialization {
  return (
    typeof value === "string" &&
    (SPECIALIZATION_VALUES as readonly string[]).includes(value)
  );
}

/** The guidance for a specialization, falling back to GENERAL if unknown. */
export function specializationGuidance(
  value: ResumeSpecialization | null | undefined
): Specialization {
  return SPECIALIZATIONS[value ?? DEFAULT_SPECIALIZATION] ?? SPECIALIZATIONS[DEFAULT_SPECIALIZATION];
}
