import { Router, type Request, type Response } from "express";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

const VALID_STATUSES = Object.values(ApplicationStatus);

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return (
    typeof value === "string" &&
    (VALID_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Parses a value into a Date or null. Returns `undefined` when the value is
 * present but not a valid date, so callers can reject invalid input.
 */
function parseNullableDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * GET /api/applications
 * List all applications for the current user, newest first.
 */
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const applications = await prisma.application.findMany({
      where: { userId: req.user!.id },
      include: {
        jobPosting: true,
        company: true,
        followUps: { orderBy: { followUpDate: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ applications });
  } catch (err) {
    console.error("Failed to list applications:", err);
    res.status(500).json({ error: "Failed to list applications." });
  }
});

/**
 * GET /api/applications/:id
 * Single application detail with company, contacts (for the company, owned by
 * the user) and follow-ups.
 */
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        jobPosting: true,
        company: true,
        followUps: { orderBy: { followUpDate: "asc" } },
      },
    });

    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    const contacts = await prisma.contact.findMany({
      where: { companyId: application.companyId, userId: req.user!.id },
      orderBy: { name: "asc" },
    });

    res.json({ application: { ...application, contacts } });
  } catch (err) {
    console.error("Failed to fetch application:", err);
    res.status(500).json({ error: "Failed to fetch application." });
  }
});

/**
 * POST /api/applications
 * Create an application from a jobPostingId. If the user already tracks this
 * posting, the existing application is returned instead of creating a duplicate.
 */
router.post("/", authenticate, async (req: Request, res: Response) => {
  const { jobPostingId, status } = req.body ?? {};

  if (typeof jobPostingId !== "string" || jobPostingId.trim() === "") {
    res
      .status(400)
      .json({ error: "`jobPostingId` is required and must be a string." });
    return;
  }

  if (status !== undefined && !isApplicationStatus(status)) {
    res.status(400).json({
      error: `\`status\` must be one of: ${VALID_STATUSES.join(", ")}.`,
    });
    return;
  }

  try {
    const jobPosting = await prisma.jobPosting.findUnique({
      where: { id: jobPostingId },
    });

    if (!jobPosting) {
      res.status(404).json({ error: "Job posting not found." });
      return;
    }

    const existing = await prisma.application.findFirst({
      where: { userId: req.user!.id, jobPostingId },
      include: { jobPosting: true, company: true },
    });

    if (existing) {
      res.status(200).json({ application: existing, alreadyTracked: true });
      return;
    }

    const application = await prisma.application.create({
      data: {
        userId: req.user!.id,
        jobPostingId,
        companyId: jobPosting.companyId,
        ...(status ? { status } : {}),
      },
      include: { jobPosting: true, company: true },
    });

    res.status(201).json({ application });
  } catch (err) {
    console.error("Failed to create application:", err);
    res.status(500).json({ error: "Failed to create application." });
  }
});

/**
 * PATCH /api/applications/:id
 * Update status, notes and/or appliedDate.
 */
router.patch("/:id", authenticate, async (req: Request, res: Response) => {
  const { status, notes, appliedDate } = req.body ?? {};
  const data: Prisma.ApplicationUpdateInput = {};

  if (status !== undefined) {
    if (!isApplicationStatus(status)) {
      res.status(400).json({
        error: `\`status\` must be one of: ${VALID_STATUSES.join(", ")}.`,
      });
      return;
    }
    data.status = status;
  }

  if (notes !== undefined) {
    if (notes !== null && typeof notes !== "string") {
      res.status(400).json({ error: "`notes` must be a string or null." });
      return;
    }
    data.notes = notes;
  }

  if (appliedDate !== undefined) {
    const parsed = parseNullableDate(appliedDate);
    if (parsed === undefined) {
      res
        .status(400)
        .json({ error: "`appliedDate` must be a valid date or null." });
      return;
    }
    data.appliedDate = parsed;
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "No valid fields provided to update." });
    return;
  }

  try {
    const existing = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    const application = await prisma.application.update({
      where: { id: existing.id },
      data,
      include: { jobPosting: true, company: true },
    });

    res.json({ application });
  } catch (err) {
    console.error("Failed to update application:", err);
    res.status(500).json({ error: "Failed to update application." });
  }
});

/**
 * DELETE /api/applications/:id
 */
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const existing = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    await prisma.application.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    console.error("Failed to delete application:", err);
    res.status(500).json({ error: "Failed to delete application." });
  }
});

/**
 * POST /api/applications/:id/follow-ups
 * Add a follow-up to an application owned by the current user.
 */
router.post(
  "/:id/follow-ups",
  authenticate,
  async (req: Request, res: Response) => {
    const { followUpDate, note } = req.body ?? {};

    const parsedDate = parseNullableDate(followUpDate);
    if (parsedDate === undefined || parsedDate === null) {
      res
        .status(400)
        .json({ error: "`followUpDate` is required and must be a valid date." });
      return;
    }

    if (note !== undefined && note !== null && typeof note !== "string") {
      res.status(400).json({ error: "`note` must be a string or null." });
      return;
    }

    try {
      const application = await prisma.application.findFirst({
        where: { id: req.params.id, userId: req.user!.id },
      });

      if (!application) {
        res.status(404).json({ error: "Application not found." });
        return;
      }

      const followUp = await prisma.followUp.create({
        data: {
          applicationId: application.id,
          followUpDate: parsedDate,
          note: note ?? null,
        },
      });

      res.status(201).json({ followUp });
    } catch (err) {
      console.error("Failed to create follow-up:", err);
      res.status(500).json({ error: "Failed to create follow-up." });
    }
  }
);

export default router;
