import type { ResumeSpecialization } from "@prisma/client";

/**
 * Per-field guidance injected into the cover-letter prompt. Keyed by the same
 * ResumeSpecialization enum the tailored resume uses (the user picks one field
 * in Settings and both features follow it) — KEEP IN SYNC with schema.prisma
 * and SPECIALIZATIONS in resumeSpecializations.ts.
 *
 * Grounded in current (2026) cover-letter practice — see the research notes in
 * the PR description. Two findings shape every entry: hiring managers want the
 * letter to *support* the resume rather than restate it, and they penalize
 * letters that read as generic or machine-written. So the guidance steers what
 * to foreground per field; it never licenses inventing facts.
 */
export interface CoverLetterSpecialization {
  /** Matches the Settings dropdown label for the same enum value. */
  label: string;
  guidance: string;
}

export const COVER_LETTER_SPECIALIZATIONS: Record<
  ResumeSpecialization,
  CoverLetterSpecialization
> = {
  GENERAL: {
    label: "General",
    guidance:
      "Lead with what the candidate can do for this employer, not what they want from the job. Pick the two or three experiences that map most directly onto the posting's stated needs and explain why they matter — the resume already lists them, so the letter's job is to connect them to this role. Use plain, specific language over adjectives.",
  },
  SOFTWARE_ENGINEERING: {
    label: "Software Engineering",
    guidance:
      "Name the exact languages, frameworks, and infrastructure that overlap between the resume and the posting — precise names, not \"modern web technologies\". Build the evidence paragraph around one system the candidate actually built or scaled, including the engineering metric attached to it in the resume (latency, throughput, users, uptime, cost). Mention collaboration or ownership scope where the resume shows it, and reference a GitHub or portfolio link only if one appears in the resume.",
  },
  FINANCE: {
    label: "Finance & Banking",
    guidance:
      "Open with the candidate's real credentials and deal or transaction exposure. Anchor the evidence paragraph in figures the resume already states ($ amounts, AUM, returns, cost savings) and in named technical work (valuation, modeling, forecasting, due diligence). Keep the tone conservative and precise — no hyperbole — and mention regulatory, compliance, or controls experience where the resume supports it.",
  },
  CONSULTING: {
    label: "Consulting",
    guidance:
      "Structure the evidence paragraph as problem → approach → quantified outcome, which is how consulting readers evaluate a story. Show structured thinking and client or stakeholder impact rather than task lists, and use the breadth of industries or functions the candidate has actually worked across as the argument for fit. Close on measurable business results drawn from the resume.",
  },
  MARKETING: {
    label: "Marketing",
    guidance:
      "Lead with campaign and growth outcomes the candidate actually delivered — ROI, CAC, conversion rate, engagement, reach, budget managed, revenue influenced — and pair each percentage with the absolute number or the business result behind it. Name the channels and platforms they've worked in when the posting names them too. Show a point of view about the employer's market or audience, drawn from the posting.",
  },
  SALES: {
    label: "Sales",
    guidance:
      "Put quantified performance in the first two sentences: quota attainment, revenue or bookings generated, deals closed, pipeline built, ranking. Then explain the method behind one of those numbers — the territory, segment, deal size, or sales motion — because the number alone reads as a resume line. Match the letter to the employer's customer and deal profile as described in the posting. Confident, direct, no filler.",
  },
  HEALTHCARE: {
    label: "Healthcare & Nursing",
    guidance:
      "State licensure and credentials in the opening line exactly as the resume lists them (e.g. RN, BSN, and any compact-state licensure) — recruiters screen on this first. Make the evidence paragraph clinically specific: patient population, care setting, acuity or caseload, and any quality, safety, or outcome improvement the resume records. Reference something concrete about this employer from the posting (service line, unit, residency program, Magnet status) rather than praising the organization generically.",
  },
  DESIGN: {
    label: "Design & Creative",
    guidance:
      "Point to the portfolio early if the resume includes a link — it is the primary artifact and the letter is the frame around it. Name the tools and the notable clients, brands, or products the candidate has actually worked on, and describe the impact of the design work (adoption, engagement, conversion, or the problem it solved) rather than only its aesthetics. Show craft in the writing itself, but keep the letter plain-text-friendly.",
  },
  DATA_ANALYTICS: {
    label: "Data & Analytics",
    guidance:
      "Show both halves of the job: technical execution and the decision it drove. Name the tools and methods that overlap with the posting (SQL, Python/R, warehouses, BI tools, experimentation, ML where genuinely real) and tie one of them to a concrete outcome the resume states — a decision changed, revenue moved, cost or error rate reduced. Mention dashboards, stakeholder reporting, or written analysis explicitly where the resume shows them, and include a GitHub or portfolio link only if the resume has one.",
  },
};

const DEFAULT_SPECIALIZATION: ResumeSpecialization = "GENERAL";

/** The cover-letter guidance for a field, falling back to GENERAL if unknown. */
export function coverLetterGuidance(
  value: ResumeSpecialization | null | undefined
): CoverLetterSpecialization {
  return (
    COVER_LETTER_SPECIALIZATIONS[value ?? DEFAULT_SPECIALIZATION] ??
    COVER_LETTER_SPECIALIZATIONS[DEFAULT_SPECIALIZATION]
  );
}
