import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Company, JobPosting } from "@prisma/client";

const { prismaMock, getObjectTextMock, generateResumeTipsMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    baseResume: { findFirst: vi.fn() },
    resumeAnalysis: { upsert: vi.fn() },
  },
  getObjectTextMock: vi.fn(),
  generateResumeTipsMock: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/s3", () => ({ getObjectText: getObjectTextMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));
// Keep the real fingerprint (the staleness rule under test) but stub the LLM call.
vi.mock("../services/resumeTips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/resumeTips")>();
  return { ...actual, generateResumeTips: generateResumeTipsMock };
});

import applicationsRouter from "./applications";
import { jobPostingFingerprint } from "../services/resumeTips";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);

type PostingWithCompany = JobPosting & { company: Company | null };

const posting: PostingWithCompany = {
  id: "posting-1",
  userId: "user-1",
  companyId: "company-1",
  company: { id: "company-1", name: "Acme", website: null },
  title: "Software Engineer",
  location: ["Remote"],
  salary: null,
  jobUrl: "https://example.com/jobs/1",
  description: "Build things.",
  matchScore: null,
  matchReasons: [],
  postedDate: null,
  fetchedAt: new Date("2026-07-01T00:00:00Z"),
};

const baseResume = {
  id: "resume-1",
  userId: "user-1",
  pdfS3Key: "resumes/user-1/base.pdf",
  markdownS3Key: "resumes/user-1/base.md",
  parsed: {},
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

const tipsContent = {
  summary: "Solid fit.",
  technologiesToStudy: [],
  missingFromResume: [],
  bulletPointSuggestions: [],
  strengthsToHighlight: [],
  additionalTips: [],
};

function applicationRow(resumeAnalysis: unknown = null) {
  return { id: "app-1", userId: "user-1", jobPosting: posting, resumeAnalysis };
}

function currentAnalysis() {
  return {
    id: "analysis-1",
    applicationId: "app-1",
    baseResumeId: baseResume.id,
    jobPostingHash: jobPostingFingerprint(posting),
    content: tipsContent,
  };
}

describe("resume-tips endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.baseResume.findFirst.mockResolvedValue(baseResume);
    getObjectTextMock.mockResolvedValue("# Resume\nExperience...");
    generateResumeTipsMock.mockResolvedValue(tipsContent);
    prismaMock.resumeAnalysis.upsert.mockResolvedValue(currentAnalysis());
  });

  it("returns 404 for an application the user does not own", async () => {
    prismaMock.application.findFirst.mockResolvedValue(null);

    expect((await request(app).get("/api/applications/app-1/resume-tips")).status).toBe(404);
    expect((await request(app).post("/api/applications/app-1/resume-tips")).status).toBe(404);
    expect(generateResumeTipsMock).not.toHaveBeenCalled();
  });

  it("GET reports upToDate=true while resume and posting are unchanged", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentAnalysis()));

    const res = await request(app).get("/api/applications/app-1/resume-tips");

    expect(res.status).toBe(200);
    expect(res.body.upToDate).toBe(true);
    expect(res.body.hasResume).toBe(true);
  });

  it("GET reports upToDate=false after the user uploads a new resume", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentAnalysis()));
    prismaMock.baseResume.findFirst.mockResolvedValue({ ...baseResume, id: "resume-2" });

    const res = await request(app).get("/api/applications/app-1/resume-tips");

    expect(res.body.upToDate).toBe(false);
  });

  it("POST returns 400 when the user has no resume", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow());
    prismaMock.baseResume.findFirst.mockResolvedValue(null);

    const res = await request(app).post("/api/applications/app-1/resume-tips");

    expect(res.status).toBe(400);
    expect(generateResumeTipsMock).not.toHaveBeenCalled();
  });

  it("POST refuses to re-run (409) while the saved analysis is still current", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentAnalysis()));

    const res = await request(app).post("/api/applications/app-1/resume-tips");

    expect(res.status).toBe(409);
    expect(generateResumeTipsMock).not.toHaveBeenCalled();
    expect(prismaMock.resumeAnalysis.upsert).not.toHaveBeenCalled();
  });

  it("POST generates and saves when the posting content has changed", async () => {
    const staleAnalysis = { ...currentAnalysis(), jobPostingHash: "stale-hash" };
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(staleAnalysis));

    const res = await request(app).post("/api/applications/app-1/resume-tips");

    expect(res.status).toBe(201);
    expect(getObjectTextMock).toHaveBeenCalledWith(baseResume.markdownS3Key);
    expect(generateResumeTipsMock).toHaveBeenCalledWith("# Resume\nExperience...", posting);
    expect(prismaMock.resumeAnalysis.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationId: "app-1" },
        create: expect.objectContaining({
          baseResumeId: baseResume.id,
          jobPostingHash: jobPostingFingerprint(posting),
        }),
      })
    );
    expect(res.body.upToDate).toBe(true);
  });
});
