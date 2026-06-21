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
  createdAt: string;
}

export interface JobPosting {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  location: string | null;
  jobUrl: string | null;
  source: string;
  externalId: string;
  postedDate: string | null;
  fetchedAt: string;
  company?: Company;
}

export interface Contact {
  id: string;
  companyId: string;
  userId: string;
  name: string;
  role: string | null;
  email: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

export interface FollowUp {
  id: string;
  applicationId: string;
  followUpDate: string;
  note: string | null;
  completed: boolean;
}

export interface Application {
  id: string;
  userId: string;
  jobPostingId: string;
  companyId: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  jobPosting?: JobPosting;
  company?: Company;
  contacts?: Contact[];
  followUps?: FollowUp[];
}

export interface JobSearchSummary {
  totalFetched: number;
  newJobs: number;
  existingJobs: number;
  bySource: Record<
    string,
    { fetched: number; newJobs: number; existingJobs: number }
  >;
}

export interface JobSearchPagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** A follow-up joined with its parent application, used on the dashboard. */
export interface FollowUpWithApplication extends FollowUp {
  application: Application;
}
