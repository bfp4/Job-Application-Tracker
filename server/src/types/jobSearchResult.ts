/**
 * A single job posting candidate returned by the job-search agent's
 * structured web-search response.
 */
export interface JobSearchResultItem {
  title: string;
  companyName: string;
  location: string | null;
  jobUrl: string;
  description: string;
  postedDate: string | null;
  matchScore: number;
  matchReasons: string[];
}

export interface JobSearchResult {
  jobs: JobSearchResultItem[];
}
