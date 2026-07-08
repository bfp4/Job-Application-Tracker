import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { getLatestBaseResume } from "../lib/baseResume";
import { createInFlightGuard } from "../lib/inFlight";
import { getObjectText } from "../lib/s3";
import { isNonEmptyString, isNullableString } from "../lib/validation";
import { generateQuestionAnswer } from "../services/applicationQuestions";

const router = Router();

/**
 * PATCH /api/questions/:id
 * Edit the question text and/or the answer. Ownership is enforced through
 * the parent application's userId.
 */
router.patch(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { question, answer } = req.body ?? {};
    const data: Prisma.ApplicationQuestionUpdateInput = {};

    if (question !== undefined) {
      if (!isNonEmptyString(question)) {
        res.status(400).json({ error: "`question` must be a non-empty string." });
        return;
      }
      data.question = question.trim();
    }

    if (answer !== undefined) {
      if (!isNullableString(answer)) {
        res.status(400).json({ error: "`answer` must be a string or null." });
        return;
      }
      // Empty answers are stored as NULL so `answer === null` reliably means
      // "unanswered" regardless of which client sent the update.
      data.answer = answer === null || answer.trim() === "" ? null : answer;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No valid fields provided to update." });
      return;
    }

    const existing = await prisma.applicationQuestion.findFirst({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (!existing) {
      res.status(404).json({ error: "Question not found." });
      return;
    }

    const updated = await prisma.applicationQuestion.update({
      where: { id: existing.id },
      data,
    });

    res.json({ question: updated });
  })
);

/**
 * DELETE /api/questions/:id
 */
router.delete(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // deleteMany so the ownership filter and the delete are one round-trip;
    // count 0 means not found (or not this user's), either way a 404.
    const { count } = await prisma.applicationQuestion.deleteMany({
      where: { id: req.params.id, application: { userId: req.user!.id } },
    });

    if (count === 0) {
      res.status(404).json({ error: "Question not found." });
      return;
    }

    res.status(204).end();
  })
);

// Questions with an AI draft currently generating (see lib/inFlight.ts).
const draftsInFlight = createInFlightGuard();

/**
 * POST /api/questions/:id/answer
 * Drafts an answer with AI from the user's resume, the posting, and their
 * application notes, and saves it as the question's answer (overwriting any
 * existing answer — the client confirms before redrafting over edits).
 *
 * Body: `mode` is "new" (default — write from scratch) or "refine" (use the
 * candidate's existing answer as the primary guide). `draft` carries the
 * client's current textbox contents so unsaved edits are refined too; when
 * absent, refine falls back to the saved answer.
 */
router.post(
  "/:id/answer",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { mode, draft } = req.body ?? {};

    if (mode !== undefined && mode !== "new" && mode !== "refine") {
      res.status(400).json({ error: '`mode` must be "new" or "refine".' });
      return;
    }

    if (!isNullableString(draft)) {
      res.status(400).json({ error: "`draft` must be a string or null." });
      return;
    }

    const [question, baseResume] = await Promise.all([
      prisma.applicationQuestion.findFirst({
        where: { id: req.params.id, application: { userId: req.user!.id } },
        include: {
          application: {
            include: { jobPosting: { include: { company: true } } },
          },
        },
      }),
      getLatestBaseResume(req.user!.id),
    ]);

    if (!question) {
      res.status(404).json({ error: "Question not found." });
      return;
    }

    if (!baseResume) {
      res.status(400).json({
        error: "Upload a resume in Settings before drafting answers with AI.",
      });
      return;
    }

    const existingDraft =
      mode === "refine"
        ? (typeof draft === "string" && draft.trim() !== "" ? draft : question.answer)
        : null;

    if (mode === "refine" && !existingDraft?.trim()) {
      res.status(400).json({
        error: "There is no answer to refine yet — write a draft first or generate a new one.",
      });
      return;
    }

    if (!draftsInFlight.tryAcquire(question.id)) {
      res.status(409).json({
        error: "An answer is already being drafted for this question.",
      });
      return;
    }

    try {
      const resumeMarkdown = await getObjectText(baseResume.markdownS3Key);
      const answer = await generateQuestionAnswer(
        question.question,
        resumeMarkdown,
        question.application.jobPosting,
        question.application.notes,
        existingDraft
      );

      const updated = await prisma.applicationQuestion.update({
        where: { id: question.id },
        data: { answer },
      });

      res.status(201).json({ question: updated });
    } finally {
      draftsInFlight.release(question.id);
    }
  })
);

export default router;
