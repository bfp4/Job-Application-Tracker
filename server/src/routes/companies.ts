import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

function optionalString(value: unknown): value is string | undefined | null {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * GET /api/companies/:id/contacts
 * List the current user's contacts for a company.
 */
router.get(
  "/:id/contacts",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const company = await prisma.company.findUnique({
        where: { id: req.params.id },
      });

      if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
      }

      const contacts = await prisma.contact.findMany({
        where: { companyId: company.id, userId: req.user!.id },
        orderBy: { name: "asc" },
      });

      res.json({ contacts });
    } catch (err) {
      console.error("Failed to list contacts:", err);
      res.status(500).json({ error: "Failed to list contacts." });
    }
  }
);

/**
 * POST /api/companies/:id/contacts
 * Add a contact for a company, owned by the current user.
 */
router.post(
  "/:id/contacts",
  authenticate,
  async (req: Request, res: Response) => {
    const { name, role, email, linkedinUrl, notes } = req.body ?? {};

    if (typeof name !== "string" || name.trim() === "") {
      res
        .status(400)
        .json({ error: "`name` is required and must be a string." });
      return;
    }

    if (
      !optionalString(role) ||
      !optionalString(email) ||
      !optionalString(linkedinUrl) ||
      !optionalString(notes)
    ) {
      res.status(400).json({
        error: "`role`, `email`, `linkedinUrl` and `notes` must be strings.",
      });
      return;
    }

    try {
      const company = await prisma.company.findUnique({
        where: { id: req.params.id },
      });

      if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
      }

      const contact = await prisma.contact.create({
        data: {
          companyId: company.id,
          userId: req.user!.id,
          name: name.trim(),
          role: role ?? null,
          email: email ?? null,
          linkedinUrl: linkedinUrl ?? null,
          notes: notes ?? null,
        },
      });

      res.status(201).json({ contact });
    } catch (err) {
      console.error("Failed to create contact:", err);
      res.status(500).json({ error: "Failed to create contact." });
    }
  }
);

export default router;
