import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { verifyIdToken, prismaMock } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  prismaMock: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));

vi.mock("../../lib/firebaseAdmin", () => ({ adminAuth: { verifyIdToken } }));
vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));

import { authenticate } from "./auth";

const app = express();
app.use(authenticate);
app.get("/probe", (req, res) => res.json({ userId: req.user?.id }));

function get(token?: string) {
  const req = request(app).get("/probe");
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

const dbUser = {
  id: "user-1",
  email: "ada@example.com",
  firebaseUid: "fb-1",
  careerSpecialization: "GENERAL",
};

describe("authenticate middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s when the Authorization header is missing", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("401s when the token is invalid", async () => {
    verifyIdToken.mockRejectedValue(new Error("bad token"));
    const res = await get("garbage");
    expect(res.status).toBe(401);
  });

  it("403s with EMAIL_NOT_VERIFIED when the email is unconfirmed", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "fb-1",
      email: "ada@example.com",
      email_verified: false,
    });
    const res = await get("token");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("passes through for an existing user with a verified email", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "fb-1",
      email: "ada@example.com",
      email_verified: true,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce(dbUser);
    const res = await get("token");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-1");
  });

  it("creates a user on first verified sign-in when the email is unclaimed", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "fb-new",
      email: "grace@example.com",
      email_verified: true,
    });
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // by firebaseUid
      .mockResolvedValueOnce(null); // by email
    prismaMock.user.create.mockResolvedValue({ ...dbUser, id: "user-2", firebaseUid: "fb-new" });
    const res = await get("token");
    expect(res.status).toBe(200);
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { firebaseUid: "fb-new", email: "grace@example.com" },
    });
  });

  it("409s rather than rebinding an email already owned by another UID", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "fb-attacker",
      email: "ada@example.com",
      email_verified: true,
    });
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // by firebaseUid
      .mockResolvedValueOnce(dbUser); // by email, owned by fb-1
    const res = await get("token");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_ALREADY_LINKED");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
