import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/auth/auth";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../lib/http/http";
import { parseNullableDate } from "../../lib/validation";

const router = Router();

/**
 * PATCH /api/timeline-entries/:id
 * Edit a stage's note and/or the date it happened. Status isn't editable here
 * — if it's wrong, delete the entry and add a correct one. Ownership is
 * enforced through the parent application's userId.
 */
router.patch(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { note, occurredAt } = req.body ?? {};
    const data: Prisma.TimelineEntryUpdateInput = {};

    if (note !== undefined) {
      if (note !== null && typeof note !== "string") {
        res.status(400).json({ error: "`note` must be a string or null." });
        return;
      }
      data.note = note;
    }

    if (occurredAt !== undefined) {
      const parsed = parseNullableDate(occurredAt);
      if (parsed === undefined || parsed === null) {
        res.status(400).json({ error: "`occurredAt` must be a valid date." });
        return;
      }
      data.occurredAt = parsed;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No valid fields provided to update." });
      return;
    }

    const entry = await prisma.timelineEntry.findFirst({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (!entry) {
      res.status(404).json({ error: "Timeline entry not found." });
      return;
    }

    const updated = await prisma.timelineEntry.update({
      where: { id: entry.id },
      data,
    });

    res.json({ timelineEntry: updated });
  })
);

/**
 * DELETE /api/timeline-entries/:id
 */
router.delete(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const entry = await prisma.timelineEntry.findFirst({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (!entry) {
      res.status(404).json({ error: "Timeline entry not found." });
      return;
    }

    await prisma.timelineEntry.delete({ where: { id: entry.id } });
    res.status(204).end();
  })
);

export default router;
