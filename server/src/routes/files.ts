import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { getUploadUrl, getDownloadUrl } from "../lib/s3";

const router = Router();

const FILE_TYPES = ["resume", "coverLetter"] as const;
type FileType = (typeof FILE_TYPES)[number];

const ALLOWED_CONTENT_TYPE = "application/pdf";

function isFileType(value: unknown): value is FileType {
  return (
    typeof value === "string" && (FILE_TYPES as readonly string[]).includes(value)
  );
}

const KEY_COLUMN: Record<FileType, "resumeS3Key" | "coverLetterS3Key"> = {
  resume: "resumeS3Key",
  coverLetter: "coverLetterS3Key",
};

/**
 * POST /api/files/upload-url
 * Body: { applicationId, fileType: 'resume' | 'coverLetter', contentType }
 *
 * Generates an S3 key and returns a pre-signed PUT URL so the frontend can
 * upload the file directly to S3. The application must belong to the user.
 */
router.post(
  "/files/upload-url",
  authenticate,
  async (req: Request, res: Response) => {
    const { applicationId, fileType, contentType } = req.body ?? {};

    if (typeof applicationId !== "string" || applicationId.trim() === "") {
      res
        .status(400)
        .json({ error: "`applicationId` is required and must be a string." });
      return;
    }

    if (!isFileType(fileType)) {
      res.status(400).json({
        error: "`fileType` must be one of 'resume' or 'coverLetter'.",
      });
      return;
    }

    if (contentType !== ALLOWED_CONTENT_TYPE) {
      res
        .status(400)
        .json({ error: "`contentType` must be 'application/pdf'." });
      return;
    }

    try {
      const application = await prisma.application.findFirst({
        where: { id: applicationId, userId: req.user!.id },
      });

      if (!application) {
        res.status(404).json({ error: "Application not found." });
        return;
      }

      const key = `applications/${application.id}/${fileType}-${Date.now()}.pdf`;
      const uploadUrl = await getUploadUrl(key, contentType);

      res.json({ uploadUrl, key });
    } catch (err) {
      console.error("Failed to create upload URL:", err);
      res.status(500).json({ error: "Failed to create upload URL." });
    }
  }
);

/**
 * PATCH /api/applications/:id/files
 * Body: { fileType: 'resume' | 'coverLetter', s3Key }
 *
 * Saves the S3 key onto the application after the frontend confirms the upload
 * to S3 succeeded.
 */
router.patch(
  "/applications/:id/files",
  authenticate,
  async (req: Request, res: Response) => {
    const { fileType, s3Key } = req.body ?? {};

    if (!isFileType(fileType)) {
      res.status(400).json({
        error: "`fileType` must be one of 'resume' or 'coverLetter'.",
      });
      return;
    }

    if (typeof s3Key !== "string" || s3Key.trim() === "") {
      res
        .status(400)
        .json({ error: "`s3Key` is required and must be a string." });
      return;
    }

    try {
      const existing = await prisma.application.findFirst({
        where: { id: req.params.id, userId: req.user!.id },
      });

      if (!existing) {
        res.status(404).json({ error: "Application not found." });
        return;
      }

      // Guard against pointing an application at another user's S3 object: the
      // key must live under this application's prefix.
      const expectedPrefix = `applications/${existing.id}/`;
      if (!s3Key.startsWith(expectedPrefix)) {
        res.status(400).json({ error: "`s3Key` does not belong to this application." });
        return;
      }

      const application = await prisma.application.update({
        where: { id: existing.id },
        data: { [KEY_COLUMN[fileType]]: s3Key },
        include: { jobPosting: true, company: true },
      });

      res.json({ application });
    } catch (err) {
      console.error("Failed to save file key:", err);
      res.status(500).json({ error: "Failed to save file key." });
    }
  }
);

/**
 * GET /api/files/:key/download-url
 * Returns a pre-signed GET URL for a stored file. The key must belong to one of
 * the current user's applications (as a resume or cover letter key).
 */
router.get(
  "/files/:key/download-url",
  authenticate,
  async (req: Request, res: Response) => {
    const key = req.params.key;

    if (typeof key !== "string" || key.trim() === "") {
      res.status(400).json({ error: "A file key is required." });
      return;
    }

    try {
      const owned = await prisma.application.findFirst({
        where: {
          userId: req.user!.id,
          OR: [{ resumeS3Key: key }, { coverLetterS3Key: key }],
        },
        select: { id: true },
      });

      if (!owned) {
        res.status(404).json({ error: "File not found." });
        return;
      }

      const downloadUrl = await getDownloadUrl(key);
      res.json({ downloadUrl });
    } catch (err) {
      console.error("Failed to create download URL:", err);
      res.status(500).json({ error: "Failed to create download URL." });
    }
  }
);

export default router;
