import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import { parseContactFields } from "../lib/contactInput";
import { getLatestBaseResume } from "../lib/baseResume";
import { getObjectText } from "../lib/s3";
import { createInFlightGuard } from "../lib/inFlight";
import { generateConnectMessage } from "../services/linkedinMessage";

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

// Contacts with a connect-message draft currently generating (see lib/inFlight.ts).
const messagesInFlight = createInFlightGuard();

/**
 * POST /api/contacts/:id/connect-message
 * Drafts a LinkedIn connection-request note (max 300 chars) introducing the
 * candidate to this contact, grounded in the job posting, the candidate's
 * resume, the application's status, and any notes — and saves it as the
 * contact's connectMessage (overwriting any existing draft; the client
 * confirms before regenerating over edits).
 *
 * A resume is optional here: the note is mostly about the role and interest,
 * so it can still be drafted before one is uploaded, just with less colour.
 */
router.post(
  "/:id/connect-message",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const [contact, baseResume] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: req.params.id, application: { userId: req.user!.id } },
        include: {
          application: {
            include: { jobPosting: { include: { company: true } } },
          },
        },
      }),
      getLatestBaseResume(req.user!.id),
    ]);

    if (!contact) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    if (!messagesInFlight.tryAcquire(contact.id)) {
      res.status(409).json({
        error: "A connection message is already being drafted for this contact.",
      });
      return;
    }

    try {
      const resumeMarkdown = baseResume
        ? await getObjectText(baseResume.markdownS3Key)
        : null;

      const message = await generateConnectMessage(
        { name: contact.name, position: contact.position, notes: contact.notes },
        contact.application.jobPosting,
        contact.application.status,
        contact.application.notes,
        resumeMarkdown
      );

      const updated = await prisma.contact.update({
        where: { id: contact.id },
        data: { connectMessage: message },
      });

      res.status(201).json({ contact: updated });
    } finally {
      messagesInFlight.release(contact.id);
    }
  })
);

export default router;
