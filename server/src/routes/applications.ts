import { Router, type Request, type Response } from "express";
import { ApplicationStatus, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { getLatestBaseResume } from "../lib/baseResume";
import { createInFlightGuard } from "../lib/inFlight";
import {
  isNonEmptyString,
  isNullableString,
  isValidHttpUrl,
  parseNullableDate,
} from "../lib/validation";
import { parseContactFields } from "../lib/contactInput";
import { getObjectText } from "../lib/s3";
import {
  generateResumeTips,
  jobPostingFingerprint,
} from "../services/resumeTips";
import { scrapeLinkedInProfile } from "../services/linkedProfileScraper";

const router = Router();

const VALID_STATUSES = Object.values(ApplicationStatus);

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return (
    typeof value === "string" &&
    (VALID_STATUSES as readonly string[]).includes(value)
  );
}

const applicationInclude = {
  jobPosting: { include: { company: true } },
  followUps: { orderBy: { followUpDate: "asc" as const } },
  questions: { orderBy: { createdAt: "asc" as const } },
  contacts: { orderBy: { createdAt: "asc" as const } },
};

// The list/dashboard views never render questions (they can carry multi-
// paragraph AI answers), so the list endpoint skips that join and payload.
const applicationListInclude = {
  jobPosting: applicationInclude.jobPosting,
  followUps: applicationInclude.followUps,
};

/**
 * GET /api/applications
 * List all applications for the current user, newest first.
 */
router.get(
  "/",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const applications = await prisma.application.findMany({
      where: { userId: req.user!.id },
      include: applicationListInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json({ applications });
  })
);

/**
 * GET /api/applications/:id
 */
router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: applicationInclude,
    });

    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    res.json({ application });
  })
);

/**
 * POST /api/applications
 * Track a discovered job posting. If already tracked, returns the existing
 * application instead of creating a duplicate.
 */
router.post(
  "/",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobPostingId, status, source } = req.body ?? {};

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

    if (!isNullableString(source)) {
      res.status(400).json({ error: "`source` must be a string or null." });
      return;
    }

    // Postings are per-user; treat another user's posting as nonexistent.
    const [jobPosting, existing] = await Promise.all([
      prisma.jobPosting.findFirst({
        where: { id: jobPostingId, userId: req.user!.id },
      }),
      prisma.application.findFirst({
        where: { userId: req.user!.id, jobPostingId },
        include: applicationInclude,
      }),
    ]);

    if (!jobPosting) {
      res.status(404).json({ error: "Job posting not found." });
      return;
    }

    if (existing) {
      res.status(200).json({ application: existing, alreadyTracked: true });
      return;
    }

    const application = await prisma.application.create({
      data: {
        userId: req.user!.id,
        jobPostingId,
        ...(status ? { status } : {}),
        ...(status === ApplicationStatus.APPLIED
          ? { appliedDate: new Date() }
          : {}),
        ...(isNonEmptyString(source) ? { source: source.trim() } : {}),
      },
      include: applicationInclude,
    });

    res.status(201).json({ application });
  })
);

/**
 * PATCH /api/applications/:id
 * Update status, notes, source and/or appliedDate.
 */
router.patch(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { status, notes, source, appliedDate } = req.body ?? {};
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

    if (source !== undefined) {
      if (!isNullableString(source)) {
        res.status(400).json({ error: "`source` must be a string or null." });
        return;
      }
      data.source = source === null ? null : source.trim() || null;
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

    const existing = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    // Moving to APPLIED stamps the applied date the first time; an explicit
    // appliedDate in the same request or one set earlier always wins.
    if (
      data.status === ApplicationStatus.APPLIED &&
      data.appliedDate === undefined &&
      existing.appliedDate === null
    ) {
      data.appliedDate = new Date();
    }

    const application = await prisma.application.update({
      where: { id: existing.id },
      data,
      include: applicationInclude,
    });

    res.json({ application });
  })
);

/**
 * DELETE /api/applications/:id
 * Follow-ups and any saved resume analysis are removed by ON DELETE CASCADE.
 */
router.delete(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    await prisma.application.delete({ where: { id: existing.id } });
    res.status(204).end();
  })
);

/**
 * Loads everything the resume-tips endpoints need: the application (with
 * posting + company), the saved analysis if any, the user's latest resume,
 * and whether the saved analysis is still current for that resume + posting.
 */
async function loadResumeTipsContext(userId: string, applicationId: string) {
  const [application, baseResume] = await Promise.all([
    prisma.application.findFirst({
      where: { id: applicationId, userId },
      include: {
        jobPosting: { include: { company: true } },
        resumeAnalysis: true,
      },
    }),
    getLatestBaseResume(userId),
  ]);

  if (!application) return null;

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

// Applications with a resume-tips generation currently running. Guards the
// check-then-act window between the staleness read and the upsert
// (see lib/inFlight.ts).
const generationsInFlight = createInFlightGuard();

/**
 * GET /api/applications/:id/resume-tips
 * Returns the saved analysis (if any) plus whether it's still current —
 * the client uses `upToDate` to disable the regenerate button.
 */
router.get(
  "/:id/resume-tips",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

/**
 * POST /api/applications/:id/resume-tips
 * Generates (or regenerates) the analysis. Refused with 409 while the saved
 * analysis is still current — a re-run is only allowed once the resume or
 * the posting's content has changed — or while a generation is in flight.
 */
router.post(
  "/:id/resume-tips",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
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

    if (!generationsInFlight.tryAcquire(ctx.application.id)) {
      res.status(409).json({
        error: "An analysis is already being generated for this application.",
        analysis: ctx.analysis ?? null,
        upToDate: false,
      });
      return;
    }

    try {
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
    } finally {
      generationsInFlight.release(ctx.application.id);
    }
  })
);

/**
 * POST /api/applications/:id/questions
 * Add a question from the application form. Answering (by hand or AI) happens
 * through the /api/questions routes.
 */
router.post(
  "/:id/questions",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { question } = req.body ?? {};

    if (!isNonEmptyString(question)) {
      res.status(400).json({ error: "`question` is required." });
      return;
    }

    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    const created = await prisma.applicationQuestion.create({
      data: { applicationId: application.id, question: question.trim() },
    });

    res.status(201).json({ question: created });
  })
);

/**
 * POST /api/applications/:id/contacts
 * Add a person the user is in contact with about this application. Edits and
 * removal happen through the /api/contacts routes.
 */
router.post(
  "/:id/contacts",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseContactFields(req.body ?? {});

    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { name, ...optionalFields } = parsed.data;
    if (name === undefined) {
      res.status(400).json({ error: "`name` is required." });
      return;
    }

    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    const contact = await prisma.contact.create({
      data: { applicationId: application.id, name, ...optionalFields },
    });

    res.status(201).json({ contact });
  })
);

// At most one scrape runs at a time (t4g.micro has 1GB RAM — a single
// headless Chromium instance is the budget). A second request while one is
// in flight is refused rather than queued, so the caller can just retry.
const linkedinScrapesInFlight = createInFlightGuard();

/**
 * POST /api/applications/:id/scrape-linkedin
 * Creates a new contact for this application from a LinkedIn profile URL.
 * The contact is created immediately (scrapedStatus PENDING, placeholder
 * name) so it shows up in the list right away; the scrape itself runs
 * without blocking the response and updates the same row to DONE (with the
 * scraped name/position) or FAILED once it resolves.
 */
router.post(
  "/:id/scrape-linkedin",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { linkedinUrl } = req.body ?? {};

    if (!isNonEmptyString(linkedinUrl) || !isValidHttpUrl(linkedinUrl)) {
      res.status(400).json({ error: "`linkedinUrl` must be a valid http(s) URL." });
      return;
    }

    const application = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    if (!linkedinScrapesInFlight.tryAcquire("linkedin-scrape")) {
      res.status(409).json({
        error: "A LinkedIn scrape is already running. Try again in a moment.",
      });
      return;
    }

    const trimmedUrl = linkedinUrl.trim();

    let contact;
    try {
      contact = await prisma.contact.create({
        data: {
          applicationId: application.id,
          name: "New contact",
          linkedinUrl: trimmedUrl,
          scrapedStatus: "PENDING",
        },
      });
    } catch (err) {
      linkedinScrapesInFlight.release("linkedin-scrape");
      throw err;
    }

    scrapeLinkedInProfile(trimmedUrl)
      .then((scraped) =>
        prisma.contact.update({
          where: { id: contact!.id },
          data: {
            name: scraped.name ?? contact!.name,
            position: scraped.position,
            scrapedStatus: "DONE",
            scrapedAt: new Date(),
          },
        })
      )
      .catch((err) => {
        console.error(`LinkedIn scrape failed for contact ${contact!.id}:`, err);
        return prisma.contact.update({
          where: { id: contact!.id },
          data: { scrapedStatus: "FAILED" },
        });
      })
      .finally(() => linkedinScrapesInFlight.release("linkedin-scrape"));

    res.status(201).json({ contact });
  })
);

/**
 * POST /api/applications/:id/follow-ups
 */
router.post(
  "/:id/follow-ups",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

export default router;
