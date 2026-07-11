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

export interface FollowUp {
  id: string;
  applicationId: string;
  followUpDate: string;
  note: string | null;
  completed: boolean;
}

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

/** A follow-up joined with its parent application, used on the dashboard. */
export interface FollowUpWithApplication extends FollowUp {
  application: Application;
}
