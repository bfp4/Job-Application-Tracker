import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

const STRING_FIELDS = ["name", "role", "email", "linkedinUrl", "notes"] as const;
type StringField = (typeof STRING_FIELDS)[number];

/**
 * PATCH /api/contacts/:id
 * Edit a contact owned by the current user.
 */
router.patch("/:id", authenticate, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const data: Prisma.ContactUpdateInput = {};

  for (const field of STRING_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;

    if (field === "name") {
      if (typeof value !== "string" || value.trim() === "") {
        res
          .status(400)
          .json({ error: "`name` must be a non-empty string." });
        return;
      }
      data.name = value.trim();
      continue;
    }

    if (value !== null && typeof value !== "string") {
      res
        .status(400)
        .json({ error: `\`${field}\` must be a string or null.` });
      return;
    }
    data[field as Exclude<StringField, "name">] = value as string | null;
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "No valid fields provided to update." });
    return;
  }

  try {
    const existing = await prisma.contact.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data,
    });

    res.json({ contact });
  } catch (err) {
    console.error("Failed to update contact:", err);
    res.status(500).json({ error: "Failed to update contact." });
  }
});

/**
 * DELETE /api/contacts/:id
 */
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.contact.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    await prisma.contact.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    console.error("Failed to delete contact:", err);
    res.status(500).json({ error: "Failed to delete contact." });
  }
});

export default router;
