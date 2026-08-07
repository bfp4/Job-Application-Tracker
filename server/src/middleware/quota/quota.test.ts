import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    user: { updateMany: vi.fn() },
  },
}));

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

// Only so the refund tests can produce a *real* post-response failure below
// rather than a hand-rolled stand-in for one.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

import { ContentRefusedError, generateStructured } from "../../lib/anthropic/anthropic";
import { reserveAiCall, releaseAiCallOnFailure } from "./quota";

/**
 * The error a refusal actually produces, raised through the real
 * generateStructured path — so these tests can't drift from however that
 * failure comes to be marked as billed.
 */
async function refusalError(): Promise<unknown> {
  process.env.ANTHROPIC_API_KEY = "test-key";
  streamMock.mockReturnValue({
    finalMessage: async () => ({
      stop_reason: "refusal",
      stop_details: { category: "harmful_content" },
      content: [],
    }),
  });

  let caught: unknown;
  try {
    await generateStructured({ system: "s", prompt: "p", schema: {} });
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof ContentRefusedError)) {
    throw new Error("expected generateStructured to throw a ContentRefusedError");
  }
  return caught;
}

describe("reserveAiCall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op for PREMIUM and ADMIN — never touches the database", async () => {
    expect(await reserveAiCall("user-1", "PREMIUM")).toBe(true);
    expect(await reserveAiCall("user-1", "ADMIN")).toBe(true);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("reserves the call when the atomic UPDATE returns a row", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "user-1" }]);

    expect(await reserveAiCall("user-1", "BASIC")).toBe(true);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses when the atomic UPDATE affects no row (limit already reached today)", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    expect(await reserveAiCall("user-1", "BASIC")).toBe(false);
  });
});

describe("releaseAiCallOnFailure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op for PREMIUM and ADMIN", async () => {
    await releaseAiCallOnFailure("user-1", "PREMIUM", new Error("s3 read failed"));
    await releaseAiCallOnFailure("user-1", "ADMIN", new Error("s3 read failed"));

    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("decrements aiCallsUsedToday for BASIC when the failure never reached the model", async () => {
    await releaseAiCallOnFailure("user-1", "BASIC", new Error("s3 read failed"));

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", aiCallsUsedToday: { gt: 0 } },
      data: { aiCallsUsedToday: { decrement: 1 } },
    });
  });

  // Two reservations either side of UTC midnight both failing would otherwise
  // refund twice against a count that only reached 1, leaving -1 — an extra
  // call that day and a "-1/10" badge. The floor lives in the WHERE clause so
  // it can't race a concurrent refund.
  it("floors the decrement at zero rather than letting the count go negative", async () => {
    await releaseAiCallOnFailure("user-1", "BASIC", new Error("s3 read failed"));

    const { where } = prismaMock.user.updateMany.mock.calls[0][0];
    expect(where.aiCallsUsedToday).toEqual({ gt: 0 });
  });

  // The cap exists to bound spend, and a refusal is a fully billed HTTP 200.
  // Refunding it would let a Basic user replay one posting that trips the
  // safety classifier forever, burning tokens without ever using the cap.
  it("does not refund a failure raised after Claude already returned (and billed)", async () => {
    await releaseAiCallOnFailure("user-1", "BASIC", await refusalError());

    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("swallows a failing refund so it can't replace the original error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.user.updateMany.mockRejectedValueOnce(new Error("connection reset"));

    // Callers run this from a catch block on their way to re-throwing the real
    // AI failure — a rejection here would mask it (e.g. turning a 422 into a 500).
    await expect(
      releaseAiCallOnFailure("user-1", "BASIC", new Error("s3 read failed"))
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
