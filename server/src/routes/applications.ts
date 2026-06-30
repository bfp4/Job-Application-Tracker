import { Router, type Request, type Response } from "express";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { createManualJobPosting } from "../services/jobIngestion";

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

function isOptionalString(value: unknown): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string"
  );
}

interface ManualApplicationInput {
  companyName: string;
  title: string;
  jobUrl?: string | null;
  location?: string | null;
  description?: string | null;
  status?: ApplicationStatus;
  appliedDate?: Date | null;
  notes?: string | null;
}

async function createManualApplicationForUser(
  userId: string,
  input: ManualApplicationInput
) {
  const jobPosting = await createManualJobPosting({
    companyName: input.companyName,
    title: input.title,
    jobUrl: input.jobUrl,
    location: input.location,
    description: input.description,
  });

  const existing = await prisma.application.findFirst({
    where: { userId, jobPostingId: jobPosting.id },
    include: { jobPosting: true, company: true },
  });

  if (existing) {
    return { application: existing, alreadyTracked: true as const };
  }

  const application = await prisma.application.create({
    data: {
      userId,
      jobPostingId: jobPosting.id,
      companyId: jobPosting.companyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.appliedDate !== undefined
        ? { appliedDate: input.appliedDate }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: { jobPosting: true, company: true },
  });

  return { application, alreadyTracked: false as const };
}

const MAX_IMPORT_JOBS = 200;

/**
 * POST /api/applications
 * Create an application from a jobPostingId or from manual job details.
 * If the user already tracks an existing posting, the existing application
 * is returned instead of creating a duplicate.
 */
router.post("/", authenticate, async (req: Request, res: Response) => {
  const {
    jobPostingId,
    status,
    companyName,
    title,
    jobUrl,
    location,
    description,
    appliedDate,
    notes,
  } = req.body ?? {};

  if (status !== undefined && !isApplicationStatus(status)) {
    res.status(400).json({
      error: `\`status\` must be one of: ${VALID_STATUSES.join(", ")}.`,
    });
    return;
  }

  const hasJobPostingId =
    typeof jobPostingId === "string" && jobPostingId.trim() !== "";
  const hasManualFields =
    typeof companyName === "string" &&
    companyName.trim() !== "" &&
    typeof title === "string" &&
    title.trim() !== "";

  if (hasJobPostingId && hasManualFields) {
    res.status(400).json({
      error: "Provide either `jobPostingId` or manual job fields, not both.",
    });
    return;
  }

  if (!hasJobPostingId && !hasManualFields) {
    res.status(400).json({
      error:
        "Provide `jobPostingId`, or `companyName` and `title` for manual entry.",
    });
    return;
  }

  if (!isOptionalString(notes)) {
    res.status(400).json({ error: "`notes` must be a string or null." });
    return;
  }

  if (
    hasManualFields &&
    (!isOptionalString(jobUrl) ||
      !isOptionalString(location) ||
      !isOptionalString(description))
  ) {
    res.status(400).json({
      error: "`jobUrl`, `location`, and `description` must be strings or null.",
    });
    return;
  }

  let parsedAppliedDate: Date | null | undefined;
  if (appliedDate !== undefined) {
    parsedAppliedDate = parseNullableDate(appliedDate);
    if (parsedAppliedDate === undefined) {
      res
        .status(400)
        .json({ error: "`appliedDate` must be a valid date or null." });
      return;
    }
  }

  try {
    let resolvedJobPostingId: string;
    let jobPostingCompanyId: string;

    if (hasJobPostingId) {
      const jobPosting = await prisma.jobPosting.findUnique({
        where: { id: jobPostingId },
      });

      if (!jobPosting) {
        res.status(404).json({ error: "Job posting not found." });
        return;
      }

      resolvedJobPostingId = jobPosting.id;
      jobPostingCompanyId = jobPosting.companyId;
    } else {
      const result = await createManualApplicationForUser(req.user!.id, {
        companyName,
        title,
        jobUrl,
        location,
        description,
        status,
        appliedDate: parsedAppliedDate,
        notes,
      });

      if (result.alreadyTracked) {
        res
          .status(200)
          .json({ application: result.application, alreadyTracked: true });
        return;
      }

      res.status(201).json({ application: result.application });
      return;
    }

    const existing = await prisma.application.findFirst({
      where: { userId: req.user!.id, jobPostingId: resolvedJobPostingId },
      include: { jobPosting: true, company: true },
    });

    if (existing) {
      res.status(200).json({ application: existing, alreadyTracked: true });
      return;
    }

    const application = await prisma.application.create({
      data: {
        userId: req.user!.id,
        jobPostingId: resolvedJobPostingId,
        companyId: jobPostingCompanyId,
        ...(status ? { status } : {}),
        ...(parsedAppliedDate !== undefined ? { appliedDate: parsedAppliedDate } : {}),
        ...(notes !== undefined ? { notes } : {}),
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
 * POST /api/applications/import
 * Bulk-create applications from manually entered job rows (e.g. parsed CSV).
 */
router.post("/import", authenticate, async (req: Request, res: Response) => {
  const { jobs } = req.body ?? {};

  if (!Array.isArray(jobs)) {
    res.status(400).json({ error: "`jobs` must be an array." });
    return;
  }

  if (jobs.length === 0) {
    res.status(400).json({ error: "Provide at least one job to import." });
    return;
  }

  if (jobs.length > MAX_IMPORT_JOBS) {
    res.status(400).json({
      error: `Import up to ${MAX_IMPORT_JOBS} jobs at a time.`,
    });
    return;
  }

  const created: Awaited<
    ReturnType<typeof createManualApplicationForUser>
  >["application"][] = [];
  const failed: { row: number; error: string }[] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    const rowNumber = index + 1;
    const job = jobs[index] ?? {};
    const {
      companyName,
      title,
      jobUrl,
      location,
      description,
      status,
      appliedDate,
      notes,
    } = job;

    if (typeof companyName !== "string" || companyName.trim() === "") {
      failed.push({ row: rowNumber, error: "companyName is required." });
      continue;
    }
    if (typeof title !== "string" || title.trim() === "") {
      failed.push({ row: rowNumber, error: "title is required." });
      continue;
    }
    if (
      !isOptionalString(jobUrl) ||
      !isOptionalString(location) ||
      !isOptionalString(description) ||
      !isOptionalString(notes)
    ) {
      failed.push({
        row: rowNumber,
        error: "Optional text fields must be strings or null.",
      });
      continue;
    }
    if (status !== undefined && !isApplicationStatus(status)) {
      failed.push({ row: rowNumber, error: "Invalid status." });
      continue;
    }

    let parsedAppliedDate: Date | null | undefined;
    if (appliedDate !== undefined) {
      parsedAppliedDate = parseNullableDate(appliedDate);
      if (parsedAppliedDate === undefined) {
        failed.push({ row: rowNumber, error: "Invalid appliedDate." });
        continue;
      }
    }

    try {
      const result = await createManualApplicationForUser(req.user!.id, {
        companyName,
        title,
        jobUrl,
        location,
        description,
        status,
        appliedDate: parsedAppliedDate,
        notes,
      });
      if (!result.alreadyTracked) {
        created.push(result.application);
      }
    } catch (err) {
      console.error(`Failed to import job row ${rowNumber}:`, err);
      failed.push({ row: rowNumber, error: "Failed to create application." });
    }
  }

  res.status(failed.length === jobs.length ? 400 : 201).json({
    created,
    failed,
    summary: {
      total: jobs.length,
      created: created.length,
      failed: failed.length,
    },
  });
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
