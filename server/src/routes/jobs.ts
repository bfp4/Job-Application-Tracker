import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";

const router = Router();

// Only http(s) — the URL is stored shared across users and rendered as a
// clickable link, so schemes like javascript: must never be accepted.
function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * POST /api/jobs
 * Saves a manually-entered job posting as a Company/JobPosting pair. Upserted
 * on (user, jobUrl): re-submitting a URL updates the caller's own posting and
 * never touches another user's copy of the same URL.
 */
router.post("/", authenticate, async (req: Request, res: Response) => {
  const { jobUrl, title, companyName, location, salary, description } = req.body ?? {};

  if (!isValidUrl(jobUrl)) {
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

  try {
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
  } catch (err) {
    console.error("Failed to save job posting:", err);
    res.status(500).json({ error: "Failed to save job posting." });
  }
});

export default router;
