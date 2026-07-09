import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { buildDigests } from "./digest.js";
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
}

export const handler = async (): Promise<Result> => {
  const fromAddress = process.env.SES_FROM;
  if (!fromAddress) {
    throw new Error("SES_FROM is not set");
  }

  const client = createClient();
  await client.connect();

  try {
    const followUps = await fetchDueFollowUps(client);
    const notApplied = await fetchNotAppliedApplications(client);
    const digests = buildDigests(followUps, notApplied);

    let usersEmailed = 0;
    let followUpsMarked = 0;
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
              },
            },
          })
        );
        await markReminded(client, digest.followUpIds);
        usersEmailed += 1;
        followUpsMarked += digest.followUpIds.length;
      } catch (error) {
        failed.push(digest.toAddress);
        console.error(`Failed to send digest to ${digest.toAddress}:`, error);
      }
    }

    const result: Result = {
      usersEmailed,
      usersFailed: failed.length,
      followUpsMarked,
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
