export type ApplicationStatus =
  | "NOT_APPLIED"
  | "APPLIED"
  | "PHONE_SCREEN"
  | "INTERVIEW"
  | "OFFER"
  | "REJECTED";

export interface Company {
  id: string;
  name: string;
}

export interface JobPosting {
  id: string;
  userId: string;
  companyId: string | null;
  title: string;
  description: string | null;
  location: string[];
  salary: string | null;
  jobUrl: string;
  postedDate: string | null;
  fetchedAt: string;
  company?: Company | null;
}

/**
 * Preview of a job posting pulled from a supported board (e.g. Ashby) by
 * `POST /api/jobs/scrape`. Used to prefill the add-job form; not persisted
 * until the user submits.
 */
export interface ScrapedPosting {
  title: string;
  companyName: string;
  location: string[];
  salary: string | null;
  description: string | null;
  jobUrl: string;
  postedDate: string | null;
}

export interface FollowUp {
  id: string;
  applicationId: string;
  followUpDate: string;
  note: string | null;
  completed: boolean;
}

/** Where the user stands in the LinkedIn networking flow with a contact. */
export type LinkedinStatus = "NONE" | "CONNECTION_SENT" | "CONNECTED" | "MESSAGING";

/** A person the user is in contact with about an application. */
export interface Contact {
  id: string;
  applicationId: string;
  name: string;
  position: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  linkedinStatus: LinkedinStatus;
  connectMessage: string | null;
  /**
   * Server-computed: the saved note still matches everything it was drafted
   * from (this contact, the application, the posting, the resume). The API
   * refuses a redraft in that state, so the UI disables the button.
   */
  connectMessageUpToDate: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One stage an application has occupied. Created automatically when its
 * status changes; editable (note/date) and addable by hand afterward.
 */
export interface TimelineEntry {
  id: string;
  applicationId: string;
  status: ApplicationStatus;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A question from the application form, with a (possibly AI-drafted) answer. */
export interface ApplicationQuestion {
  id: string;
  applicationId: string;
  question: string;
  answer: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  userId: string;
  jobPostingId: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  notes: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  jobPosting?: JobPosting;
  followUps?: FollowUp[];
  questions?: ApplicationQuestion[];
  contacts?: Contact[];
  timelineEntries?: TimelineEntry[];
}

export interface BaseResume {
  id: string;
  userId: string;
  pdfS3Key: string | null;
  createdAt: string;
}

/** The career field a user's AI output is specialized for (enum value). */
export type CareerSpecialization =
  | "GENERAL"
  | "SOFTWARE_ENGINEERING"
  | "FINANCE"
  | "CONSULTING"
  | "MARKETING"
  | "SALES"
  | "HEALTHCARE"
  | "DESIGN"
  | "DATA_ANALYTICS";

/** A user's access level. ADMIN is never settable through the API. */
export type UserTier = "BASIC" | "PREMIUM" | "ADMIN";

/** A user's editable settings, from GET/PATCH /api/user/me. */
export interface UserSettings {
  id: string;
  email: string;
  careerSpecialization: CareerSpecialization;
  tier: UserTier;
  aiCallsUsedToday: number;
  /** Only meaningful for BASIC — null for PREMIUM/ADMIN (unlimited). */
  aiCallsRemaining: number | null;
  pendingPremiumRequest: boolean;
  /** True once the user has turned the daily reminder digest off. */
  emailOptOut: boolean;
}

/** A specialization choice for the Settings dropdown (server-provided). */
export interface SpecializationOption {
  value: CareerSpecialization;
  label: string;
}

/**
 * A specialization-specific section of the resume tips — every field gets two
 * of them, under keys that depend on the user's Career Specialization.
 * KEEP IN SYNC with ResumeTipsFocusField in
 * server/src/lib/resumeTipsSpecializations.ts; the labels live in
 * client/src/lib/resumeTipsFocus.ts.
 */
export type ResumeTipsFocusKey =
  // GENERAL
  | "skillsToDevelop"
  | "achievementsToQuantify"
  // SOFTWARE_ENGINEERING
  | "technologiesToStudy"
  | "systemsToShowcase"
  // FINANCE
  | "credentialsAndSkillsToBuild"
  | "transactionsToDetail"
  // CONSULTING
  | "capabilitiesToBuild"
  | "engagementsToReframe"
  // MARKETING
  | "channelsAndToolsToLearn"
  | "campaignsToQuantify"
  // SALES
  | "skillsAndToolsToSharpen"
  | "numbersToProve"
  // HEALTHCARE
  | "certificationsToPursue"
  | "clinicalDetailsToAdd"
  // DESIGN
  | "toolsAndSkillsToDevelop"
  | "portfolioWorkToShow"
  // DATA_ANALYTICS
  | "toolsAndMethodsToLearn"
  | "analysesToShowcase";

export interface ResumeTipsFocusItem {
  name: string;
  reason: string;
}

/**
 * The structured advice produced by the resume-tips agent: fields every
 * analysis has, plus the two focus sections belonging to the specialization it
 * was generated for. The focus keys are optional because a stored analysis
 * only ever carries the pair its own specialization defined.
 *
 * KEEP IN SYNC with ResumeTipsContent / resumeTipsSchema in
 * server/src/services/resumeTips.ts — the content arrives as opaque stored
 * JSON, so drift silently renders empty sections here.
 */
export type ResumeTipsContent = {
  summary: string;
  missingFromResume: string[];
  bulletPointSuggestions: {
    current: string | null;
    suggested: string;
    reason: string;
  }[];
  strengthsToHighlight: string[];
  additionalTips: string[];
} & Partial<Record<ResumeTipsFocusKey, ResumeTipsFocusItem[]>>;

/** A saved resume-tips analysis for one application. */
export interface ResumeAnalysis {
  id: string;
  applicationId: string;
  baseResumeId: string;
  jobPostingHash: string;
  content: ResumeTipsContent;
  createdAt: string;
  updatedAt: string;
}

/**
 * A resume rewritten (rephrase/reorder only) to target one posting.
 * KEEP IN SYNC with TailoredResumeContent / TAILORED_RESUME_SCHEMA in
 * server/src/services/tailoredResume.ts and the renderer in
 * server/src/lib/resumeRender.ts — the content is opaque stored JSON.
 */
export interface TailoredResumeContent {
  header: { name: string; contact: string[] };
  summary: string | null;
  sections: {
    title: string;
    entries: {
      heading: string | null;
      bullets: { before: string | null; after: string }[];
    }[];
  }[];
  changeNote: string;
}

/** A saved tailored resume for one application. */
export interface TailoredResume {
  id: string;
  applicationId: string;
  baseResumeId: string;
  jobPostingHash: string;
  content: TailoredResumeContent;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A cover letter written for one posting from the user's base resume.
 * KEEP IN SYNC with CoverLetterContent / COVER_LETTER_SCHEMA in
 * server/src/services/coverLetter.ts and the renderer in
 * server/src/lib/coverLetterRender.ts — the content is opaque stored JSON.
 *
 * No date field by design: the PDF is stamped with the date it's downloaded.
 */
export interface CoverLetterContent {
  header: { name: string; contact: string[] };
  recipient: { name: string | null; title: string | null; company: string | null };
  greeting: string;
  paragraphs: string[];
  closing: string;
  signature: string;
  approachNote: string;
}

/** A saved cover letter for one application. */
export interface CoverLetter {
  id: string;
  applicationId: string;
  baseResumeId: string;
  jobPostingHash: string;
  content: CoverLetterContent;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A follow-up joined with its parent application, used on the dashboard. */
export interface FollowUpWithApplication extends FollowUp {
  application: Application;
}
