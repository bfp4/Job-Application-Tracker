import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/auth/auth";
import { AI_QUOTA_EXCEEDED_RESPONSE, releaseAiCallOnFailure, reserveAiCall } from "../../middleware/quota/quota";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../lib/http/http";
import { parseContactFields } from "../../lib/contactInput";
import { getLatestBaseResume } from "../../lib/baseResume";
import { getObjectText } from "../../lib/s3";
import { createInFlightGuard } from "../../lib/inFlight";
import {
  connectMessageContext,
  connectMessageFingerprint,
  generateConnectMessage,
  serializeContact,
} from "../../services/agents/linkedinMessage/linkedinMessage";

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

    // The posting join and resume lookup are here only to recompute
    // connectMessageUpToDate: editing this contact's name, position, or notes
    // changes what a note would say, which re-enables the regenerate button.
    const [existing, baseResume] = await Promise.all([
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

    if (!existing) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }

    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: parsed.data,
    });

    const context = connectMessageContext(
      existing.application,
      baseResume?.id ?? null,
      req.user!.careerSpecialization
    );

    res.json({ contact: serializeContact(updated, context) });
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
 * contact's connectMessage, overwriting any existing draft (the client confirms
 * first when there is one).
 *
 * A resume is optional here: the note is mostly about the role and interest,
 * so it can still be drafted before one is uploaded, just with less colour.
 *
 * Refused with 409 while the saved note still matches everything it was drafted
 * from — a redraft of unchanged inputs only spends a model call to produce the
 * same note. There is deliberately no force escape: the client disables the
 * button in that state, so a 409 here means stale client state, not a user
 * asking for a second opinion.
 *
 * The hash covers the note's inputs, not its text, and a hand-edit through
 * PATCH /api/contacts/:id doesn't clear it. So a user who edits their note and
 * wants a fresh draft has to change one of those inputs, or clear the note —
 * which drops connectMessage and lifts the refusal.
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

    // Split the join off the row: every `contact` this route returns has to be
    // the flat shape the client's Contact type describes, not the row with its
    // application → jobPosting → company graph still attached.
    const { application, ...contactFields } = contact;

    const context = connectMessageContext(
      application,
      baseResume?.id ?? null,
      req.user!.careerSpecialization
    );
    const currentHash = connectMessageFingerprint({ ...context, contact: contactFields });

    // Checked before the S3 read below, so a refused request costs one query
    // and nothing else.
    if (contactFields.connectMessage && contactFields.connectMessageHash === currentHash) {
      res.status(409).json({
        error:
          "This message is already up to date. Edit the contact, the application, or the job posting to draft a new one.",
        contact: serializeContact(contactFields, context),
      });
      return;
    }

    if (!messagesInFlight.tryAcquire(contact.id)) {
      res.status(409).json({
        error: "A connection message is already being drafted for this contact.",
      });
      return;
    }

    let reserved = false;
    let billed = false;
    try {
      reserved = await reserveAiCall(req.user!.id, req.user!.tier);
      if (!reserved) {
        res.status(429).json(AI_QUOTA_EXCEEDED_RESPONSE);
        return;
      }

      const resumeMarkdown = baseResume
        ? await getObjectText(baseResume.markdownS3Key)
        : null;

      // Spelled out rather than passing the whole row: these three fields are
      // all the prompt reads, and the fingerprint above covers exactly them.
      const message = await generateConnectMessage(
        {
          name: contactFields.name,
          position: contactFields.position,
          notes: contactFields.notes,
        },
        application.jobPosting,
        application.status,
        application.notes,
        resumeMarkdown,
        req.user!.careerSpecialization
      );
      // Claude has answered and the call is paid for — see the refund rules on
      // releaseAiCallOnFailure. The write below must not trigger a refund.
      billed = true;

      const updated = await prisma.contact.update({
        where: { id: contact.id },
        data: { connectMessage: message, connectMessageHash: currentHash },
      });

      res.status(201).json({ contact: serializeContact(updated, context) });
    } catch (err) {
      if (reserved && !billed) {
        await releaseAiCallOnFailure(req.user!.id, req.user!.tier, err);
      }
      throw err;
    } finally {
      messagesInFlight.release(contact.id);
    }
  })
);

export default router;
