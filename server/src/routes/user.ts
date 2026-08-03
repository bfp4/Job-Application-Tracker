import { Router, type Request, type Response } from "express";
import { Prisma, type User } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { DAILY_BASIC_LIMIT, effectiveAiCallsUsedToday } from "../middleware/quota";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { isNonEmptyString } from "../lib/validation";
import {
  CAREER_SPECIALIZATION_LABELS,
  CAREER_SPECIALIZATION_VALUES,
  isCareerSpecialization,
} from "../lib/careerSpecializations";

const router = Router();

/**
 * Cap on a premium request's message. Without one the only bound is
 * express.json()'s 100kb default, and the admin console renders these verbatim
 * with `whitespace-pre-wrap` — one 100KB submission would push every other
 * pending request off the page. Generous for the few sentences the form asks
 * for; the client's textarea carries the same limit so the user sees it first.
 */
export const PREMIUM_REQUEST_MESSAGE_MAX = 2000;

/** The public shape of a user's settings — never leaks firebaseUid. */
async function serializeUser(user: User) {
  const usedToday = effectiveAiCallsUsedToday(user);
  const pending = await prisma.premiumRequest.findFirst({
    where: { userId: user.id, status: "PENDING" },
    select: { id: true },
  });

  return {
    id: user.id,
    email: user.email,
    careerSpecialization: user.careerSpecialization,
    tier: user.tier,
    aiCallsUsedToday: usedToday,
    aiCallsRemaining: user.tier === "BASIC" ? Math.max(0, DAILY_BASIC_LIMIT - usedToday) : null,
    pendingPremiumRequest: Boolean(pending),
  };
}

/** The specialization options the Settings dropdown renders (value + label). */
const specializationOptions = CAREER_SPECIALIZATION_VALUES.map((value) => ({
  value,
  label: CAREER_SPECIALIZATION_LABELS[value],
}));

/**
 * GET /api/user/me
 * Returns the current user's settings plus the available specialization
 * options, so the client doesn't hard-code the enum.
 */
router.get(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      user: await serializeUser(req.user!),
      specializationOptions,
    });
  })
);

/**
 * PATCH /api/user/me
 * Updates the current user's settings. Only careerSpecialization is editable.
 */
router.patch(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { careerSpecialization } = req.body ?? {};

    if (!isCareerSpecialization(careerSpecialization)) {
      res.status(400).json({
        error: `\`careerSpecialization\` must be one of: ${CAREER_SPECIALIZATION_VALUES.join(", ")}.`,
      });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { careerSpecialization },
    });

    res.json({ user: await serializeUser(user) });
  })
);

/**
 * POST /api/user/premium-requests
 * Submits a request to be upgraded to PREMIUM, with a short message the
 * admin sees on the admin page. Refused if the user is already
 * PREMIUM/ADMIN, or already has an unresolved request.
 */
router.post(
  "/premium-requests",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { message } = req.body ?? {};
    if (!isNonEmptyString(message)) {
      res.status(400).json({ error: "`message` must be a non-empty string." });
      return;
    }

    if (message.trim().length > PREMIUM_REQUEST_MESSAGE_MAX) {
      res.status(400).json({
        error: `\`message\` must be ${PREMIUM_REQUEST_MESSAGE_MAX} characters or fewer.`,
      });
      return;
    }

    if (req.user!.tier !== "BASIC") {
      res.status(409).json({ error: "You already have premium access." });
      return;
    }

    // Fast, friendly check for the common (non-race) case. The authoritative
    // guard is the partial unique index on (userId) WHERE status = 'PENDING'
    // (see schema.prisma comment above the PremiumRequest model) — caught
    // below — since a double-submit (e.g. two tabs) could otherwise slip
    // both requests past this read before either creates its row.
    const existingPending = await prisma.premiumRequest.findFirst({
      where: { userId: req.user!.id, status: "PENDING" },
    });
    if (existingPending) {
      res.status(409).json({ error: "You already have a pending premium request." });
      return;
    }

    try {
      await prisma.premiumRequest.create({
        data: { userId: req.user!.id, message: message.trim() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "You already have a pending premium request." });
        return;
      }
      throw err;
    }

    res.status(201).json({ user: await serializeUser(req.user!) });
  })
);

export default router;
