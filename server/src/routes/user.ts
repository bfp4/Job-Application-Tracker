import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import {
  SPECIALIZATIONS,
  SPECIALIZATION_VALUES,
  isResumeSpecialization,
} from "../lib/resumeSpecializations";

const router = Router();

/** The public shape of a user's settings — never leaks firebaseUid. */
function serializeUser(user: {
  id: string;
  email: string;
  resumeSpecialization: string;
}) {
  return {
    id: user.id,
    email: user.email,
    resumeSpecialization: user.resumeSpecialization,
  };
}

/** The specialization options the Settings dropdown renders (value + label). */
const specializationOptions = SPECIALIZATION_VALUES.map((value) => ({
  value,
  label: SPECIALIZATIONS[value].label,
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
      user: serializeUser(req.user!),
      specializationOptions,
    });
  })
);

/**
 * PATCH /api/user/me
 * Updates the current user's settings. Only resumeSpecialization is editable.
 */
router.patch(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { resumeSpecialization } = req.body ?? {};

    if (!isResumeSpecialization(resumeSpecialization)) {
      res.status(400).json({
        error: `\`resumeSpecialization\` must be one of: ${SPECIALIZATION_VALUES.join(", ")}.`,
      });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { resumeSpecialization },
    });

    res.json({ user: serializeUser(user) });
  })
);

export default router;
