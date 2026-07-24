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
  website: string | null;
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
  matchScore: number | null;
  matchReasons: string[];
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
}

export interface BaseResume {
  id: string;
  userId: string;
  pdfS3Key: string | null;
  createdAt: string;
}

/** The field a user's tailored resumes are specialized for (enum value). */
export type ResumeSpecialization =
  | "GENERAL"
  | "SOFTWARE_ENGINEERING"
  | "FINANCE"
  | "CONSULTING"
  | "MARKETING"
  | "SALES"
  | "HEALTHCARE"
  | "DESIGN"
  | "DATA_ANALYTICS";

/** A user's editable settings, from GET/PATCH /api/user/me. */
export interface UserSettings {
  id: string;
  email: string;
  resumeSpecialization: ResumeSpecialization;
}

/** A specialization choice for the Settings dropdown (server-provided). */
export interface SpecializationOption {
  value: ResumeSpecialization;
  label: string;
}

/**
 * The structured advice produced by the resume-tips agent.
 * KEEP IN SYNC with the ResumeTipsContent interface and RESUME_TIPS_SCHEMA in
 * server/src/services/resumeTips.ts — the content arrives as opaque stored
 * JSON, so drift silently renders empty sections here.
 */
export interface ResumeTipsContent {
  summary: string;
  technologiesToStudy: { name: string; reason: string }[];
  missingFromResume: string[];
  bulletPointSuggestions: {
    current: string | null;
    suggested: string;
    reason: string;
  }[];
  strengthsToHighlight: string[];
  additionalTips: string[];
}

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

/** A follow-up joined with its parent application, used on the dashboard. */
export interface FollowUpWithApplication extends FollowUp {
  application: Application;
}
