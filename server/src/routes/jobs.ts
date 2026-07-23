import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";
import {
  isNonEmptyString,
  isNullableString,
  isStringArray,
  isValidHttpUrl,
} from "../lib/validation";
import { ScrapeError, scrapeJobPosting } from "../services/scrapers";

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
    const { jobUrl, title, companyName, location, salary, description } = req.body ?? {};

    if (!isValidHttpUrl(jobUrl)) {
      res.status(400).json({ error: "`jobUrl` must be a valid http(s) URL." });
      return;
    }
    if (!isNonEmptyString(title)) {
      res.status(400).json({ error: "`title` is required." });
      return;
    }
    if (!isNonEmptyString(companyName)) {
      res.status(400).json({ error: "`companyName` is required." });
      return;
    }
    if (location !== undefined && !isStringArray(location)) {
      res.status(400).json({ error: "`location` must be an array of non-empty strings." });
      return;
    }
    if (!isNullableString(salary) || !isNullableString(description)) {
      res.status(400).json({ error: "`salary` and `description` must be strings or null." });
      return;
    }

    const company = await prisma.company.upsert({
      where: { name: companyName },
      update: {},
      create: { name: companyName },
    });

    const jobPosting = await prisma.jobPosting.upsert({
      where: { userId_jobUrl: { userId: req.user!.id, jobUrl } },
      update: {
        title,
        location: location ?? [],
        salary: salary ?? null,
        description: description ?? null,
        companyId: company.id,
      },
      create: {
        userId: req.user!.id,
        title,
        location: location ?? [],
        salary: salary ?? null,
        jobUrl,
        description: description ?? null,
        companyId: company.id,
      },
      include: { company: true },
    });

    res.status(201).json({ jobPosting });
  })
);

export default router;
