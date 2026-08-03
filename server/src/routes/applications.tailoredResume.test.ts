import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { makeBaseResume, makePosting, makeTailoredContent } from "../test-helpers/fixtures";

const { prismaMock, getObjectTextMock, generateTailoredResumeMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    baseResume: { findFirst: vi.fn() },
    tailoredResume: { upsert: vi.fn(), update: vi.fn() },
    user: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  getObjectTextMock: vi.fn(),
  generateTailoredResumeMock: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/s3", () => ({ getObjectText: getObjectTextMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // BASIC, so the quota reservation actually runs — reserveAiCall
    // short-circuits to "allowed" for every other tier, and an omitted tier
    // would silently route these tests down that unlimited path.
    req.user = {
      id: "user-1",
      careerSpecialization: "SOFTWARE_ENGINEERING",
      tier: "BASIC",
    } as never;
    next();
  },
}));
// Only the Anthropic call is stubbed — isTailoredResumeContent is a pure
// validator the PATCH route depends on, so it must stay the real one.
vi.mock("../services/tailoredResume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/tailoredResume")>()),
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
    // Default: the atomic quota-reservation UPDATE succeeds (returns a row).
    prismaMock.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
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

  it("POST returns 429 without generating once the daily limit is reached", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentTailored({ jobPostingHash: "stale-hash" }))
    );
    // The conditional UPDATE matched no row: today's count is already at the
    // cap, so the reservation is refused.
    prismaMock.$queryRaw.mockResolvedValue([]);

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("AI_QUOTA_EXCEEDED");
    expect(generateTailoredResumeMock).not.toHaveBeenCalled();
    expect(prismaMock.tailoredResume.upsert).not.toHaveBeenCalled();
  });

  it("POST refunds the reservation when the attempt fails before reaching the model", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentTailored({ jobPostingHash: "stale-hash" }))
    );
    // Nothing was billed, so retrying is free and the call must come back.
    getObjectTextMock.mockRejectedValueOnce(new Error("s3 read failed"));

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(500);
    expect(generateTailoredResumeMock).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", aiCallsUsedToday: { gt: 0 } },
      data: { aiCallsUsedToday: { decrement: 1 } },
    });
  });

  it("POST does not refund when the save fails after a billed generation", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentTailored({ jobPostingHash: "stale-hash" }))
    );
    // Claude answered and was paid for; only the write failed. Refunding here
    // would let a write that fails every time be replayed at no quota cost.
    prismaMock.tailoredResume.upsert.mockRejectedValueOnce(new Error("pool timeout"));

    const res = await request(app).post("/api/applications/app-1/tailored-resume");

    expect(res.status).toBe(500);
    expect(generateTailoredResumeMock).toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("PATCH rejects a non-object content", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app)
      .patch("/api/applications/app-1/tailored-resume")
      .send({ content: "not an object" });

    expect(res.status).toBe(400);
    expect(prismaMock.tailoredResume.update).not.toHaveBeenCalled();
  });

  // The download endpoint renders a saved draft straight to a PDF, reading
  // these fields without guards — a malformed draft must never reach the DB.
  it.each([
    ["an empty object", {}],
    ["a missing header", { ...makeTailoredContent(), header: undefined }],
    [
      "a non-string header name",
      { ...makeTailoredContent(), header: { name: 42, contact: [] } },
    ],
    [
      "a non-string contact entry",
      { ...makeTailoredContent(), header: { name: "Ada", contact: ["ok", 7] } },
    ],
    ["sections that aren't an array", { ...makeTailoredContent(), sections: "nope" }],
    [
      "a bullet missing `after`",
      makeTailoredContent({
        sections: [
          { title: "Experience", entries: [{ heading: null, bullets: [{ before: null }] }] },
        ],
      }),
    ],
  ])("PATCH rejects %s", async (_label, content) => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentTailored()));

    const res = await request(app)
      .patch("/api/applications/app-1/tailored-resume")
      .send({ content });

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
