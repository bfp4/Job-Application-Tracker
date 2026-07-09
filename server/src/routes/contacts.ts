import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { parseContactFields } from "../lib/contactInput";

const router = Router();

/**
 * PATCH /api/contacts/:id
 * Edit any subset of a contact's fields. Ownership is enforced through the
 * parent application's userId. Creation happens through
 * POST /api/applications/:id/contacts.
 */
router.patch(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseContactFields(req.body ?? {});

    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "No valid fields provided to update." });
      return;
    }

    const existing = await prisma.contact.findFirst({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (!existing) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: parsed.data,
    });

    res.json({ contact: updated });
  })
);

/**
 * DELETE /api/contacts/:id
 */
router.delete(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // deleteMany so the ownership filter and the delete are one round-trip;
    // count 0 means not found (or not this user's), either way a 404.
    const { count } = await prisma.contact.deleteMany({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (count === 0) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    res.status(204).end();
  })
);

export default router;
