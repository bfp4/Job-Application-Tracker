import pg from "pg";
import type { DueFollowUpRow, NotAppliedRow } from "./digest.js";
import { RDS_CA_BUNDLE } from "./rdsCaBundle.js";

// The raw SQL below hand-mirrors table/column names and the NOT_APPLIED
// status value from server/prisma/schema.prisma (this package deliberately
// skips the Prisma client to keep the bundle small). Nothing type-checks
// that mapping — when renaming schema fields, update these queries too.

// Any of these in the connection string makes pg-connection-string build its
// own `ssl` object, and pg merges the parsed connection string *over* the
// client config (connection-parameters.js: `Object.assign({}, config,
// parse(config.connectionString))`). So an sslmode here would silently drop
// the CA bundle below and take verification with it — the exact failure this
// code exists to prevent, and one that leaves no trace at runtime.
const SSL_CONNECTION_STRING_PARAMS = [
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslnegotiation",
];

function assertNoSslOverride(connectionString: string): void {
  // Same lenient parse pg-connection-string uses, so a URL it accepts we also
  // read rather than skip.
  let params: URLSearchParams;
  try {
    params = new URL(connectionString, "postgres://base").searchParams;
  } catch {
    return; // Unparseable — pg raises its own, clearer error on connect.
  }
  const found = SSL_CONNECTION_STRING_PARAMS.filter((name) => params.has(name));
  if (found.length > 0) {
    throw new Error(
      `DATABASE_URL sets ${found.join(", ")}; pg lets connection-string SSL ` +
        `settings override the client config, which would discard the bundled ` +
        `RDS CA and stop verifying the database certificate. Remove the ` +
        `parameter — TLS and verification are already on, see createClient.`
    );
  }
}

/**
 * One short-lived client per invocation (the function runs once a day, so a
 * pooled connection would be stale by the next invoke anyway). RDS forces SSL;
 * we verify its certificate against Amazon's bundled roots, so a host inside
 * the VPC can't impersonate the database and collect the password. The
 * hostname in DATABASE_URL must stay the RDS endpoint for that check to pass —
 * a tunnel or IP address won't match the certificate.
 */
export function createClient(): pg.Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  assertNoSslOverride(connectionString);
  return new pg.Client({
    connectionString,
    ssl: { ca: RDS_CA_BUNDLE, rejectUnauthorized: true },
    // The queries below truncate to *days* with date_trunc('day', NOW()),
    // which uses the session timezone — pin it so the reminder window and
    // the per-day dedup don't shift if the RDS default ever isn't UTC.
    options: "-c TimeZone=UTC",
  });
}

/**
 * A follow-up is mentioned in the digest on each of the 3 days before its
 * due date and on the day itself (UTC days — the schedule fires at 14:00
 * UTC). reminderSentAt only dedupes within a day, so a manual re-invoke
 * cannot double-send but tomorrow's run mentions the follow-up again.
 */
export async function fetchDueFollowUps(
  client: pg.Client
): Promise<DueFollowUpRow[]> {
  const result = await client.query<DueFollowUpRow>(
    `SELECT f.id,
            f."followUpDate",
            f.note,
            u.email AS "userEmail",
            jp.title AS "jobTitle",
            c.name  AS "companyName"
     FROM "FollowUp" f
     JOIN "Application" a  ON a.id  = f."applicationId"
     JOIN "User" u         ON u.id  = a."userId"
     JOIN "JobPosting" jp  ON jp.id = a."jobPostingId"
     LEFT JOIN "Company" c ON c.id  = jp."companyId"
     WHERE f."followUpDate" >= date_trunc('day', NOW())
       AND f."followUpDate" <  date_trunc('day', NOW()) + interval '4 days'
       AND f.completed = false
       AND (f."reminderSentAt" IS NULL OR f."reminderSentAt" < date_trunc('day', NOW()))
     ORDER BY u.email, f."followUpDate"`
  );
  return result.rows;
}

/**
 * An unsubmitted application is nudged once per UTC day, every day, until it
 * leaves NOT_APPLIED. nudgeSentAt dedupes within the day so a retried
 * invocation (the handler throws when any recipient fails, and the schedule
 * retries) cannot re-send a nudge the user already received today.
 */
export async function fetchNotAppliedApplications(
  client: pg.Client
): Promise<NotAppliedRow[]> {
  const result = await client.query<NotAppliedRow>(
    `SELECT a.id AS "applicationId",
            a."createdAt",
            u.email AS "userEmail",
            jp.title AS "jobTitle",
            c.name  AS "companyName"
     FROM "Application" a
     JOIN "User" u         ON u.id  = a."userId"
     JOIN "JobPosting" jp  ON jp.id = a."jobPostingId"
     LEFT JOIN "Company" c ON c.id  = jp."companyId"
     WHERE a.status = 'NOT_APPLIED'
       AND (a."nudgeSentAt" IS NULL OR a."nudgeSentAt" < date_trunc('day', NOW()))
     ORDER BY u.email, a."createdAt"`
  );
  return result.rows;
}

/**
 * Stamps everything the digest mentioned as sent, in one statement per table.
 * Called only after that user's email is accepted by SES — a failed send
 * leaves the rows unstamped so the next run (or retry) picks them up again.
 */
export async function markReminded(
  client: pg.Client,
  followUpIds: string[],
  applicationIds: string[]
): Promise<void> {
  if (followUpIds.length > 0) {
    await client.query(
      `UPDATE "FollowUp" SET "reminderSentAt" = NOW() WHERE id = ANY($1::text[])`,
      [followUpIds]
    );
  }
  if (applicationIds.length > 0) {
    await client.query(
      `UPDATE "Application" SET "nudgeSentAt" = NOW() WHERE id = ANY($1::text[])`,
      [applicationIds]
    );
  }
}
