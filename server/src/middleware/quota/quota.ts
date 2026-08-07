import type { User, UserTier } from "@prisma/client";
import { isBilledModelFailure } from "../../lib/anthropic/anthropic";
import { startOfUtcDay } from "../../lib/dates";
import { prisma } from "../../lib/prisma";

export const DAILY_BASIC_LIMIT = 10;

/** aiCallsUsedToday, but 0 if that count is from an earlier UTC day (this
 * module only resets the DB row lazily on the next AI call). */
export function effectiveAiCallsUsedToday(
  user: Pick<User, "aiCallsUsedToday" | "aiCallsDate">
): number {
  if (!user.aiCallsDate) return 0;
  const today = new Date();
  const sameDay =
    user.aiCallsDate.getUTCFullYear() === today.getUTCFullYear() &&
    user.aiCallsDate.getUTCMonth() === today.getUTCMonth() &&
    user.aiCallsDate.getUTCDate() === today.getUTCDate();
  return sameDay ? user.aiCallsUsedToday : 0;
}

/**
 * Atomically reserves one AI call for a BASIC user (no-op, always `true`,
 * for PREMIUM/ADMIN). The reset-if-new-day step and the limit check both
 * happen inside the same conditional UPDATE, so two concurrent requests from
 * the same user can't both read the same pre-increment count and both slip
 * through — Postgres serializes the two UPDATEs on the row, and only one can
 * satisfy the WHERE clause once the first has committed its increment.
 *
 * Returns `false` (reservation refused) once today's count is already at
 * DAILY_BASIC_LIMIT.
 *
 * Call this immediately before the actual AI generation attempt — after any
 * ownership/staleness/in-flight checks that might still 404/400/409 the
 * request — since it has a side effect (the increment) unlike a plain read.
 * Reserving any earlier would burn part of a Basic user's daily cap on
 * requests that never even attempt a generation.
 */
export async function reserveAiCall(userId: string, tier: UserTier): Promise<boolean> {
  if (tier !== "BASIC") return true;

  const today = startOfUtcDay(new Date());
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "User"
    SET "aiCallsUsedToday" = CASE
          WHEN "aiCallsDate" IS DISTINCT FROM ${today} THEN 1
          ELSE "aiCallsUsedToday" + 1
        END,
        "aiCallsDate" = ${today}
    WHERE "id" = ${userId}
      AND (
        "aiCallsDate" IS DISTINCT FROM ${today}
        OR "aiCallsUsedToday" < ${DAILY_BASIC_LIMIT}
      )
    RETURNING "id"
  `;
  return rows.length > 0;
}

/**
 * Refunds a reservation made by `reserveAiCall` when the AI generation it was
 * guarding didn't actually succeed — so a failed attempt doesn't cost the
 * user part of their daily cap. No-op for PREMIUM/ADMIN.
 *
 * NOT refunded: failures raised after Claude already returned a response
 * (`isBilledModelFailure`). That tag only covers failures raised *inside* the
 * Anthropic client, so call sites must also skip the refund for anything that
 * throws after a generation returned — the DB write that persists it, most of
 * all. They track that with a local `billed` flag; without it, a write that
 * fails every time (a constraint conflict, a dead pool) lets a Basic user burn
 * unbounded tokens at zero quota cost, which is precisely what this cap exists
 * to prevent. A refusal and a max_tokens truncation both arrive
 * as a successful, fully billed HTTP 200 and only then throw, and both are
 * reproducible from the user's own input — refunding them would let a Basic
 * user replay one posting that trips the safety classifier indefinitely,
 * spending real tokens at zero quota cost. That is exactly the spend this cap
 * exists to bound, so the reservation stands: the call happened and was paid
 * for, whatever came back.
 *
 * Failures before the model is reached (S3 read, transport error, missing API
 * key) cost nothing and are refunded — retrying them is free.
 *
 * Best-effort by contract: never rejects. Every call site runs this from a
 * catch block on its way to re-throwing the *original* failure, so letting a
 * refund error escape would replace that failure — e.g. a ContentRefusedError
 * would surface as a generic 500 instead of the 422 the error handler builds.
 * A lost refund costs the user one of ten daily calls; a swallowed AI error
 * costs them the explanation.
 *
 * Accepted edge case: a refund landing exactly across a UTC-midnight
 * boundary could decrement a different day's freshly-reset count. Not worth
 * tracking which "day" a reservation belongs to for a 10/day cap — but it is
 * why the decrement is floored at zero rather than unconditional. Two
 * reservations straddling midnight that both fail refund twice against a
 * count that only ever reached 1, and an unfloored decrement would leave -1
 * standing: 11 calls that day, rendered as "-1/10 AI calls used today".
 *
 * updateMany rather than update because only its `where` can filter on a
 * column — the floor and the decrement stay in one atomic statement, so
 * concurrent refunds can't both read the same pre-decrement count.
 */
export async function releaseAiCallOnFailure(
  userId: string,
  tier: UserTier,
  err: unknown
): Promise<void> {
  if (tier !== "BASIC") return;
  if (isBilledModelFailure(err)) return;
  try {
    await prisma.user.updateMany({
      where: { id: userId, aiCallsUsedToday: { gt: 0 } },
      data: { aiCallsUsedToday: { decrement: 1 } },
    });
  } catch (err) {
    console.error(`Failed to refund an AI call reservation for user ${userId}:`, err);
  }
}

/** Shared 429 body for a refused reservation — same shape at all 5 call sites. */
export const AI_QUOTA_EXCEEDED_RESPONSE = {
  error: "Daily AI call limit reached. Request premium access in Settings for unlimited use.",
  code: "AI_QUOTA_EXCEEDED",
} as const;
