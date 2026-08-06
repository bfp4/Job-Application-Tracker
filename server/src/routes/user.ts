import { Router, type Request, type Response } from "express";
import { Prisma, type CareerSpecialization, type User } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { DAILY_BASIC_LIMIT, effectiveAiCallsUsedToday } from "../middleware/quota";
import { prisma } from "../lib/prisma";
import { adminAuth } from "../lib/firebaseAdmin";
import { deleteObjects, getObjectText } from "../lib/s3";
import { asyncHandler } from "../lib/http";
import { isNonEmptyString } from "../lib/validation";
import {
  CAREER_SPECIALIZATION_LABELS,
  CAREER_SPECIALIZATION_VALUES,
  isCareerSpecialization,
} from "../lib/careerSpecializations";

const router = Router();

/**
 * Cap on a premium request's message. Without one the only bound is
 * express.json()'s 100kb default, and the admin console renders these verbatim
 * with `whitespace-pre-wrap` — one 100KB submission would push every other
 * pending request off the page. Generous for the few sentences the form asks
 * for; the client's textarea carries the same limit so the user sees it first.
 */
export const PREMIUM_REQUEST_MESSAGE_MAX = 2000;

/** The public shape of a user's settings — never leaks firebaseUid. */
async function serializeUser(user: User) {
  const usedToday = effectiveAiCallsUsedToday(user);
  const pending = await prisma.premiumRequest.findFirst({
    where: { userId: user.id, status: "PENDING" },
    select: { id: true },
  });

  return {
    id: user.id,
    email: user.email,
    careerSpecialization: user.careerSpecialization,
    tier: user.tier,
    aiCallsUsedToday: usedToday,
    aiCallsRemaining: user.tier === "BASIC" ? Math.max(0, DAILY_BASIC_LIMIT - usedToday) : null,
    pendingPremiumRequest: Boolean(pending),
    // Surfaced so Settings can render the reminder-email toggle in the right
    // position for a user who opted out from the email footer instead.
    // unsubscribeToken is deliberately NOT serialized — it is a bearer
    // credential for an unauthenticated route, and the UI has no use for it.
    emailOptOut: user.emailOptOut,
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
      user: await serializeUser(req.user!),
      specializationOptions,
    });
  })
);

/**
 * PATCH /api/user/me
 * Updates the current user's settings. Two editable fields —
 * careerSpecialization and emailOptOut — both optional, so the Settings page
 * can send whichever one the user just changed.
 *
 * An empty patch is rejected rather than treated as a no-op: it always means
 * the client sent a field name this route doesn't know, and answering 200 to
 * that would report a save that never happened.
 */
router.patch(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { careerSpecialization, emailOptOut } = req.body ?? {};
    const data: { careerSpecialization?: CareerSpecialization; emailOptOut?: boolean } = {};

    if (careerSpecialization !== undefined) {
      if (!isCareerSpecialization(careerSpecialization)) {
        res.status(400).json({
          error: `\`careerSpecialization\` must be one of: ${CAREER_SPECIALIZATION_VALUES.join(", ")}.`,
        });
        return;
      }
      data.careerSpecialization = careerSpecialization;
    }

    if (emailOptOut !== undefined) {
      if (typeof emailOptOut !== "boolean") {
        res.status(400).json({ error: "`emailOptOut` must be a boolean." });
        return;
      }
      data.emailOptOut = emailOptOut;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({
        error: "Provide `careerSpecialization` and/or `emailOptOut`.",
      });
      return;
    }

    const user = await prisma.user.update({ where: { id: req.user!.id }, data });

    res.json({ user: await serializeUser(user) });
  })
);

/**
 * POST /api/user/premium-requests
 * Submits a request to be upgraded to PREMIUM, with a short message the
 * admin sees on the admin page. Refused if the user is already
 * PREMIUM/ADMIN, or already has an unresolved request.
 */
router.post(
  "/premium-requests",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { message } = req.body ?? {};
    if (!isNonEmptyString(message)) {
      res.status(400).json({ error: "`message` must be a non-empty string." });
      return;
    }

    if (message.trim().length > PREMIUM_REQUEST_MESSAGE_MAX) {
      res.status(400).json({
        error: `\`message\` must be ${PREMIUM_REQUEST_MESSAGE_MAX} characters or fewer.`,
      });
      return;
    }

    if (req.user!.tier !== "BASIC") {
      res.status(409).json({ error: "You already have premium access." });
      return;
    }

    // Fast, friendly check for the common (non-race) case. The authoritative
    // guard is the partial unique index on (userId) WHERE status = 'PENDING'
    // (see schema.prisma comment above the PremiumRequest model) — caught
    // below — since a double-submit (e.g. two tabs) could otherwise slip
    // both requests past this read before either creates its row.
    const existingPending = await prisma.premiumRequest.findFirst({
      where: { userId: req.user!.id, status: "PENDING" },
    });
    if (existingPending) {
      res.status(409).json({ error: "You already have a pending premium request." });
      return;
    }

    try {
      await prisma.premiumRequest.create({
        data: { userId: req.user!.id, message: message.trim() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "You already have a pending premium request." });
        return;
      }
      throw err;
    }

    res.status(201).json({ user: await serializeUser(req.user!) });
  })
);

/**
 * How many resumes get their Markdown text inlined into an export.
 *
 * Uploads are append-only and unbounded today, so "every resume ever uploaded"
 * is an unbounded number of S3 round trips and an unbounded response body on a
 * route any user can call. The cap keeps the export a fixed cost; every resume
 * is still listed with its metadata, and the payload says outright when text
 * was omitted rather than quietly truncating.
 */
const EXPORT_RESUME_TEXT_LIMIT = 25;

/**
 * GET /api/user/me/export
 *
 * The user's entire account as one JSON document — GDPR Art. 15 (access) and
 * Art. 20 (portability), and the thing that makes the delete below a
 * reasonable thing to offer rather than a cliff.
 *
 * Sent as an attachment so a browser saves it instead of rendering it, and
 * marked no-store: it is the single most sensitive response this API produces,
 * and it has no business in a disk cache.
 */
router.get(
  "/me/export",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const [user, applications, jobPostings, baseResumes, premiumRequests] =
      await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            email: true,
            createdAt: true,
            careerSpecialization: true,
            tier: true,
            emailOptOut: true,
          },
        }),
        prisma.application.findMany({
          where: { userId },
          orderBy: { createdAt: "asc" },
          include: {
            jobPosting: { include: { company: { select: { name: true } } } },
            followUps: { orderBy: { followUpDate: "asc" } },
            timelineEntries: { orderBy: { occurredAt: "asc" } },
            contacts: { orderBy: { createdAt: "asc" } },
            questions: { orderBy: { createdAt: "asc" } },
            resumeAnalysis: true,
            tailoredResume: true,
            coverLetter: true,
          },
        }),
        prisma.jobPosting.findMany({
          where: { userId },
          orderBy: { fetchedAt: "asc" },
          include: { company: { select: { name: true } } },
        }),
        prisma.baseResume.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.premiumRequest.findMany({
          where: { userId },
          orderBy: { createdAt: "asc" },
        }),
      ]);

    // Newest first, so a cap keeps the resumes the user actually cares about.
    const withText = baseResumes.slice(0, EXPORT_RESUME_TEXT_LIMIT);
    const markdowns = await Promise.all(
      withText.map((resume) =>
        // One unreadable object must not fail the whole export — the user
        // still gets everything else, and the null is visible in the payload.
        getObjectText(resume.markdownS3Key).catch(() => null)
      )
    );
    const markdownByResumeId = new Map(
      withText.map((resume, i) => [resume.id, markdowns[i]])
    );

    const payload = {
      exportedAt: new Date().toISOString(),
      account: user,
      applications,
      jobPostings,
      resumes: baseResumes.map((resume) => {
        // Text can be missing for two different reasons, and an access
        // response must not conflate them: past the cap is a deliberate
        // policy the note below explains, while an unreadable S3 object is a
        // failure on our side that the user may want to come back about.
        // Both are reported, so `markdown: null` is never left unexplained.
        const withinLimit = markdownByResumeId.has(resume.id);
        const markdown = markdownByResumeId.get(resume.id) ?? null;
        return {
          id: resume.id,
          createdAt: resume.createdAt,
          // The original PDF is not inlined (it is binary, and the Markdown is
          // the version every AI feature actually reads). Ask via the contact
          // address in the privacy policy if you want the PDFs themselves.
          markdown,
          markdownOmitted: !withinLimit,
          markdownUnavailable: withinLimit && markdown === null,
        };
      }),
      premiumRequests,
      notes: {
        resumeTextLimit: `Resume text is included for the ${EXPORT_RESUME_TEXT_LIMIT} most recent uploads; older ones are listed with markdownOmitted: true.`,
        resumeTextUnavailable:
          "markdownUnavailable: true means the stored text could not be read when this export ran. The resume itself is not lost — request it again, or contact us using the address in the Privacy Policy.",
      },
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="jobtracker-export-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  })
);

/**
 * DELETE /api/user/me
 *
 * Erases the account for good: S3 objects, then every database row, then the
 * Firebase identity. GDPR Art. 17 / CCPA §1798.105, and the only way a user
 * can leave.
 *
 * THE ORDER IS LOAD-BEARING, in both directions:
 *
 * - S3 before Postgres. The BaseResume rows hold the only index of which
 *   objects belong to this user; drop them first and a failed S3 delete
 *   strands resume PDFs in the bucket with nothing left pointing at them —
 *   undeletable in practice, and the single most personal artifact here.
 *   Deleting objects first means a failure leaves everything consistent and
 *   the whole request simply retryable.
 *
 * - Postgres before Firebase. If the identity went first and the row delete
 *   then failed, the user could never sign in again to retry — their data
 *   would be permanently stranded behind an account they no longer have. This
 *   way a failure at the last step leaves only an empty Firebase identity,
 *   which signs in to a freshly created blank account. Recoverable, and it
 *   leaks nothing.
 */
router.delete(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { id: userId, firebaseUid } = req.user!;

    const baseResumes = await prisma.baseResume.findMany({
      where: { userId },
      select: { pdfS3Key: true, markdownS3Key: true },
    });
    await deleteObjects(
      baseResumes.flatMap((resume) => [resume.pdfS3Key, resume.markdownS3Key])
    );

    // One transaction so a partial delete can't leave an account half gone.
    // Order is dictated by the foreign keys that DON'T cascade: deleting an
    // Application cascades to its follow-ups, timeline entries, contacts,
    // questions and the three AI documents, but JobPosting, BaseResume and
    // PremiumRequest are all RESTRICT and have to go by hand — and the AI
    // documents reference BaseResume, so the applications must clear first.
    await prisma.$transaction([
      prisma.application.deleteMany({ where: { userId } }),
      prisma.jobPosting.deleteMany({ where: { userId } }),
      prisma.baseResume.deleteMany({ where: { userId } }),
      prisma.premiumRequest.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    // Company rows are intentionally left alone: they are a shared lookup of
    // company names with no personal data and no link back to this user once
    // their postings are gone.

    try {
      await adminAuth.deleteUser(firebaseUid);
    } catch (err) {
      // Everything of theirs is already gone; only the empty login remains.
      // Report it rather than 500 — a "your data is deleted but the sign-in
      // wasn't" answer is accurate and actionable, and a 500 here would read
      // as though nothing happened.
      console.error("Account data deleted but Firebase user removal failed:", {
        name: err instanceof Error ? err.name : typeof err,
      });
      res.status(200).json({
        deleted: true,
        firebaseUserRemoved: false,
        warning:
          "Your data has been deleted, but the sign-in record could not be removed. Signing in again would create a new, empty account. Contact support if you'd like it removed.",
      });
      return;
    }

    res.status(200).json({ deleted: true, firebaseUserRemoved: true });
  })
);

export default router;
