import { Router, type Request, type Response } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { uploadBuffer } from "../lib/s3";
import { asyncHandler } from "../lib/http";
import { getLatestBaseResume } from "../lib/baseResume";
import { convertPdfToMarkdown } from "../lib/pdfToMarkdown";

const router = Router();

const PDF_CONTENT_TYPE = "application/pdf";
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB

// In-memory storage: we only need the buffer to upload to S3 — nothing is
// written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== PDF_CONTENT_TYPE) {
      cb(new Error("Only PDF files are accepted."));
      return;
    }
    cb(null, true);
  },
});

/**
 * Runs the multer single-file middleware as a promise so errors (wrong type,
 * too large) can be turned into 400 responses instead of crashing the request.
 */
function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** The multer mimetype check trusts the client; the magic bytes don't. */
function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * POST /api/resumes/base
 * Accepts a PDF upload (multipart field "file"), stores the PDF and a
 * Markdown conversion in S3, and creates a BaseResume record pointing at them.
 */
router.post(
  "/base",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      await runUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "PDF must be 10MB or smaller."
            : "File upload failed.";
        res.status(400).json({ error: message });
        return;
      }
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : "File upload failed." });
      return;
    }

    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ error: "A PDF file is required (multipart field 'file')." });
      return;
    }

    if (!looksLikePdf(file.buffer)) {
      res.status(400).json({ error: "That file isn't a valid PDF." });
      return;
    }

    let markdown: string;
    try {
      markdown = await convertPdfToMarkdown(file.buffer);
    } catch {
      res.status(400).json({
        error: "That PDF couldn't be read. Try re-exporting it and uploading again.",
      });
      return;
    }

    const timestamp = Date.now();
    const pdfKey = `resumes/${req.user!.id}/base-${timestamp}.pdf`;
    const markdownKey = `resumes/${req.user!.id}/base-${timestamp}.md`;

    await Promise.all([
      uploadBuffer(pdfKey, file.buffer, PDF_CONTENT_TYPE),
      uploadBuffer(markdownKey, Buffer.from(markdown, "utf-8"), "text/markdown"),
    ]);

    const baseResume = await prisma.baseResume.create({
      data: {
        userId: req.user!.id,
        pdfS3Key: pdfKey,
        markdownS3Key: markdownKey,
      },
    });

    res.status(201).json({ baseResume });
  })
);

/**
 * GET /api/resumes/base
 * Returns the current user's most recently uploaded base resume, if any.
 */
router.get(
  "/base",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const baseResume = await getLatestBaseResume(req.user!.id);
    res.json({ baseResume });
  })
);

export default router;
