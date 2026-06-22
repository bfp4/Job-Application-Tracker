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
  resumeS3Key: string | null;
  coverLetterS3Key: string | null;
  appliedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  jobPosting?: JobPosting;
  company?: Company;
  contacts?: Contact[];
  followUps?: FollowUp[];
}

/** Structured resume shape produced by the AI parser and stored as JSON. */
export interface ResumePersonalInfo {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  location: string;
}

export interface ResumeExperience {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string | null;
  bullets: string[];
}

export interface ResumeEducation {
  institution: string;
  degree: string;
  field: string;
  graduationDate: string;
}

export interface ResumeSkills {
  languages: string[];
  frontend: string[];
  backend: string[];
  databases: string[];
  tools: string[];
}

export interface ResumeProject {
  name: string;
  technologies: string[];
  bullets: string[];
}

export interface ResumeLeadership {
  organization: string;
  role: string;
  startDate: string;
  endDate: string | null;
  bullets: string[];
}

export interface ResumeStructure {
  personalInfo: ResumePersonalInfo;
  summary: string | null;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkills;
  projects: ResumeProject[];
  leadership: ResumeLeadership[];
}

export interface BaseResume {
  id: string;
  userId: string;
  content: ResumeStructure;
  pdfS3Key: string | null;
  createdAt: string;
}

/** Search keywords extracted from a resume (see server keywordExtractor). */
export interface ResumeKeywords {
  technologies: string[];
  roles: string[];
  domains: string[];
  searchTerms: string[];
}

export interface TailoredResume {
  id: string;
  applicationId: string;
  baseResumeId: string;
  tailoredContent: ResumeStructure;
  pdfS3Key: string | null;
  aiNotes: string | null;
  createdAt: string;
}

/** A tailored resume with presigned URLs attached by the API. */
export interface TailoredResumeWithUrls extends TailoredResume {
  viewUrl: string | null;
  downloadUrl: string | null;
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

/** Aggregated application statistics powering the insights dashboard. */
export interface AggregatedStats {
  totalApplications: number;
  byStatus: Record<string, number>;
  responseRate: number;
  bySource: Record<string, number>;
  avgDaysToResponse: number | null;
  topCompanies: Array<{ name: string; count: number }>;
  applicationsByWeek: Array<{ week: string; count: number }>;
  statusProgressionRate: Record<string, number>;
  topSearchQueries: Array<{ query: string; location: string; score: number }>;
  dueFollowUps: number;
  overdueFollowUps: number;
}

export type InsightType = "positive" | "warning" | "suggestion" | "neutral";

/** A single AI-generated insight. */
export interface Insight {
  title: string;
  insight: string;
  type: InsightType;
}

/** Response shape from GET /api/insights. */
export interface InsightsResponse {
  insights: Insight[];
  stats: AggregatedStats;
  generatedAt: string;
  aiError: boolean;
}

/** A persisted insight report from GET /api/insights/history. */
export interface InsightReport {
  id: string;
  generatedAt: string;
  insights: Insight[];
  stats: AggregatedStats;
}

/** A tracked search that feeds the daily recommended-jobs digest. */
export interface SearchQuery {
  id: string;
  userId: string;
  query: string;
  location: string;
  postedWithin: string | null;
  experienceLevel: string | null;
  searchCount: number;
  lastSearchedAt: string;
  pinned: boolean;
  createdAt: string;
}
