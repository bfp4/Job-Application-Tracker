import { isResumeKeywords, type ResumeKeywords } from "../types/keywords";

const MAX_KEYWORD_FILTERS = 6;
const MAX_TECHNOLOGIES = 4;
const MAX_ROLES = 2;

/** Splits text into lowercased word tokens (alphanumerics only). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Decides whether the candidate's keywords are relevant to this query.
 *
 * Simple heuristic: a query word that also appears in any of the candidate's
 * roles or domains signals the search is in their wheelhouse. Generic role
 * nouns like "engineer" and "developer" also qualify.
 */
function keywordsAreRelevant(
  queryWords: Set<string>,
  keywords: ResumeKeywords
): boolean {
  const signalWords = new Set<string>();
  for (const phrase of [...keywords.roles, ...keywords.domains]) {
    for (const word of tokenize(phrase)) {
      signalWords.add(word);
    }
  }

  for (const word of queryWords) {
    if (signalWords.has(word)) return true;
  }

  return (
    queryWords.has("engineer") ||
    queryWords.has("developer") ||
    queryWords.has("development")
  );
}

/**
 * Picks resume keywords to send as optional OR-filters (Adzuna `what_or`).
 *
 * Takes up to 4 technologies, then up to 2 roles (6 total). Technologies
 * already present in the query are skipped. Multi-word roles are included —
 * Adzuna treats spaces as separate OR terms, which is still useful.
 */
export function selectKeywordFilters(
  query: string,
  keywords: unknown
): string[] {
  if (!isResumeKeywords(keywords)) return [];
  if (keywords.technologies.length === 0) return [];

  const queryWords = new Set(tokenize(query));
  if (!keywordsAreRelevant(queryWords, keywords)) return [];

  const filters: string[] = [];

  for (const tech of keywords.technologies) {
    if (filters.length >= MAX_TECHNOLOGIES) break;
    const techWords = tokenize(tech);
    const alreadyPresent =
      techWords.length > 0 && techWords.every((w) => queryWords.has(w));
    if (alreadyPresent) continue;
    filters.push(tech);
  }

  let rolesAdded = 0;
  for (const role of keywords.roles) {
    if (filters.length >= MAX_KEYWORD_FILTERS) break;
    if (rolesAdded >= MAX_ROLES) break;
    filters.push(role);
    rolesAdded++;
  }

  return filters;
}
