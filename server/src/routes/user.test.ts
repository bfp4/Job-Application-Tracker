import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { user: { update: vi.fn() } },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: "user-1",
      email: "ada@example.com",
      firebaseUid: "fb-1",
      resumeSpecialization: "GENERAL",
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
      resumeSpecialization: "GENERAL",
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
      .send({ resumeSpecialization: "ASTRONAUT" });

    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("PATCH /me updates a valid specialization", async () => {
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      firebaseUid: "fb-1",
      resumeSpecialization: "SOFTWARE_ENGINEERING",
    });

    const res = await request(app)
      .patch("/api/user/me")
      .send({ resumeSpecialization: "SOFTWARE_ENGINEERING" });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { resumeSpecialization: "SOFTWARE_ENGINEERING" },
    });
    expect(res.body.user.resumeSpecialization).toBe("SOFTWARE_ENGINEERING");
    expect(res.body.user.firebaseUid).toBeUndefined();
  });
});
