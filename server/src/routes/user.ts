import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import {
  CAREER_SPECIALIZATION_LABELS,
  CAREER_SPECIALIZATION_VALUES,
  isCareerSpecialization,
} from "../lib/careerSpecializations";

const router = Router();

/** The public shape of a user's settings — never leaks firebaseUid. */
function serializeUser(user: {
  id: string;
  email: string;
  careerSpecialization: string;
}) {
  return {
    id: user.id,
    email: user.email,
    careerSpecialization: user.careerSpecialization,
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
      user: serializeUser(req.user!),
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

    res.json({ user: serializeUser(user) });
  })
);

export default router;
