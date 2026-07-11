import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    application: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    jobPosting: { findFirst: vi.fn() },
  },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));

import applicationsRouter from "./applications";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);

describe("application source field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/applications", () => {
    it("rejects a non-string source", async () => {
      const res = await request(app)
        .post("/api/applications")
        .send({ jobPostingId: "posting-1", source: 42 });

      expect(res.status).toBe(400);
      expect(prismaMock.application.create).not.toHaveBeenCalled();
    });

    it("stores a trimmed source on create and omits it when blank", async () => {
      prismaMock.jobPosting.findFirst.mockResolvedValue({ id: "posting-1" });
      prismaMock.application.findFirst.mockResolvedValue(null);
      prismaMock.application.create.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ id: "app-1", ...data })
      );

      const withSource = await request(app)
        .post("/api/applications")
        .send({ jobPostingId: "posting-1", source: "  LinkedIn  " });
      const blankSource = await request(app)
        .post("/api/applications")
        .send({ jobPostingId: "posting-1", source: "   " });

      expect(withSource.status).toBe(201);
      expect(prismaMock.application.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ source: "LinkedIn" }),
        })
      );
      expect(blankSource.status).toBe(201);
      expect(prismaMock.application.create.mock.calls[1][0].data).not.toHaveProperty("source");
    });
  });

  describe("PATCH /api/applications/:id", () => {
    it("rejects a non-string source", async () => {
      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ source: ["LinkedIn"] });

      expect(res.status).toBe(400);
      expect(prismaMock.application.update).not.toHaveBeenCalled();
    });

    it("updates source, storing blank and null as null", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1" });
      prismaMock.application.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ id: "app-1", ...data })
      );

      const set = await request(app)
        .patch("/api/applications/app-1")
        .send({ source: " Referral " });
      const blank = await request(app)
        .patch("/api/applications/app-1")
        .send({ source: "   " });
      const cleared = await request(app)
        .patch("/api/applications/app-1")
        .send({ source: null });

      expect(set.status).toBe(200);
      expect(prismaMock.application.update.mock.calls[0][0].data).toEqual({ source: "Referral" });
      expect(blank.status).toBe(200);
      expect(prismaMock.application.update.mock.calls[1][0].data).toEqual({ source: null });
      expect(cleared.status).toBe(200);
      expect(prismaMock.application.update.mock.calls[2][0].data).toEqual({ source: null });
    });
  });
});
