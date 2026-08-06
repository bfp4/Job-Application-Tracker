/**
 * Pure digest-building logic: rows in, per-user emails out. No I/O here so
 * the whole module is unit-testable without a database or SES.
 */

export interface DueFollowUpRow {
  id: string;
  followUpDate: Date;
  note: string | null;
  userEmail: string;
  unsubscribeToken: string;
  jobTitle: string;
  companyName: string | null;
}

export interface NotAppliedRow {
  applicationId: string;
  createdAt: Date;
  userEmail: string;
  unsubscribeToken: string;
  jobTitle: string;
  companyName: string | null;
}

export interface Digest {
  toAddress: string;
  subject: string;
  body: string;
  /**
   * The recipient's own unsubscribe URL. Also goes in the List-Unsubscribe
   * header, so it lives on the digest rather than being rebuilt in the handler.
   */
  unsubscribeUrl: string;
  /** Follow-up ids to stamp reminderSentAt on after a successful send. */
  followUpIds: string[];
  /** Application ids to stamp nudgeSentAt on after a successful send. */
  applicationIds: string[];
}

/**
 * The two things CAN-SPAM requires in the body of every commercial message:
 * a working opt-out mechanism and the sender's physical postal address.
 * Both are supplied by the caller (from the environment) rather than defaulted
 * here — see requireMailingConfig in handler.ts for why there is no fallback.
 */
export interface MailingConfig {
  /**
   * Absolute URL of the unsubscribe endpoint, with no query string —
   * e.g. "https://api.example.com/unsubscribe". The per-user token is
   * appended as `?u=`.
   */
  unsubscribeBaseUrl: string;
  /** The sender's physical mailing address, rendered verbatim in the footer. */
  mailingAddress: string;
}

export function unsubscribeUrlFor(
  config: MailingConfig,
  unsubscribeToken: string
): string {
  return `${config.unsubscribeBaseUrl}?u=${encodeURIComponent(unsubscribeToken)}`;
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
  notApplied: NotAppliedRow[],
  config: MailingConfig
): Digest[] {
  const byUser = new Map<
    string,
    {
      unsubscribeToken: string;
      followUps: DueFollowUpRow[];
      notApplied: NotAppliedRow[];
    }
  >();

  const bucket = (email: string, unsubscribeToken: string) => {
    let entry = byUser.get(email);
    if (!entry) {
      entry = { unsubscribeToken, followUps: [], notApplied: [] };
      byUser.set(email, entry);
    }
    return entry;
  };

  for (const row of followUps) {
    bucket(row.userEmail, row.unsubscribeToken).followUps.push(row);
  }
  for (const row of notApplied) {
    bucket(row.userEmail, row.unsubscribeToken).notApplied.push(row);
  }

  const digests: Digest[] = [];
  for (const [email, entry] of byUser) {
    const unsubscribeUrl = unsubscribeUrlFor(config, entry.unsubscribeToken);
    digests.push({
      toAddress: email,
      subject: buildSubject(entry.followUps.length, entry.notApplied.length),
      body: formatDigestEmail(entry.followUps, entry.notApplied, config, unsubscribeUrl),
      unsubscribeUrl,
      followUpIds: entry.followUps.map((f) => f.id),
      applicationIds: entry.notApplied.map((a) => a.applicationId),
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
  notApplied: NotAppliedRow[],
  config: MailingConfig,
  unsubscribeUrl: string
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

  return `${sections.join("\n\n")}\n\n${formatFooter(config, unsubscribeUrl)}`;
}

/**
 * The CAN-SPAM footer (15 U.S.C. §7704(a)(3)–(5)): why the recipient is getting
 * this, a working opt-out, and the sender's physical postal address. Every
 * digest carries it — there is no path through formatDigestEmail that omits it.
 */
function formatFooter(config: MailingConfig, unsubscribeUrl: string): string {
  return [
    "—",
    "Job Application Tracker",
    "",
    "You're receiving this because you have follow-ups or unsubmitted",
    "applications saved in your JobTracker account. You can turn these daily",
    "reminders off at any time — in Settings, or with this link:",
    unsubscribeUrl,
    "",
    config.mailingAddress,
  ].join("\n");
}
