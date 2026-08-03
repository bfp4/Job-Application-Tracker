import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { update: vi.fn() },
    premiumRequest: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
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
    });
    // Never leak firebaseUid.
    expect(res.body.user.firebaseUid).toBeUndefined();
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
