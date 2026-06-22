import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { generateDigestForUser } from "../services/digestService";

const router = Router();

/**
 * GET /api/digest/preview
 *
 * Development-only: returns the digest data that would be emailed to the current
 * user, without sending anything. Lets us verify the recommendation/reminder logic
 * before email delivery (SES) is wired up in Phase 6b.
 */
router.get("/preview", authenticate, async (req: Request, res: Response) => {
  try {
    const digest = await generateDigestForUser(req.user!.id);
    res.json(digest);
  } catch (err) {
    console.error("Failed to generate digest preview:", err);
    res.status(500).json({ error: "Failed to generate digest preview." });
  }
});

export default router;
