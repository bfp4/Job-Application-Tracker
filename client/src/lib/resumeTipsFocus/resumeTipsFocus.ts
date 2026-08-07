import type { ResumeTipsContent, ResumeTipsFocusItem, ResumeTipsFocusKey } from "../types";

/**
 * Headings for the specialization-specific resume-tips sections.
 *
 * A stored analysis carries only the two focus keys its specialization
 * defined, and the client can't know which specialization produced an old
 * analysis — so the renderer walks this map and shows whichever keys are
 * actually present. That also means analyses generated before a user switched
 * fields keep rendering correctly.
 *
 * KEEP IN SYNC with the focus fields in
 * server/src/lib/resumeTipsSpecializations.ts (both the keys and the labels).
 * Declaration order is render order.
 */
export const RESUME_TIPS_FOCUS_LABELS: Record<ResumeTipsFocusKey, string> = {
  // General
  skillsToDevelop: "Skills to develop",
  achievementsToQuantify: "Achievements to quantify",
  // Software Engineering
  technologiesToStudy: "Technologies to study",
  systemsToShowcase: "Systems and projects to showcase",
  // Finance & Banking
  credentialsAndSkillsToBuild: "Credentials and technical skills to build",
  transactionsToDetail: "Deals and transactions to detail",
  // Consulting
  capabilitiesToBuild: "Capabilities to build",
  engagementsToReframe: "Engagements to reframe as case stories",
  // Marketing
  channelsAndToolsToLearn: "Channels and tools to learn",
  campaignsToQuantify: "Campaigns to quantify",
  // Sales
  skillsAndToolsToSharpen: "Sales skills and tools to sharpen",
  numbersToProve: "Numbers to prove",
  // Healthcare & Nursing
  certificationsToPursue: "Licenses and certifications to pursue",
  clinicalDetailsToAdd: "Clinical details to add",
  // Design & Creative
  toolsAndSkillsToDevelop: "Tools and craft to develop",
  portfolioWorkToShow: "Portfolio work to show",
  // Data & Analytics
  toolsAndMethodsToLearn: "Tools and methods to learn",
  analysesToShowcase: "Analyses and dashboards to showcase",
};

export interface ResumeTipsFocusSection {
  key: ResumeTipsFocusKey;
  title: string;
  items: ResumeTipsFocusItem[];
}

/** The non-empty focus sections in this analysis, in render order. */
export function focusSections(content: ResumeTipsContent): ResumeTipsFocusSection[] {
  return (Object.keys(RESUME_TIPS_FOCUS_LABELS) as ResumeTipsFocusKey[])
    .map((key) => ({ key, title: RESUME_TIPS_FOCUS_LABELS[key], items: content[key] ?? [] }))
    .filter((section) => section.items.length > 0);
}
