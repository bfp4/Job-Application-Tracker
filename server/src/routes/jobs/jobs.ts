import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/auth/auth";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../lib/http/http";
import { isNonEmptyString } from "../../lib/validation";
import { parseJobPostingFields } from "../../lib/jobPostingInput";
import { ScrapeError, scrapeJobPosting } from "../../services/scrapers";

const router = Router();

/**
 * POST /api/jobs/scrape
 * Given a pasted job URL, returns a normalized posting *preview* the client can
 * use to prefill the add-job form. It does NOT write anything — the user still
 * reviews the result and submits it through `POST /api/jobs`.
 */
router.post(
  "/scrape",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { url } = req.body ?? {};
    if (!isNonEmptyString(url)) {
      res.status(400).json({ error: "`url` is required." });
      return;
    }

    try {
      const result = await scrapeJobPosting(url);
      res.json(result);
    } catch (err) {
      if (err instanceof ScrapeError) {
        // Bad/unsupported URLs are the caller's mistake (400); a posting the
        // provider couldn't locate is a well-formed but unprocessable request
        // (422); anything upstream is a bad gateway (502).
        const status =
          err.code === "INVALID_URL" || err.code === "UNSUPPORTED_URL"
            ? 400
            : err.code === "NOT_FOUND"
            ? 422
            : 502;
        res.status(status).json({ error: err.message });
        return;
      }
      throw err;
    }
  })
);

/**
 * POST /api/jobs
 * Saves a manually-entered job posting as a Company/JobPosting pair. Upserted
 * on (user, jobUrl): re-submitting a URL updates the caller's own posting and
 * never touches another user's copy of the same URL.
 */
router.post(
  "/",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseJobPostingFields(req.body ?? {});

    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { jobUrl, title, companyName, location, salary, description } = parsed.data;

    // The parser accepts any subset (it also serves PATCH); creating needs these.
    if (jobUrl === undefined) {
      res.status(400).json({ error: "`jobUrl` is required." });
      return;
    }
    if (title === undefined) {
      res.status(400).json({ error: "`title` is required." });
      return;
    }
    if (companyName === undefined) {
      res.status(400).json({ error: "`companyName` is required." });
      return;
    }

    const company = await upsertCompany(companyName);

    const fields = {
      title,
      location: location ?? [],
      salary: salary ?? null,
      description: description ?? null,
      companyId: company.id,
    };

    const jobPosting = await prisma.jobPosting.upsert({
      where: { userId_jobUrl: { userId: req.user!.id, jobUrl } },
      update: fields,
      create: { userId: req.user!.id, jobUrl, ...fields },
      include: { company: true },
    });

    res.status(201).json({ jobPosting });
  })
);

/**
 * PATCH /api/jobs/:id
 * Edit any subset of a posting's own details (title, company, location, salary,
 * URL, description) after it has been tracked. Scoped to the caller's postings,
 * so one user's edit can never reach another user's copy of the same URL.
 *
 * Editing a field the AI features read changes the posting's fingerprint, which
 * is what makes a saved resume analysis / tailored resume regeneratable again
 * (see jobPostingFingerprint).
 */
router.patch(
  "/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseJobPostingFields(req.body ?? {});

    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { companyName, ...postingFields } = parsed.data;

    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "No valid fields provided to update." });
      return;
    }

    const existing = await prisma.jobPosting.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Job posting not found." });
      return;
    }

    // Postings are unique per (user, jobUrl): moving this one onto a URL the
    // user already tracks would violate that, so refuse with a message the
    // client can show instead of letting the write fail at the database.
    if (postingFields.jobUrl !== undefined && postingFields.jobUrl !== existing.jobUrl) {
      const clash = await prisma.jobPosting.findFirst({
        where: { userId: req.user!.id, jobUrl: postingFields.jobUrl },
      });
      if (clash) {
        res.status(409).json({ error: "You're already tracking a job with that URL." });
        return;
      }
    }

    const company =
      companyName !== undefined ? await upsertCompany(companyName) : null;

    const jobPosting = await prisma.jobPosting.update({
      where: { id: existing.id },
      data: { ...postingFields, ...(company ? { companyId: company.id } : {}) },
      include: { company: true },
    });

    res.json({ jobPosting });
  })
);

/** Companies are shared across users and keyed by name — reuse or create one. */
function upsertCompany(name: string) {
  return prisma.company.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

export default router;
