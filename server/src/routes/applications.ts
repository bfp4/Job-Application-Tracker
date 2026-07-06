import { Router, type Request, type Response } from "express";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { getObjectText } from "../lib/s3";
import {
  generateResumeTips,
  jobPostingFingerprint,
} from "../services/resumeTips";

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

const applicationInclude = {
  jobPosting: { include: { company: true } },
  followUps: { orderBy: { followUpDate: "asc" as const } },
};

/**
 * GET /api/applications
 * List all applications for the current user, newest first.
 */
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const applications = await prisma.application.findMany({
      where: { userId: req.user!.id },
      include: applicationInclude,
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
 */
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: applicationInclude,
    });

    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    res.json({ application });
  } catch (err) {
    console.error("Failed to fetch application:", err);
    res.status(500).json({ error: "Failed to fetch application." });
  }
});

/**
 * POST /api/applications
 * Track a discovered job posting. If already tracked, returns the existing
 * application instead of creating a duplicate.
 */
router.post("/", authenticate, async (req: Request, res: Response) => {
  const { jobPostingId, status } = req.body ?? {};

  if (typeof jobPostingId !== "string" || jobPostingId.trim() === "") {
    res.status(400).json({ error: "`jobPostingId` is required." });
    return;
  }

  if (status !== undefined && !isApplicationStatus(status)) {
    res.status(400).json({
      error: `\`status\` must be one of: ${VALID_STATUSES.join(", ")}.`,
    });
    return;
  }

  try {
    // Postings are per-user; treat another user's posting as nonexistent.
    const jobPosting = await prisma.jobPosting.findFirst({
      where: { id: jobPostingId, userId: req.user!.id },
    });

    if (!jobPosting) {
      res.status(404).json({ error: "Job posting not found." });
      return;
    }

    const existing = await prisma.application.findFirst({
      where: { userId: req.user!.id, jobPostingId },
      include: applicationInclude,
    });

    if (existing) {
      res.status(200).json({ application: existing, alreadyTracked: true });
      return;
    }

    const application = await prisma.application.create({
      data: {
        userId: req.user!.id,
        jobPostingId,
        ...(status ? { status } : {}),
      },
      include: applicationInclude,
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
      res.status(400).json({ error: "`appliedDate` must be a valid date or null." });
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
      include: applicationInclude,
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
 * Loads everything the resume-tips endpoints need: the application (with
 * posting + company), the saved analysis if any, the user's latest resume,
 * and whether the saved analysis is still current for that resume + posting.
 */
async function loadResumeTipsContext(userId: string, applicationId: string) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      jobPosting: { include: { company: true } },
      resumeAnalysis: true,
    },
  });

  if (!application) return null;

  const baseResume = await prisma.baseResume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const currentHash = jobPostingFingerprint(application.jobPosting);
  const analysis = application.resumeAnalysis;
  const upToDate = Boolean(
    analysis &&
      baseResume &&
      analysis.baseResumeId === baseResume.id &&
      analysis.jobPostingHash === currentHash
  );

  return { application, analysis, baseResume, currentHash, upToDate };
}

/**
 * GET /api/applications/:id/resume-tips
 * Returns the saved analysis (if any) plus whether it's still current —
 * the client uses `upToDate` to disable the regenerate button.
 */
router.get("/:id/resume-tips", authenticate, async (req: Request, res: Response) => {
  try {
    const ctx = await loadResumeTipsContext(req.user!.id, req.params.id);
    if (!ctx) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    res.json({
      analysis: ctx.analysis ?? null,
      upToDate: ctx.upToDate,
      hasResume: Boolean(ctx.baseResume),
    });
  } catch (err) {
    console.error("Failed to fetch resume tips:", err);
    res.status(500).json({ error: "Failed to fetch resume tips." });
  }
});

/**
 * POST /api/applications/:id/resume-tips
 * Generates (or regenerates) the analysis. Refused with 409 while the saved
 * analysis is still current — a re-run is only allowed once the resume or
 * the posting's content has changed.
 */
router.post("/:id/resume-tips", authenticate, async (req: Request, res: Response) => {
  try {
    const ctx = await loadResumeTipsContext(req.user!.id, req.params.id);
    if (!ctx) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    if (!ctx.baseResume) {
      res.status(400).json({
        error: "Upload a resume in Settings before generating tips.",
      });
      return;
    }

    if (ctx.upToDate) {
      res.status(409).json({
        error:
          "This analysis is already up to date. Update your resume or the job posting to run a new one.",
        analysis: ctx.analysis,
        upToDate: true,
      });
      return;
    }

    const resumeMarkdown = await getObjectText(ctx.baseResume.markdownS3Key);
    const content = await generateResumeTips(
      resumeMarkdown,
      ctx.application.jobPosting
    );

    const analysis = await prisma.resumeAnalysis.upsert({
      where: { applicationId: ctx.application.id },
      update: {
        baseResumeId: ctx.baseResume.id,
        jobPostingHash: ctx.currentHash,
        content: content as unknown as Prisma.InputJsonValue,
      },
      create: {
        applicationId: ctx.application.id,
        baseResumeId: ctx.baseResume.id,
        jobPostingHash: ctx.currentHash,
        content: content as unknown as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({ analysis, upToDate: true, hasResume: true });
  } catch (err) {
    console.error("Failed to generate resume tips:", err);
    res.status(500).json({ error: "Failed to generate resume tips." });
  }
});

/**
 * POST /api/applications/:id/follow-ups
 */
router.post("/:id/follow-ups", authenticate, async (req: Request, res: Response) => {
  const { followUpDate, note } = req.body ?? {};

  const parsedDate = parseNullableDate(followUpDate);
  if (parsedDate === undefined || parsedDate === null) {
    res.status(400).json({ error: "`followUpDate` is required and must be a valid date." });
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
});

export default router;
