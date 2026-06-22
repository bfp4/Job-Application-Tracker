import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { ScheduledEvent } from "aws-lambda";

// Reuse the digest + job-source logic from the Express server rather than
// duplicating it. See README for why we import straight from /server/src.
import { prisma } from "../../server/src/lib/prisma";
import { generateDigestForUser } from "../../server/src/services/digestService";
import { buildDigestEmail } from "./emailTemplate";

/** Summary returned by a digest run (and logged at the end). */
export interface DigestRunSummary {
  usersProcessed: number;
  emailsSent: number;
  failures: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Daily digest entry point.
 *
 * Fetches every user, generates their digest, and emails it via SES. One user's
 * failure (email send, etc.) is logged and does not stop the others. Each user's
 * outcome is recorded as a DigestLog row (SENT or FAILED).
 *
 * Triggered by EventBridge in production (added in a later step); also invoked
 * directly by testLocal.ts for local testing.
 */
export async function handler(
  _event?: ScheduledEvent
): Promise<DigestRunSummary> {
  const senderEmail = requireEnv("SES_SENDER_EMAIL");
  const region = process.env.AWS_REGION;
  const ses = new SESClient(region ? { region } : {});

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  console.log(`Daily digest: processing ${users.length} user(s).`);

  let emailsSent = 0;
  let failures = 0;

  for (const user of users) {
    try {
      const digest = await generateDigestForUser(user.id);

      const hasContent =
        digest.recommendedJobs.length > 0 || digest.dueFollowUps.length > 0;
      if (!hasContent) {
        console.log(`No digest content for ${user.email}; skipping send.`);
        continue;
      }

      const { subject, html, text } = buildDigestEmail(digest);

      await ses.send(
        new SendEmailCommand({
          Source: senderEmail,
          Destination: { ToAddresses: [user.email] },
          Message: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: html, Charset: "UTF-8" },
              Text: { Data: text, Charset: "UTF-8" },
            },
          },
        })
      );

      await prisma.digestLog.create({
        data: {
          userId: user.id,
          sentAt: new Date(),
          recommendedJobIds: digest.recommendedJobs.map((r) => r.jobPostingId),
          reminderApplicationIds: digest.dueFollowUps.map(
            (f) => f.applicationId
          ),
          status: "SENT",
        },
      });

      emailsSent += 1;
      console.log(`Sent digest to ${user.email}.`);
    } catch (err) {
      failures += 1;
      const note = err instanceof Error ? err.message : String(err);
      // The DigestLog schema has no error column, so the detail goes to the logs
      // (CloudWatch in production); the row just records the FAILED status.
      console.error(`Failed to send digest to ${user.email}: ${note}`);

      try {
        await prisma.digestLog.create({
          data: {
            userId: user.id,
            sentAt: new Date(),
            recommendedJobIds: [],
            reminderApplicationIds: [],
            status: "FAILED",
          },
        });
      } catch (logErr) {
        console.error(
          `Also failed to record FAILED DigestLog for ${user.email}:`,
          logErr
        );
      }
    }
  }

  const summary: DigestRunSummary = {
    usersProcessed: users.length,
    emailsSent,
    failures,
  };
  console.log(`Daily digest complete: ${JSON.stringify(summary)}`);
  return summary;
}
