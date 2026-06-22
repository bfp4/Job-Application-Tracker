import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { isResumeKeywords } from "../types/keywords";

const router = Router();

/**
 * GET /api/user/keywords
 * Returns the authenticated user's extracted resume keywords and whether the
 * "Smart Search" enrichment is enabled. `keywords` is null until the first
 * extraction has succeeded.
 */
router.get("/keywords", authenticate, async (req: Request, res: Response) => {
  const raw = req.user!.resumeKeywords;
  const keywords = isResumeKeywords(raw) ? raw : null;
  res.json({
    keywords,
    keywordsEnabled: req.user!.keywordsEnabled,
  });
});

/**
 * PATCH /api/user/preferences
 * Updates user preference toggles. Each field is optional and only the fields
 * present in the body are written, so independent toggles never clobber one
 * another.
 *
 * Body: { keywordsEnabled?: boolean }
 */
router.patch(
  "/preferences",
  authenticate,
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: { keywordsEnabled?: boolean } = {};

    if ("keywordsEnabled" in body) {
      if (typeof body.keywordsEnabled !== "boolean") {
        res
          .status(400)
          .json({ error: "`keywordsEnabled` must be a boolean." });
        return;
      }
      data.keywordsEnabled = body.keywordsEnabled;
    }

    if (Object.keys(data).length === 0) {
      res
        .status(400)
        .json({ error: "No supported preference fields were provided." });
      return;
    }

    try {
      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data,
        select: { keywordsEnabled: true },
      });
      res.json({ keywordsEnabled: user.keywordsEnabled });
    } catch (err) {
      console.error("Failed to update user preferences:", err);
      res.status(500).json({ error: "Failed to update preferences." });
    }
  }
);

export default router;
