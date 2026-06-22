import type {
  DigestData,
  RecommendedJob,
  DueFollowUp,
} from "../../server/src/services/digestService";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Builds the digest email. Styling is inline because email clients strip
 * <style> blocks and ignore external CSS. The layout is intentionally simple:
 * a "recommended jobs" section grouped by the search each job came from, and a
 * "follow ups" section listing what's due.
 */
export function buildDigestEmail(digest: DigestData): BuiltEmail {
  const { recommendedJobs, dueFollowUps } = digest;

  const subject = buildSubject(recommendedJobs.length, dueFollowUps.length);

  const sections: string[] = [];
  if (recommendedJobs.length > 0) {
    sections.push(renderRecommendedSection(recommendedJobs));
  }
  if (dueFollowUps.length > 0) {
    sections.push(renderFollowUpSection(dueFollowUps));
  }

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
      <h1 style="font-size:20px;margin:0 0 4px;">Your daily job digest</h1>
      <p style="font-size:13px;color:#7b8794;margin:0 0 24px;">${formatToday()}</p>
      ${sections.join(
        '<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0;" />'
      )}
      <p style="font-size:12px;color:#9aa5b1;margin:32px 0 0;">
        You're receiving this because you have saved searches in Job Application Tracker.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text: buildText(recommendedJobs, dueFollowUps) };
}

function buildSubject(jobCount: number, followUpCount: number): string {
  const parts: string[] = [];
  if (jobCount > 0) {
    parts.push(`${jobCount} new job${jobCount === 1 ? "" : "s"}`);
  }
  if (followUpCount > 0) {
    parts.push(
      `${followUpCount} follow-up${followUpCount === 1 ? "" : "s"} due`
    );
  }
  return parts.length > 0
    ? `Job digest: ${parts.join(" and ")}`
    : "Your daily job digest";
}

function renderRecommendedSection(jobs: RecommendedJob[]): string {
  const groups = groupBySearch(jobs);

  const groupHtml = groups
    .map(
      (group) => `
      <div style="margin:0 0 20px;">
        <p style="font-size:13px;font-weight:bold;color:#52606d;margin:0 0 8px;">
          From your search: ${escapeHtml(group.label)}
        </p>
        ${group.jobs.map(renderJobCard).join("")}
      </div>`
    )
    .join("");

  return `
    <h2 style="font-size:16px;margin:0 0 16px;">Today's recommended jobs</h2>
    ${groupHtml}`;
}

function renderJobCard(item: RecommendedJob): string {
  const { job } = item;
  const title = escapeHtml(job.title || "Untitled role");
  const company = escapeHtml(job.companyName || "Unknown company");
  const location = job.location ? escapeHtml(job.location) : "";
  const titleHtml = job.jobUrl
    ? `<a href="${escapeHtmlAttr(job.jobUrl)}" style="color:#2563eb;text-decoration:none;">${title}</a>`
    : title;

  return `
    <div style="border:1px solid #e4e7eb;border-radius:6px;padding:12px 14px;margin:0 0 10px;background-color:#ffffff;">
      <p style="font-size:15px;font-weight:bold;margin:0 0 4px;">${titleHtml}</p>
      <p style="font-size:13px;color:#52606d;margin:0;">
        ${company}${location ? ` &middot; ${location}` : ""}
      </p>
    </div>`;
}

function renderFollowUpSection(followUps: DueFollowUp[]): string {
  const rows = followUps
    .map((f) => {
      const company = escapeHtml(f.application.company?.name ?? "Unknown company");
      const jobTitle = escapeHtml(
        f.application.jobPosting?.title ?? "a role"
      );
      const note = f.note ? escapeHtml(f.note) : "";
      const due = formatDate(f.followUpDate);

      return `
      <li style="margin:0 0 12px;">
        <span style="font-weight:bold;">${company}</span>
        <span style="color:#52606d;"> — ${jobTitle}</span>
        <br />
        <span style="font-size:13px;color:#7b8794;">Due ${escapeHtml(due)}</span>
        ${
          note
            ? `<br /><span style="font-size:13px;color:#52606d;">${note}</span>`
            : ""
        }
      </li>`;
    })
    .join("");

  return `
    <h2 style="font-size:16px;margin:0 0 16px;">Don't forget to follow up</h2>
    <ul style="margin:0;padding:0 0 0 18px;font-size:14px;">
      ${rows}
    </ul>`;
}

/** Groups recommended jobs by the search they came from, preserving rank order. */
function groupBySearch(
  jobs: RecommendedJob[]
): Array<{ label: string; jobs: RecommendedJob[] }> {
  const groups = new Map<string, { label: string; jobs: RecommendedJob[] }>();
  for (const job of jobs) {
    const key = `${job.fromSearchRank}:${job.fromSearchQuery}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(job);
    } else {
      groups.set(key, { label: job.fromSearchQuery, jobs: [job] });
    }
  }
  return [...groups.values()];
}

/** Plain-text fallback for clients that don't render HTML. */
function buildText(jobs: RecommendedJob[], followUps: DueFollowUp[]): string {
  const lines: string[] = ["Your daily job digest", formatToday(), ""];

  if (jobs.length > 0) {
    lines.push("TODAY'S RECOMMENDED JOBS", "");
    for (const group of groupBySearch(jobs)) {
      lines.push(`From your search: ${group.label}`);
      for (const item of group.jobs) {
        const loc = item.job.location ? ` (${item.job.location})` : "";
        lines.push(`  - ${item.job.title} @ ${item.job.companyName}${loc}`);
        if (item.job.jobUrl) lines.push(`    ${item.job.jobUrl}`);
      }
      lines.push("");
    }
  }

  if (followUps.length > 0) {
    lines.push("DON'T FORGET TO FOLLOW UP", "");
    for (const f of followUps) {
      const company = f.application.company?.name ?? "Unknown company";
      const jobTitle = f.application.jobPosting?.title ?? "a role";
      lines.push(
        `  - ${company} — ${jobTitle} (due ${formatDate(f.followUpDate)})`
      );
      if (f.note) lines.push(`    ${f.note}`);
    }
  }

  return lines.join("\n");
}

function formatToday(): string {
  return formatDate(new Date());
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Escapes text destined for HTML body content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escapes text destined for an HTML attribute value (e.g. href). */
function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
