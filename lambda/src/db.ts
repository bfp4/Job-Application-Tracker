import pg from "pg";
import type { DueFollowUpRow, NotAppliedRow } from "./digest.js";

// The raw SQL below hand-mirrors table/column names and the NOT_APPLIED
// status value from server/prisma/schema.prisma (this package deliberately
// skips the Prisma client to keep the bundle small). Nothing type-checks
// that mapping — when renaming schema fields, update these queries too.

/**
 * One short-lived client per invocation (the function runs once a day, so a
 * pooled connection would be stale by the next invoke anyway). RDS defaults
 * to forcing SSL; certificate verification is skipped because the Lambda
 * talks to RDS over the VPC's private network, not the internet.
 */
export function createClient(): pg.Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
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
     ORDER BY u.email, a."createdAt"`
  );
  return result.rows;
}

export async function markReminded(
  client: pg.Client,
  followUpIds: string[]
): Promise<void> {
  if (followUpIds.length === 0) return;
  await client.query(
    `UPDATE "FollowUp" SET "reminderSentAt" = NOW() WHERE id = ANY($1::text[])`,
    [followUpIds]
  );
}
