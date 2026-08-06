import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";

const { prismaMock, s3Mock, adminAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { update: vi.fn(), findUniqueOrThrow: vi.fn(), delete: vi.fn() },
    premiumRequest: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    application: { findMany: vi.fn(), deleteMany: vi.fn() },
    jobPosting: { findMany: vi.fn(), deleteMany: vi.fn() },
    baseResume: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
  s3Mock: { deleteObjects: vi.fn(), getObjectText: vi.fn() },
  adminAuthMock: { deleteUser: vi.fn() },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/s3", () => s3Mock);
vi.mock("../lib/firebaseAdmin", () => ({ adminAuth: adminAuthMock, default: {} }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: "user-1",
      email: "ada@example.com",
      firebaseUid: "fb-1",
      careerSpecialization: "GENERAL",
      tier: "BASIC",
      aiCallsUsedToday: 0,
      aiCallsDate: null,
      emailOptOut: false,
      unsubscribeToken: "tok-1",
    } as never;
    next();
  },
}));

import userRouter from "./user";

const app = express();
app.use(express.json());
app.use("/api/user", userRouter);

describe("user settings endpoints", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /me returns the user's settings and the specialization options", async () => {
    const res = await request(app).get("/api/user/me");

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: "user-1",
      email: "ada@example.com",
      careerSpecialization: "GENERAL",
      tier: "BASIC",
      aiCallsUsedToday: 0,
      aiCallsRemaining: 10,
      pendingPremiumRequest: false,
      emailOptOut: false,
    });
    // Never leak firebaseUid — nor unsubscribeToken, which is the bearer
    // credential for the unauthenticated /unsubscribe route.
    expect(res.body.user.firebaseUid).toBeUndefined();
    expect(res.body.user.unsubscribeToken).toBeUndefined();
    expect(res.body.specializationOptions).toEqual(
      expect.arrayContaining([
        { value: "SOFTWARE_ENGINEERING", label: "Software Engineering" },
        { value: "FINANCE", label: "Finance & Banking" },
      ])
    );
  });

  it("PATCH /me rejects an unknown specialization", async () => {
    const res = await request(app)
      .patch("/api/user/me")
      .send({ careerSpecialization: "ASTRONAUT" });

    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PATCH /me updates a valid specialization", async () => {
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firebaseUid: "fb-1",
      careerSpecialization: "SOFTWARE_ENGINEERING",
      tier: "BASIC",
      aiCallsUsedToday: 0,
      aiCallsDate: null,
      emailOptOut: false,
    });

    const res = await request(app)
      .patch("/api/user/me")
      .send({ careerSpecialization: "SOFTWARE_ENGINEERING" });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { careerSpecialization: "SOFTWARE_ENGINEERING" },
    });
    expect(res.body.user.careerSpecialization).toBe("SOFTWARE_ENGINEERING");
    expect(res.body.user.firebaseUid).toBeUndefined();
  });

  it("PATCH /me sets emailOptOut on its own, without touching specialization", async () => {
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firebaseUid: "fb-1",
      careerSpecialization: "GENERAL",
      tier: "BASIC",
      aiCallsUsedToday: 0,
      aiCallsDate: null,
      emailOptOut: true,
    });

    const res = await request(app).patch("/api/user/me").send({ emailOptOut: true });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailOptOut: true },
    });
    expect(res.body.user.emailOptOut).toBe(true);
  });

  // A string "false" is truthy, so a client that stringified the value would
  // otherwise unsubscribe a user who was turning reminders back ON.
  it("PATCH /me rejects a non-boolean emailOptOut", async () => {
    const res = await request(app).patch("/api/user/me").send({ emailOptOut: "false" });

    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PATCH /me rejects a patch with no known field rather than reporting a save", async () => {
    const res = await request(app).patch("/api/user/me").send({ nickname: "Ada" });

    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/user/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.baseResume.findMany.mockResolvedValue([
      { pdfS3Key: "resumes/user-1/base-1.pdf", markdownS3Key: "resumes/user-1/base-1.md" },
      { pdfS3Key: "resumes/user-1/base-2.pdf", markdownS3Key: "resumes/user-1/base-2.md" },
    ]);
    prismaMock.$transaction.mockResolvedValue([]);
    s3Mock.deleteObjects.mockResolvedValue(undefined);
    adminAuthMock.deleteUser.mockResolvedValue(undefined);
  });

  it("deletes the S3 objects, the database rows, and the Firebase user", async () => {
    const res = await request(app).delete("/api/user/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, firebaseUserRemoved: true });
    expect(s3Mock.deleteObjects).toHaveBeenCalledWith([
      "resumes/user-1/base-1.pdf",
      "resumes/user-1/base-1.md",
      "resumes/user-1/base-2.pdf",
      "resumes/user-1/base-2.md",
    ]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(adminAuthMock.deleteUser).toHaveBeenCalledWith("fb-1");
  });

  // The BaseResume rows are the only index of which S3 objects belong to this
  // user. Dropping them before the objects are gone would strand the resume
  // PDFs in the bucket with nothing pointing at them — the exact personal data
  // the deletion exists to erase, left undeletable.
  it("does not touch the database when the S3 delete fails", async () => {
    s3Mock.deleteObjects.mockRejectedValue(new Error("AccessDenied"));

    const res = await request(app).delete("/api/user/me");

    expect(res.status).toBe(500);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(adminAuthMock.deleteUser).not.toHaveBeenCalled();
  });

  // Firebase goes last so this failure mode is the recoverable one: the user's
  // data is already gone and only an empty login remains. Reporting 500 would
  // read as "nothing happened" and invite a retry that finds nothing to erase.
  it("reports success with a warning when only the Firebase removal fails", async () => {
    adminAuthMock.deleteUser.mockRejectedValue(new Error("user-not-found"));

    const res = await request(app).delete("/api/user/me");

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.firebaseUserRemoved).toBe(false);
    expect(res.body.warning).toMatch(/data has been deleted/i);
  });

  it("succeeds for a user who never uploaded a resume", async () => {
    prismaMock.baseResume.findMany.mockResolvedValue([]);

    const res = await request(app).delete("/api/user/me");

    expect(res.status).toBe(200);
    expect(s3Mock.deleteObjects).toHaveBeenCalledWith([]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/user/me/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      email: "ada@example.com",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      careerSpecialization: "GENERAL",
      tier: "BASIC",
      emailOptOut: false,
    });
    prismaMock.application.findMany.mockResolvedValue([
      { id: "app-1", notes: "spoke to the recruiter", contacts: [{ name: "Grace H." }] },
    ]);
    prismaMock.jobPosting.findMany.mockResolvedValue([{ id: "jp-1" }]);
    prismaMock.baseResume.findMany.mockResolvedValue([
      { id: "br-1", createdAt: new Date("2026-02-01T00:00:00Z"), markdownS3Key: "k1" },
    ]);
    prismaMock.premiumRequest.findMany.mockResolvedValue([]);
    s3Mock.getObjectText.mockResolvedValue("# Ada Lovelace\n\nEngineer");
  });

  it("returns the account, applications, postings and resume text as an attachment", async () => {
    const res = await request(app).get("/api/user/me/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="jobtracker-export-/);
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = JSON.parse(res.text);
    expect(body.account.email).toBe("ada@example.com");
    expect(body.applications[0].notes).toBe("spoke to the recruiter");
    expect(body.applications[0].contacts[0].name).toBe("Grace H.");
    expect(body.jobPostings).toHaveLength(1);
    expect(body.resumes[0].markdown).toBe("# Ada Lovelace\n\nEngineer");
  });

  // An S3 object that has gone missing must not cost the user every other
  // thing in their export — an access request that 500s is a denied one.
  it("still exports everything else when a resume can't be read from S3", async () => {
    s3Mock.getObjectText.mockRejectedValue(new Error("NoSuchKey"));

    const res = await request(app).get("/api/user/me/export");

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.resumes[0].markdown).toBeNull();
    expect(body.account.email).toBe("ada@example.com");
  });

  // The two reasons text can be absent report differently. Saying "nothing was
  // omitted" over a null we failed to read would make an Art. 15 response claim
  // a completeness it does not have.
  it("flags an unreadable resume as unavailable, not as omitted", async () => {
    s3Mock.getObjectText.mockRejectedValue(new Error("NoSuchKey"));

    const res = await request(app).get("/api/user/me/export");

    const body = JSON.parse(res.text);
    expect(body.resumes[0]).toMatchObject({
      markdown: null,
      markdownOmitted: false,
      markdownUnavailable: true,
    });
  });

  it("flags resumes past the text limit as omitted, not as unavailable", async () => {
    prismaMock.baseResume.findMany.mockResolvedValue(
      Array.from({ length: 26 }, (_, i) => ({
        id: `br-${i}`,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        markdownS3Key: `k${i}`,
      }))
    );

    const res = await request(app).get("/api/user/me/export");

    const body = JSON.parse(res.text);
    expect(body.resumes[0]).toMatchObject({
      markdownOmitted: false,
      markdownUnavailable: false,
    });
    // The 26th is past EXPORT_RESUME_TEXT_LIMIT, so its text was never fetched.
    expect(body.resumes[25]).toMatchObject({
      markdown: null,
      markdownOmitted: true,
      markdownUnavailable: false,
    });
    expect(s3Mock.getObjectText).toHaveBeenCalledTimes(25);
  });
});

describe("POST /api/user/premium-requests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a request when the user is BASIC with no existing pending request", async () => {
    prismaMock.premiumRequest.findFirst.mockResolvedValue(null);
    prismaMock.premiumRequest.create.mockResolvedValue({ id: "req-1" });

    const res = await request(app)
      .post("/api/user/premium-requests")
      .send({ message: "Please upgrade me" });

    expect(res.status).toBe(201);
    expect(prismaMock.premiumRequest.create).toHaveBeenCalledWith({
      data: { userId: "user-1", message: "Please upgrade me" },
    });
  });

  it("rejects an empty message", async () => {
    const res = await request(app).post("/api/user/premium-requests").send({ message: "   " });

    expect(res.status).toBe(400);
    expect(prismaMock.premiumRequest.create).not.toHaveBeenCalled();
  });

  it("409s the fast-path when a pending request already exists", async () => {
    prismaMock.premiumRequest.findFirst.mockResolvedValue({ id: "req-existing" });

    const res = await request(app)
      .post("/api/user/premium-requests")
      .send({ message: "Please upgrade me" });

    expect(res.status).toBe(409);
    expect(prismaMock.premiumRequest.create).not.toHaveBeenCalled();
  });

  it("409s on a unique-constraint race (two concurrent submits both pass the pre-check)", async () => {
    // Both requests read "no existing pending" before either creates — the
    // DB's partial unique index is what actually stops the second insert.
    prismaMock.premiumRequest.findFirst.mockResolvedValue(null);
    prismaMock.premiumRequest.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );

    const res = await request(app)
      .post("/api/user/premium-requests")
      .send({ message: "Please upgrade me" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already have a pending premium request/i);
  });
});
