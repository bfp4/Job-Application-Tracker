import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { parseNullableDate } from "../lib/validation";

const router = Router();

/**
 * PATCH /api/follow-ups/:id
 * Toggle completed and/or edit the note/date. Ownership is enforced through
 * the parent application's userId.
 */
router.patch(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { completed, note, followUpDate } = req.body ?? {};
    const data: Prisma.FollowUpUpdateInput = {};

    if (completed !== undefined) {
      if (typeof completed !== "boolean") {
        res.status(400).json({ error: "`completed` must be a boolean." });
        return;
      }
      data.completed = completed;
    }

    if (note !== undefined) {
      if (note !== null && typeof note !== "string") {
        res.status(400).json({ error: "`note` must be a string or null." });
        return;
      }
      data.note = note;
    }

    if (followUpDate !== undefined) {
      const parsed = parseNullableDate(followUpDate);
      if (parsed === undefined || parsed === null) {
        res.status(400).json({ error: "`followUpDate` must be a valid date." });
        return;
      }
      data.followUpDate = parsed;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No valid fields provided to update." });
      return;
    }

    const followUp = await prisma.followUp.findFirst({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (!followUp) {
      res.status(404).json({ error: "Follow-up not found." });
      return;
    }

    const updated = await prisma.followUp.update({
      where: { id: followUp.id },
      data,
    });

    res.json({ followUp: updated });
  })
);

/**
 * DELETE /api/follow-ups/:id
 */
router.delete(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const followUp = await prisma.followUp.findFirst({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (!followUp) {
      res.status(404).json({ error: "Follow-up not found." });
      return;
    }

    await prisma.followUp.delete({ where: { id: followUp.id } });
    res.status(204).end();
  })
);

export default router;
