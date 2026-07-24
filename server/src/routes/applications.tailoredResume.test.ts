import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { makeBaseResume, makePosting, makeTailoredContent } from "../test-helpers/fixtures";

const { prismaMock, getObjectTextMock, generateTailoredResumeMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    baseResume: { findFirst: vi.fn() },
    tailoredResume: { upsert: vi.fn(), update: vi.fn() },
  },
  getObjectTextMock: vi.fn(),
  generateTailoredResumeMock: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/s3", () => ({ getObjectText: getObjectTextMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", resumeSpecialization: "SOFTWARE_ENGINEERING" } as never;
    next();
  },
}));
vi.mock("../services/tailoredResume", () => ({
  generateTailoredResume: generateTailoredResumeMock,
}));

import applicationsRouter from "./applications";
import { jobPostingFingerprint } from "../lib/prompt";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);

const posting = makePosting({ location: ["Remote"], salary: null, description: "Build things." });
const baseResume = makeBaseResume();
const content = makeTailoredContent();

function applicationRow(tailoredResume: unknown = null) {
  return { id: "app-1", userId: "user-1", jobPosting: posting, tailoredResume };
}

function currentTailored(overrides: Record<string, unknown> = {}) {
  return {
    id: "tr-1",
    applicationId: "app-1",
    baseResumeId: baseResume.id,
    jobPostingHash: jobPostingFingerprint(posting),
    content,
    edited: false,
    updatedAt: new Date("2026-07-20T00:00:00Z"),
    ...overrides,
  };
}

describe("tailored-resume endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.baseResume.findFirst.mockResolvedValue(baseResume);
    getObjectTextMock.mockResolvedValue("# Resume\nExperience...");
    generateTailoredResumeMock.mockResolvedValue(content);
    prismaMock.tailoredResume.upsert.mockResolvedValue(currentTailored());
    prismaMock.tailoredResume.update.mockResolvedValue(currentTailored({ edited: true }));
  });

  it("returns 404 for an application the user does not own", async () => {
    prismaMock.application.findFirst.mockResolvedValue(null);

    expect((await request(app).get("/api/applications/app-1/tailored-resume")).status).toBe(404);
    expect((await request(app).post("/api/applications/app-1/tailored-resume")).status).toBe(404);
    expect(generateTailoredResumeMock).not.toHaveBeenCalled();
  });

  it("GET reports upToDate=true while resume and posting are unchanged", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app).get("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(200);
    expect(res.body.upToDate).toBe(true);
    expect(res.body.hasResume).toBe(true);
  });

  it("GET reports upToDate=false after the user uploads a new resume", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));
    prismaMock.baseResume.findFirst.mockResolvedValue({ ...baseResume, id: "resume-2" });

    const res = await request(app).get("/api/applications/app-1/tailored-resume");

    expect(res.body.upToDate).toBe(false);
  });

  it("POST returns 400 when the user has no resume", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow());
    prismaMock.baseResume.findFirst.mockResolvedValue(null);

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(400);
    expect(generateTailoredResumeMock).not.toHaveBeenCalled();
  });

  it("POST refuses (409) while the saved draft is still current", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(409);
    expect(generateTailoredResumeMock).not.toHaveBeenCalled();
    expect(prismaMock.tailoredResume.upsert).not.toHaveBeenCalled();
  });

  it("POST refuses (409, needsForce) when the user has edited the draft", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentTailored({ edited: true }))
    );

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(409);
    expect(res.body.needsForce).toBe(true);
    expect(generateTailoredResumeMock).not.toHaveBeenCalled();
  });

  it("POST with force=1 regenerates over an edited draft and clears the edited flag", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentTailored({ edited: true }))
    );

    const res = await request(app).post("/api/applications/app-1/tailored-resume?force=1");

    expect(res.status).toBe(201);
    expect(generateTailoredResumeMock).toHaveBeenCalledWith(
      "# Resume\nExperience...",
      posting,
      "SOFTWARE_ENGINEERING"
    );
    expect(prismaMock.tailoredResume.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ edited: false }),
      })
    );
  });

  it("POST generates and saves when the posting content has changed", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentTailored({ jobPostingHash: "stale-hash" }))
    );

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(201);
    expect(prismaMock.tailoredResume.upsert).toHaveBeenCalledWith(
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

  it("PATCH rejects a non-object content", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app)
      .patch("/api/applications/app-1/tailored-resume")
      .send({ content: "not an object" });

    expect(res.status).toBe(400);
    expect(prismaMock.tailoredResume.update).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 when there is no draft to edit", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(null));

    const res = await request(app)
      .patch("/api/applications/app-1/tailored-resume")
      .send({ content });

    expect(res.status).toBe(404);
  });

  it("PATCH saves edits and marks the draft edited", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app)
      .patch("/api/applications/app-1/tailored-resume")
      .send({ content });

    expect(res.status).toBe(200);
    expect(prismaMock.tailoredResume.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationId: "app-1" },
        data: expect.objectContaining({ edited: true }),
      })
    );
    expect(res.body.tailored.edited).toBe(true);
  });

  it("download rejects non-PDF formats", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app).get(
      "/api/applications/app-1/tailored-resume/download?format=docx"
    );

    expect(res.status).toBe(400);
  });

  it("download returns 404 when there is no draft", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(null));

    const res = await request(app).get("/api/applications/app-1/tailored-resume/download");

    expect(res.status).toBe(404);
  });

  it("download streams a PDF built from the current draft", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app)
      .get("/api/applications/app-1/tailored-resume/download?format=pdf")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(".pdf");
    expect((res.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
