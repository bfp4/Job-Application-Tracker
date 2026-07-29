import type { CareerSpecialization } from "@prisma/client";
import {
  CAREER_SPECIALIZATION_LABELS,
  resolveCareerSpecialization,
} from "./careerSpecializations";

/**
 * One specialization-specific section of the resume-tips output.
 *
 * The generic advice (summary, gaps, bullet rewrites, strengths) is the same
 * for everyone, but "what should I go learn / what should I show" is not:
 * telling a nurse to study technologies is noise. Each field therefore gets
 * two focus sections of its own — one about what to *build or obtain*, one
 * about what the candidate already has and should *evidence better*.
 *
 * `key` is the JSON key in the stored analysis, so it is part of the
 * persisted contract: KEEP IN SYNC with ResumeTipsFocusKey /
 * RESUME_TIPS_FOCUS_LABELS in the client (client/src/lib/types.ts and
 * client/src/lib/resumeTipsFocus.ts). Never rename a key that has already
 * shipped — old analyses are stored JSON and would stop rendering.
 */
export interface ResumeTipsFocusField {
  /** JSON key in the structured output and the stored analysis. */
  key: string;
  /** Heading the client renders. KEEP IN SYNC with the client label map. */
  label: string;
  /** Tells the model what belongs in this array. */
  description: string;
}

interface ResumeTipsSpecializationSpec {
  /** How the tips themselves should be written for this field. */
  guidance: string;
  /** Exactly two focus sections: what to build/obtain, what to evidence. */
  focusFields: [ResumeTipsFocusField, ResumeTipsFocusField];
}

/**
 * Per-field resume-tips configuration, keyed by Career Specialization and
 * grounded in current (2026) hiring practice for each field — see the research
 * notes in the PR description. Guidance steers emphasis only; the service's
 * system prompt still forbids inventing anything the resume doesn't state.
 */
const RESUME_TIPS_SPECIALIZATIONS: Record<
  CareerSpecialization,
  ResumeTipsSpecializationSpec
> = {
  GENERAL: {
    guidance:
      "Judge the resume the way a generalist recruiter would: does each bullet lead with an action verb and land on a concrete result, is the most relevant experience on top, and is the language free of filler like \"responsible for\"?",
    focusFields: [
      {
        key: "skillsToDevelop",
        label: "Skills to develop",
        description:
          "The skills, tools, or knowledge areas this posting asks for that the candidate should build or deepen, most important first.",
      },
      {
        key: "achievementsToQuantify",
        label: "Achievements to quantify",
        description:
          "Real accomplishments already on the resume that are stated without a number, and the specific metric the candidate should attach to each.",
      },
    ],
  },
  SOFTWARE_ENGINEERING: {
    guidance:
      "Judge the resume the way an engineering hiring manager would: precise technology names over vague phrases, evidence of scope and system-level thinking, and bullets that state what happened because of the work (latency, throughput, users, uptime, cost) rather than what the task was.",
    focusFields: [
      {
        key: "technologiesToStudy",
        label: "Technologies to study",
        description:
          "The most important technologies or skills from the posting the candidate should study or deepen, most important first.",
      },
      {
        key: "systemsToShowcase",
        label: "Systems and projects to showcase",
        description:
          "Systems, projects, or open-source work already on the resume that deserve more scale and architecture detail (traffic, data volume, users, uptime, cost, team size) — or, if the resume shows none, the kind of project worth building for this posting.",
      },
    ],
  },
  FINANCE: {
    guidance:
      "Judge the resume the way a banking or investment recruiter would: credentials and technical toolkit first, then deal and transaction exposure with real figures and the candidate's specific role in each. Keep advice conservative and precise — no hyperbole.",
    focusFields: [
      {
        key: "credentialsAndSkillsToBuild",
        label: "Credentials and technical skills to build",
        description:
          "Certifications (CFA, CPA, FRM, Series licenses) and technical skills (DCF, LBO, comparable company and precedent transaction analysis, advanced Excel, Bloomberg, Capital IQ, FactSet, PitchBook) this posting expects that the resume does not yet evidence.",
      },
      {
        key: "transactionsToDetail",
        label: "Deals and transactions to detail",
        description:
          "Deals, transactions, portfolios, or analyses already on the resume that need their size, the candidate's specific role, and the outcome spelled out in dollars.",
      },
    ],
  },
  CONSULTING: {
    guidance:
      "Judge the resume the way a consulting screener would: every bullet leads with impact rather than responsibility, carries a number, and shows structured problem-solving or influence without authority. Formatting must be conservative and client-ready.",
    focusFields: [
      {
        key: "capabilitiesToBuild",
        label: "Capabilities to build",
        description:
          "Consulting capabilities, industry or functional knowledge, and analytical methods this posting calls for that the resume does not yet evidence.",
      },
      {
        key: "engagementsToReframe",
        label: "Engagements to reframe as case stories",
        description:
          "Projects already on the resume that should be rewritten as problem → structured approach → quantified business outcome, naming the client or stakeholder and the number that resulted.",
      },
    ],
  },
  MARKETING: {
    guidance:
      "Judge the resume the way a marketing hiring manager would: funnel outcomes over activity lists, named channels and platforms, and evidence that the candidate can explain why they chose an approach — not just that they ran a campaign.",
    focusFields: [
      {
        key: "channelsAndToolsToLearn",
        label: "Channels and tools to learn",
        description:
          "Channels, platforms, and certifications this posting expects (SEO/SEM, demand generation, lifecycle email, paid social, marketing automation, GA4, HubSpot, Marketo, Meta Blueprint) that the resume does not evidence.",
      },
      {
        key: "campaignsToQuantify",
        label: "Campaigns to quantify",
        description:
          "Campaigns or programs on the resume that need their funnel metrics attached — reach, CTR, conversion rate, CAC, ROAS, pipeline or revenue influenced, budget managed — along with the reasoning behind the channel choice.",
      },
    ],
  },
  SALES: {
    guidance:
      "Judge the resume the way a sales leader scanning for seven seconds would: quota attainment, revenue closed, and the sales stack should be visible immediately, and every claim should be a number rather than an adjective.",
    focusFields: [
      {
        key: "skillsAndToolsToSharpen",
        label: "Sales skills and tools to sharpen",
        description:
          "Sales methodologies (MEDDIC, Challenger, SPIN, Sandler), CRM and sales-stack tools (Salesforce, HubSpot, Outreach, Gong, ZoomInfo, Sales Navigator), or segment and product knowledge this posting expects that the resume does not show.",
      },
      {
        key: "numbersToProve",
        label: "Numbers to prove",
        description:
          "Performance numbers the resume omits or leaves vague — quota size and attainment percentage, revenue or bookings closed, average deal size, win rate, new logos, pipeline built, ranking against the team.",
      },
    ],
  },
  HEALTHCARE: {
    guidance:
      "Judge the resume the way a clinical recruiter would: licensure and certifications must be findable in seconds and stated exactly, and experience must be clinically specific — setting, acuity, ratios, and patient outcomes rather than duties. Never suggest claiming a credential the resume doesn't state.",
    focusFields: [
      {
        key: "certificationsToPursue",
        label: "Licenses and certifications to pursue",
        description:
          "Licenses and certifications this posting requires or prefers (state or compact licensure, BLS, ACLS, PALS, specialty certifications) that the resume does not list, noting the issuing body — and flag any listed credential missing an expiration date.",
      },
      {
        key: "clinicalDetailsToAdd",
        label: "Clinical details to add",
        description:
          "Clinical specifics the resume leaves out — care setting and unit type, bed count or trauma level, patient ratios and acuity, EHR systems (Epic, Cerner, Meditech), and any quality, safety, or patient-outcome improvement.",
      },
    ],
  },
  DESIGN: {
    guidance:
      "Judge the resume the way a design hiring manager would: the portfolio is the primary artifact and the resume is its index, so reviewers look for evidence of process and outcomes — the user problem, the research, the iteration, the constraints — not only finished visuals. Keep the layout ATS-parseable.",
    focusFields: [
      {
        key: "toolsAndSkillsToDevelop",
        label: "Tools and craft to develop",
        description:
          "Design tools, methods, and craft areas this posting calls for (Figma, design systems, prototyping, user research, accessibility, motion, front-end literacy) that the resume does not evidence.",
      },
      {
        key: "portfolioWorkToShow",
        label: "Portfolio work to show",
        description:
          "What this posting's reviewer will want from the portfolio: which projects to lead with, and where the resume's work needs its user problem, research, iteration, constraints, and measured outcome made explicit.",
      },
    ],
  },
  DATA_ANALYTICS: {
    guidance:
      "Judge the resume the way a data hiring manager would: the technical stack should be visible near the top, and every analysis should end in a decision or business outcome rather than a technique. A linked portfolio or GitHub with a few well-explained projects counts for more than a long tool list.",
    focusFields: [
      {
        key: "toolsAndMethodsToLearn",
        label: "Tools and methods to learn",
        description:
          "Tools and analytical methods this posting expects (SQL, Python or R libraries, dbt, Airflow, Snowflake or BigQuery, Tableau or Power BI, A/B testing, statistical or ML methods) that the resume does not evidence.",
      },
      {
        key: "analysesToShowcase",
        label: "Analyses and dashboards to showcase",
        description:
          "Analyses, dashboards, models, or portfolio and GitHub projects on the resume that should state the question asked, the data and method used, and the decision or business outcome that followed.",
      },
    ],
  },
};

export interface ResumeTipsSpecialization extends ResumeTipsSpecializationSpec {
  label: string;
}

/** The resume-tips configuration for a field, falling back to General. */
export function resumeTipsSpecialization(
  value: CareerSpecialization | null | undefined
): ResumeTipsSpecialization {
  const key = resolveCareerSpecialization(value);
  return { label: CAREER_SPECIALIZATION_LABELS[key], ...RESUME_TIPS_SPECIALIZATIONS[key] };
}

/** Every focus key any specialization can emit — used by tests and tooling. */
export const ALL_RESUME_TIPS_FOCUS_FIELDS: ResumeTipsFocusField[] = Object.values(
  RESUME_TIPS_SPECIALIZATIONS
).flatMap((spec) => spec.focusFields);
