import { createHash } from "crypto";
import type { Company, JobPosting } from "@prisma/client";

/** A posting joined with its company, the shape every AI prompt reads. */
export type PostingWithCompany = JobPosting & { company: Company | null };

// Caps on prompt segments: a resume or pasted description beyond this adds
// token cost without adding signal. Both limits are far above normal sizes
// (a resume is ~5-10k chars; postings a few k), so truncation only fires on
// degenerate input.
export const MAX_RESUME_CHARS = 30_000;
const MAX_DESCRIPTION_CHARS = 20_000;

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[…truncated]`;
}

/**
 * Renders a posting as the plain-text block AI prompts embed. Salary and URL
 * are opt-in: they help fit analysis but add nothing to answer drafting.
 */
export function formatPostingForPrompt(
  posting: PostingWithCompany,
  options?: { includeSalaryAndUrl?: boolean }
): string {
  const lines = [
    `Title: ${posting.title}`,
    `Company: ${posting.company?.name ?? "Unknown"}`,
    `Location(s): ${posting.location.length ? posting.location.join(", ") : "Not specified"}`,
  ];
  if (options?.includeSalaryAndUrl) {
    lines.push(`Salary: ${posting.salary ?? "Not specified"}`, `URL: ${posting.jobUrl}`);
  }
  lines.push(
    `Description:\n${truncate(posting.description ?? "No description provided.", MAX_DESCRIPTION_CHARS)}`
  );
  return lines.join("\n");
}

/**
 * Hash of every posting field an AI analysis actually reads. If none of these
 * changed, a re-run would see identical input — which is what "the job listing
 * has changed" is measured against. Shared by the resume-tips and
 * tailored-resume services so both agree on staleness.
 */
export function jobPostingFingerprint(posting: PostingWithCompany): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        posting.title,
        posting.company?.name ?? null,
        posting.location,
        posting.salary,
        posting.description,
        posting.jobUrl,
      ])
    )
    .digest("hex");
}
