import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { buildDigests, type MailingConfig } from "./digest.js";
import {
  createClient,
  fetchDueFollowUps,
  fetchNotAppliedApplications,
  markReminded,
} from "./db.js";

const ses = new SESv2Client({});

interface Result {
  usersEmailed: number;
  usersFailed: number;
  followUpsMarked: number;
  applicationsNudged: number;
}

/**
 * Reads the two CAN-SPAM footer inputs from the environment, refusing to run
 * without either.
 *
 * Deliberately no fallback value. A default mailing address would be a *false*
 * one, and 15 U.S.C. §7704(a)(5) is violated by a wrong address just as much
 * as by a missing one — so a misconfigured deploy must send nothing at all
 * rather than send thousands of non-compliant emails that look fine in the
 * logs. Same reasoning for the unsubscribe URL: a digest whose opt-out link
 * 404s is worse than a digest that was never sent.
 *
 * Both are set on the function's environment by infra/09-lambda.sh, which
 * reads the address from SSM and refuses to deploy while it is unset.
 */
function requireMailingConfig(): MailingConfig {
  const unsubscribeBaseUrl = process.env.UNSUBSCRIBE_BASE_URL;
  const mailingAddress = process.env.MAILING_ADDRESS;

  const missing = [
    !unsubscribeBaseUrl && "UNSUBSCRIBE_BASE_URL",
    !mailingAddress && "MAILING_ADDRESS",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} is not set. The daily digest is commercial ` +
        `email: CAN-SPAM requires a working unsubscribe link and a physical ` +
        `postal address in every message, so this function refuses to send ` +
        `without both.`
    );
  }

  return {
    unsubscribeBaseUrl: unsubscribeBaseUrl!,
    mailingAddress: mailingAddress!,
  };
}

export const handler = async (): Promise<Result> => {
  const fromAddress = process.env.SES_FROM;
  if (!fromAddress) {
    throw new Error("SES_FROM is not set");
  }
  const mailingConfig = requireMailingConfig();

  const client = createClient();
  await client.connect();

  try {
    const followUps = await fetchDueFollowUps(client);
    const notApplied = await fetchNotAppliedApplications(client);
    const digests = buildDigests(followUps, notApplied, mailingConfig);

    let usersEmailed = 0;
    let followUpsMarked = 0;
    let applicationsNudged = 0;
    const failed: string[] = [];

    // Per-user isolation: one failed send (e.g. an unverified recipient
    // while SES is sandboxed) must not block other users, and its
    // follow-ups stay unmarked so they are retried on the next run.
    for (const digest of digests) {
      try {
        await ses.send(
          new SendEmailCommand({
            FromEmailAddress: fromAddress,
            Destination: { ToAddresses: [digest.toAddress] },
            Content: {
              Simple: {
                Subject: { Data: digest.subject },
                Body: { Text: { Data: digest.body } },
                // RFC 2369 + RFC 8058. The pair is what makes Gmail and
                // Outlook render their own "Unsubscribe" control next to the
                // sender: List-Unsubscribe alone is treated as advisory, and
                // it is List-Unsubscribe-Post that promises the URL accepts a
                // bare POST with no confirmation step. The API route handles
                // POST for exactly that reason — see routes/unsubscribe.ts.
                Headers: [
                  {
                    Name: "List-Unsubscribe",
                    Value: `<${digest.unsubscribeUrl}>`,
                  },
                  {
                    Name: "List-Unsubscribe-Post",
                    Value: "List-Unsubscribe=One-Click",
                  },
                ],
              },
            },
          })
        );
        await markReminded(client, digest.followUpIds, digest.applicationIds);
        usersEmailed += 1;
        followUpsMarked += digest.followUpIds.length;
        applicationsNudged += digest.applicationIds.length;
      } catch (error) {
        failed.push(digest.toAddress);
        console.error(`Failed to send digest to ${digest.toAddress}:`, error);
      }
    }

    const result: Result = {
      usersEmailed,
      usersFailed: failed.length,
      followUpsMarked,
      applicationsNudged,
    };
    console.log(JSON.stringify(result));

    if (failed.length > 0) {
      throw new Error(
        `Digest send failed for ${failed.length} user(s): ${failed.join(", ")}`
      );
    }
    return result;
  } finally {
    await client.end();
  }
};
