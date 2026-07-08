/**
 * Pure digest-building logic: rows in, per-user emails out. No I/O here so
 * the whole module is unit-testable without a database or SES.
 */

export interface DueFollowUpRow {
  id: string;
  followUpDate: Date;
  note: string | null;
  userEmail: string;
  jobTitle: string;
  companyName: string | null;
}

export interface NotAppliedRow {
  applicationId: string;
  createdAt: Date;
  userEmail: string;
  jobTitle: string;
  companyName: string | null;
}

export interface Digest {
  toAddress: string;
  subject: string;
  body: string;
  /** Follow-up ids to stamp reminderSentAt on after a successful send. */
  followUpIds: string[];
}

const UNKNOWN_COMPANY = "Unknown company";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function jobLabel(jobTitle: string, companyName: string | null): string {
  return `${jobTitle} at ${companyName ?? UNKNOWN_COMPANY}`;
}

/**
 * Groups both row sets by user email and renders one digest email per user.
 * Users appearing in neither set get no digest. Section order and row order
 * follow the input order (queries sort by date).
 */
export function buildDigests(
  followUps: DueFollowUpRow[],
  notApplied: NotAppliedRow[]
): Digest[] {
  const byUser = new Map<
    string,
    { followUps: DueFollowUpRow[]; notApplied: NotAppliedRow[] }
  >();

  const bucket = (email: string) => {
    let entry = byUser.get(email);
    if (!entry) {
      entry = { followUps: [], notApplied: [] };
      byUser.set(email, entry);
    }
    return entry;
  };

  for (const row of followUps) bucket(row.userEmail).followUps.push(row);
  for (const row of notApplied) bucket(row.userEmail).notApplied.push(row);

  const digests: Digest[] = [];
  for (const [email, entry] of byUser) {
    digests.push({
      toAddress: email,
      subject: buildSubject(entry.followUps.length, entry.notApplied.length),
      body: formatDigestEmail(entry.followUps, entry.notApplied),
      followUpIds: entry.followUps.map((f) => f.id),
    });
  }
  return digests;
}

function buildSubject(followUpCount: number, notAppliedCount: number): string {
  const parts: string[] = [];
  if (followUpCount > 0) {
    parts.push(`${plural(followUpCount, "follow-up", "follow-ups")} due`);
  }
  if (notAppliedCount > 0) {
    parts.push(`${plural(notAppliedCount, "application", "applications")} to submit`);
  }
  return `Job tracker: ${parts.join(", ")}`;
}

export function formatDigestEmail(
  followUps: DueFollowUpRow[],
  notApplied: NotAppliedRow[]
): string {
  const sections: string[] = [];

  if (followUps.length > 0) {
    const lines = followUps.map((f) => {
      const note = f.note ? ` — ${f.note}` : "";
      return `- ${jobLabel(f.jobTitle, f.companyName)} (due ${formatDate(f.followUpDate)})${note}`;
    });
    sections.push(`FOLLOW-UPS DUE\n${lines.join("\n")}`);
  }

  if (notApplied.length > 0) {
    const lines = notApplied.map(
      (a) => `- ${jobLabel(a.jobTitle, a.companyName)} (saved ${formatDate(a.createdAt)})`
    );
    sections.push(`NOT APPLIED YET\n${lines.join("\n")}`);
  }

  return `${sections.join("\n\n")}\n\n— Job Application Tracker`;
}
