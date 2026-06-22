import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { authenticate } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { uploadBuffer, getDownloadUrl } from "../lib/s3";
import {
  extractTextFromPdf,
  parseResumeIntoStructure,
  isResumeStructure,
} from "../services/resumeParser";
import { tailorResume } from "../services/resumeTailor";
import { renderResumeToPdf } from "../services/resumeRenderer";
import type { ResumeStructure } from "../types/resume";

const router = Router();

const PDF_CONTENT_TYPE = "application/pdf";
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB

// In-memory storage: we only need the buffer to extract text, parse, and upload
// to S3 ourselves — nothing is written to disk.
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

function asJson(content: ResumeStructure): Prisma.InputJsonValue {
  return content as unknown as Prisma.InputJsonValue;
}

/**
 * POST /api/resumes/base
 * Accepts a PDF upload (multipart field "file"), extracts and parses it into a
 * structured resume with AI, stores the structure as a BaseResume, and uploads
 * the original PDF to S3.
 */
router.post("/base", authenticate, async (req: Request, res: Response) => {
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

  let content: ResumeStructure;
  try {
    const rawText = await extractTextFromPdf(file.buffer);
    if (!rawText) {
      res
        .status(400)
        .json({ error: "Could not extract any text from that PDF." });
      return;
    }
    content = await parseResumeIntoStructure(rawText);
  } catch (err) {
    console.error("Failed to parse resume PDF:", err);
    res.status(500).json({
      error: "Failed to extract and parse the resume. Please try again.",
    });
    return;
  }

  try {
    const key = `resumes/${req.user!.id}/base-${Date.now()}.pdf`;
    await uploadBuffer(key, file.buffer, PDF_CONTENT_TYPE);

    const baseResume = await prisma.baseResume.create({
      data: {
        userId: req.user!.id,
        content: asJson(content),
        pdfS3Key: key,
      },
    });

    res.status(201).json({ baseResume });
  } catch (err) {
    console.error("Failed to save base resume:", err);
    res.status(500).json({ error: "Failed to save the parsed resume." });
  }
});

/**
 * GET /api/resumes/base
 * Returns the current user's most recent base resume plus a presigned URL for
 * the original PDF (when one was stored).
 */
router.get("/base", authenticate, async (req: Request, res: Response) => {
  try {
    const baseResume = await prisma.baseResume.findFirst({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
    });

    if (!baseResume) {
      res.json({ baseResume: null, downloadUrl: null });
      return;
    }

    const downloadUrl = baseResume.pdfS3Key
      ? await getDownloadUrl(baseResume.pdfS3Key)
      : null;

    res.json({ baseResume, downloadUrl });
  } catch (err) {
    console.error("Failed to fetch base resume:", err);
    res.status(500).json({ error: "Failed to fetch base resume." });
  }
});

/**
 * PUT /api/resumes/base/:id
 * Replaces the structured content of a base resume (manual edits after parsing).
 * Body: an updated ResumeStructure JSON object.
 */
router.put("/base/:id", authenticate, async (req: Request, res: Response) => {
  const content = req.body;
  if (!isResumeStructure(content)) {
    res
      .status(400)
      .json({ error: "Request body must be a valid resume structure." });
    return;
  }

  try {
    const existing = await prisma.baseResume.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Base resume not found." });
      return;
    }

    const baseResume = await prisma.baseResume.update({
      where: { id: existing.id },
      data: { content: asJson(content) },
    });

    res.json({ baseResume });
  } catch (err) {
    console.error("Failed to update base resume:", err);
    res.status(500).json({ error: "Failed to update base resume." });
  }
});

/**
 * POST /api/resumes/tailor
 * Body: { applicationId, baseResumeId }
 * Tailors the base resume to the application's job posting with AI, renders a
 * PDF, stores it on S3, and records a TailoredResume row.
 */
router.post("/tailor", authenticate, async (req: Request, res: Response) => {
  const { applicationId, baseResumeId } = req.body ?? {};

  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    res
      .status(400)
      .json({ error: "`applicationId` is required and must be a string." });
    return;
  }
  if (typeof baseResumeId !== "string" || baseResumeId.trim() === "") {
    res
      .status(400)
      .json({ error: "`baseResumeId` is required and must be a string." });
    return;
  }

  try {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, userId: req.user!.id },
      include: { jobPosting: true },
    });
    if (!application) {
      res.status(404).json({ error: "Application not found." });
      return;
    }

    const baseResume = await prisma.baseResume.findFirst({
      where: { id: baseResumeId, userId: req.user!.id },
    });
    if (!baseResume) {
      res.status(404).json({ error: "Base resume not found." });
      return;
    }

    const posting = application.jobPosting;
    const jobDescription = [posting?.title, posting?.location, posting?.description]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join("\n");

    if (jobDescription.trim() === "") {
      res.status(400).json({
        error: "This job posting has no description to tailor against.",
      });
      return;
    }

    const baseContent = baseResume.content as unknown as ResumeStructure;

    let tailored: ResumeStructure;
    let aiNotes: string;
    try {
      const result = await tailorResume(baseContent, jobDescription);
      tailored = result.resume;
      aiNotes = result.changes;
    } catch (err) {
      console.error("AI resume tailoring failed:", err);
      res.status(500).json({
        error: "Failed to tailor the resume with AI. Please try again.",
      });
      return;
    }

    let pdf: Buffer;
    try {
      pdf = await renderResumeToPdf(tailored);
    } catch (err) {
      console.error("Tailored resume PDF rendering failed:", err);
      res
        .status(500)
        .json({ error: "Failed to render the tailored resume PDF." });
      return;
    }

    const pdfS3Key = `resumes/${req.user!.id}/tailored-${applicationId}-${Date.now()}.pdf`;
    await uploadBuffer(pdfS3Key, pdf, PDF_CONTENT_TYPE);

    const tailoredResume = await prisma.tailoredResume.create({
      data: {
        applicationId,
        baseResumeId,
        tailoredContent: asJson(tailored),
        pdfS3Key,
        aiNotes,
      },
    });

    const viewUrl = await getDownloadUrl(pdfS3Key);
    const downloadUrl = await getDownloadUrl(pdfS3Key, {
      downloadFilename: "tailored-resume.pdf",
    });

    res.status(201).json({ tailoredResume, viewUrl, downloadUrl });
  } catch (err) {
    console.error("Failed to generate tailored resume:", err);
    res.status(500).json({ error: "Failed to generate tailored resume." });
  }
});

/**
 * GET /api/resumes/tailored/:applicationId
 * Returns all tailored resumes for an application (most recent first), each with
 * presigned URLs for viewing and downloading.
 */
router.get(
  "/tailored/:applicationId",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const application = await prisma.application.findFirst({
        where: { id: req.params.applicationId, userId: req.user!.id },
        select: { id: true },
      });
      if (!application) {
        res.status(404).json({ error: "Application not found." });
        return;
      }

      const rows = await prisma.tailoredResume.findMany({
        where: { applicationId: application.id },
        orderBy: { createdAt: "desc" },
      });

      const tailoredResumes = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          viewUrl: row.pdfS3Key ? await getDownloadUrl(row.pdfS3Key) : null,
          downloadUrl: row.pdfS3Key
            ? await getDownloadUrl(row.pdfS3Key, {
                downloadFilename: "tailored-resume.pdf",
              })
            : null,
        }))
      );

      res.json({ tailoredResumes });
    } catch (err) {
      console.error("Failed to fetch tailored resumes:", err);
      res.status(500).json({ error: "Failed to fetch tailored resumes." });
    }
  }
);

export default router;
