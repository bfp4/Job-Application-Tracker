import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  makeBaseResume,
  makeCoverLetterContent,
  makePosting,
} from "../test-helpers/fixtures";

const { prismaMock, getObjectTextMock, generateCoverLetterMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    baseResume: { findFirst: vi.fn() },
    coverLetter: { upsert: vi.fn(), update: vi.fn() },
  },
  getObjectTextMock: vi.fn(),
  generateCoverLetterMock: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/s3", () => ({ getObjectText: getObjectTextMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", careerSpecialization: "SOFTWARE_ENGINEERING" } as never;
    next();
  },
}));
// Only the Anthropic call is stubbed — isCoverLetterContent is a pure
// validator the PATCH route depends on, so it must stay the real one.
vi.mock("../services/coverLetter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/coverLetter")>()),
  generateCoverLetter: generateCoverLetterMock,
}));

import applicationsRouter from "./applications";
import { jobPostingFingerprint } from "../lib/prompt";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);

const posting = makePosting({ location: ["Remote"], salary: null, description: "Build things." });
const baseResume = makeBaseResume();
const content = makeCoverLetterContent();

function applicationRow(coverLetter: unknown = null) {
  return { id: "app-1", userId: "user-1", jobPosting: posting, coverLetter };
}

function currentLetter(overrides: Record<string, unknown> = {}) {
  return {
    id: "cl-1",
    applicationId: "app-1",
    baseResumeId: baseResume.id,
    jobPostingHash: jobPostingFingerprint(posting),
    content,
    edited: false,
    updatedAt: new Date("2026-07-25T00:00:00Z"),
    ...overrides,
  };
}

describe("cover-letter endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.baseResume.findFirst.mockResolvedValue(baseResume);
    getObjectTextMock.mockResolvedValue("# Resume\nExperience...");
    generateCoverLetterMock.mockResolvedValue(content);
    prismaMock.coverLetter.upsert.mockResolvedValue(currentLetter());
    prismaMock.coverLetter.update.mockResolvedValue(currentLetter({ edited: true }));
  });

  it("returns 404 for an application the user does not own", async () => {
    prismaMock.application.findFirst.mockResolvedValue(null);

    expect((await request(app).get("/api/applications/app-1/cover-letter")).status).toBe(404);
    expect((await request(app).post("/api/applications/app-1/cover-letter")).status).toBe(404);
    expect(generateCoverLetterMock).not.toHaveBeenCalled();
  });

  it("GET reports upToDate=true while resume and posting are unchanged", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app).get("/api/applications/app-1/cover-letter");

    expect(res.status).toBe(200);
    expect(res.body.upToDate).toBe(true);
    expect(res.body.hasResume).toBe(true);
  });

  it("GET reports upToDate=false after the user uploads a new resume", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));
    prismaMock.baseResume.findFirst.mockResolvedValue({ ...baseResume, id: "resume-2" });

    const res = await request(app).get("/api/applications/app-1/cover-letter");

    expect(res.body.upToDate).toBe(false);
  });

  it("POST returns 400 when the user has no resume", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow());
    prismaMock.baseResume.findFirst.mockResolvedValue(null);

    const res = await request(app).post("/api/applications/app-1/cover-letter");

    expect(res.status).toBe(400);
    expect(generateCoverLetterMock).not.toHaveBeenCalled();
  });

  it("POST refuses (409) while the saved letter is still current", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app).post("/api/applications/app-1/cover-letter");

    expect(res.status).toBe(409);
    expect(generateCoverLetterMock).not.toHaveBeenCalled();
    expect(prismaMock.coverLetter.upsert).not.toHaveBeenCalled();
  });

  it("POST refuses (409, needsForce) when the user has edited the letter", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentLetter({ edited: true }))
    );

    const res = await request(app).post("/api/applications/app-1/cover-letter");

    expect(res.status).toBe(409);
    expect(res.body.needsForce).toBe(true);
    expect(generateCoverLetterMock).not.toHaveBeenCalled();
  });

  it("POST with force=1 rewrites over an edited letter and clears the edited flag", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentLetter({ edited: true }))
    );

    const res = await request(app).post("/api/applications/app-1/cover-letter?force=1");

    expect(res.status).toBe(201);
    expect(generateCoverLetterMock).toHaveBeenCalledWith(
      "# Resume\nExperience...",
      posting,
      "SOFTWARE_ENGINEERING"
    );
    expect(prismaMock.coverLetter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ edited: false }) })
    );
  });

  it("POST generates and saves when the posting content has changed", async () => {
    prismaMock.application.findFirst.mockResolvedValue(
      applicationRow(currentLetter({ jobPostingHash: "stale-hash" }))
    );

    const res = await request(app).post("/api/applications/app-1/cover-letter");

    expect(res.status).toBe(201);
    expect(prismaMock.coverLetter.upsert).toHaveBeenCalledWith(
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
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app)
      .patch("/api/applications/app-1/cover-letter")
      .send({ content: "not an object" });

    expect(res.status).toBe(400);
    expect(prismaMock.coverLetter.update).not.toHaveBeenCalled();
  });

  // The download endpoint renders a saved letter straight to a PDF, reading
  // these fields without guards — a malformed letter must never reach the DB.
  it.each([
    ["an empty object", {}],
    ["a missing header", { ...makeCoverLetterContent(), header: undefined }],
    [
      "a non-string header name",
      { ...makeCoverLetterContent(), header: { name: 42, contact: [] } },
    ],
    [
      "a recipient field that is neither string nor null",
      makeCoverLetterContent({ recipient: { name: 7, title: null, company: null } }),
    ],
    ["paragraphs that aren't an array", makeCoverLetterContent({ paragraphs: "nope" })],
    ["a non-string paragraph", makeCoverLetterContent({ paragraphs: ["ok", 7] })],
    ["a missing closing", { ...makeCoverLetterContent(), closing: undefined }],
  ])("PATCH rejects %s", async (_label, content) => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app)
      .patch("/api/applications/app-1/cover-letter")
      .send({ content });

    expect(res.status).toBe(400);
    expect(prismaMock.coverLetter.update).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 when there is no letter to edit", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(null));

    const res = await request(app)
      .patch("/api/applications/app-1/cover-letter")
      .send({ content });

    expect(res.status).toBe(404);
  });

  it("PATCH saves edits and marks the letter edited", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app)
      .patch("/api/applications/app-1/cover-letter")
      .send({ content });

    expect(res.status).toBe(200);
    expect(prismaMock.coverLetter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationId: "app-1" },
        data: expect.objectContaining({ edited: true }),
      })
    );
    expect(res.body.letter.edited).toBe(true);
  });

  it("download rejects non-PDF formats", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app).get(
      "/api/applications/app-1/cover-letter/download?format=docx"
    );

    expect(res.status).toBe(400);
  });

  it("download returns 404 when there is no letter", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(null));

    const res = await request(app).get("/api/applications/app-1/cover-letter/download");

    expect(res.status).toBe(404);
  });

  it("download streams a PDF built from the current letter", async () => {
    prismaMock.application.findFirst.mockResolvedValue(applicationRow(currentLetter()));

    const res = await request(app)
      .get("/api/applications/app-1/cover-letter/download?format=pdf")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("Cover-Letter.pdf");
    expect((res.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
