import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { makeBaseResume, makePosting } from "../../test-helpers/fixtures";

const { prismaMock, getObjectTextMock, generateResumeTipsMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    baseResume: { findFirst: vi.fn() },
    resumeAnalysis: { upsert: vi.fn() },
    user: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  getObjectTextMock: vi.fn(),
  generateResumeTipsMock: vi.fn(),
}));

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../lib/s3", () => ({ getObjectText: getObjectTextMock }));
vi.mock("../../middleware/auth/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", careerSpecialization: "HEALTHCARE", tier: "BASIC" } as never;
    next();
  },
}));
// Keep the real fingerprint (the staleness rule under test) but stub the LLM call.
vi.mock("../../services/agents/resumeTips/resumeTips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/agents/resumeTips/resumeTips")>();
  return { ...actual, generateResumeTips: generateResumeTipsMock };
});

import applicationsRouter from "./applications";
import { jobPostingFingerprint } from "../../services/agents/resumeTips/resumeTips";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);

const posting = makePosting({ location: ["Remote"], salary: null, description: "Build things." });
const baseResume = makeBaseResume();

const tipsContent = {
  summary: "Solid fit.",
  certificationsToPursue: [],
  clinicalDetailsToAdd: [],
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
    // Default: the atomic quota-reservation UPDATE succeeds (returns a row).
    prismaMock.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
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
    expect(generateResumeTipsMock).toHaveBeenCalledWith(
      "# Resume\nExperience...",
      posting,
      "HEALTHCARE"
    );
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

  it("does not refund quota when the reservation attempt itself throws (vs. a real refusal)", async () => {
    const staleAnalysis = { ...currentAnalysis(), jobPostingHash: "stale-hash" };
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(staleAnalysis));
    // The reservation UPDATE errors out (e.g. a transient DB blip) rather
    // than resolving to "refused" — reserveAiCall throws, so nothing was
    // ever incremented and there's nothing to refund.
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("connection reset"));

    const res = await request(app).post("/api/applications/app-1/resume-tips");

    expect(res.status).toBe(500);
    expect(generateResumeTipsMock).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("does not refund quota when the save fails after a billed generation", async () => {
    const staleAnalysis = { ...currentAnalysis(), jobPostingHash: "stale-hash" };
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(staleAnalysis));
    // Claude answered and was paid for; only the write that persists the
    // result failed. Refunding here would let a Basic user replay a request
    // whose write fails every time at no quota cost at all.
    prismaMock.resumeAnalysis.upsert.mockRejectedValueOnce(new Error("pool timeout"));

    const res = await request(app).post("/api/applications/app-1/resume-tips");

    expect(res.status).toBe(500);
    expect(generateResumeTipsMock).toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});
