/**
 * Structured keywords extracted from a candidate's resume by Claude
 * (see services/keywordExtractor.ts).
 *
 * Persisted as JSON on User.resumeKeywords and used to enrich job searches
 * ("Smart Search").
 */
export interface ResumeKeywords {
  /** Specific tools, languages, and frameworks the candidate has used. */
  technologies: string[];
  /** Job role keywords inferred from the candidate's experience. */
  roles: string[];
  /** Broad technical domains inferred from experience and projects. */
  domains: string[];
  /** 3-6 ready-to-use search query strings, most to least specific. */
  searchTerms: string[];
}

/** Runtime guard for the {@link ResumeKeywords} shape. */
export function isResumeKeywords(value: unknown): value is ResumeKeywords {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const isStringArray = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((item) => typeof item === "string");
  return (
    isStringArray(v.technologies) &&
    isStringArray(v.roles) &&
    isStringArray(v.domains) &&
    isStringArray(v.searchTerms)
  );
}
