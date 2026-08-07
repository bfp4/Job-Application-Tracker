import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    application: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    jobPosting: { findFirst: vi.fn() },
    timelineEntry: { create: vi.fn() },
  },
}));

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
// Every response carrying contacts fingerprints them against the current
// resume; these tests are about the source field, so there isn't one.
vi.mock("../../lib/baseResume", () => ({
  getLatestBaseResume: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../middleware/auth/auth", () => ({
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
      // contacts: [] mirrors applicationInclude — the route serializes them.
      prismaMock.application.create.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ id: "app-1", contacts: [], ...data })
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
        Promise.resolve({ id: "app-1", contacts: [], ...data })
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

  describe("PATCH /api/applications/:id status auto-logging", () => {
    it("creates a timeline entry when status actually changes", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", status: "APPLIED" });
      prismaMock.application.update.mockResolvedValue({
        id: "app-1",
        status: "PHONE_SCREEN",
        contacts: [],
      });
      prismaMock.application.findFirstOrThrow.mockResolvedValue({
        id: "app-1",
        status: "PHONE_SCREEN",
        contacts: [],
        timelineEntries: [{ id: "entry-1", status: "PHONE_SCREEN" }],
      });

      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ status: "PHONE_SCREEN", occurredAt: "2026-08-03" });

      expect(res.status).toBe(200);
      expect(prismaMock.timelineEntry.create).toHaveBeenCalledWith({
        data: {
          applicationId: "app-1",
          status: "PHONE_SCREEN",
          occurredAt: new Date("2026-08-03"),
        },
      });
      expect(prismaMock.application.findFirstOrThrow).toHaveBeenCalled();
    });

    it("dates the entry at UTC midnight when the client sends no occurredAt", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", status: "APPLIED" });
      prismaMock.application.update.mockResolvedValue({
        id: "app-1",
        status: "PHONE_SCREEN",
        contacts: [],
      });
      prismaMock.application.findFirstOrThrow.mockResolvedValue({
        id: "app-1",
        status: "PHONE_SCREEN",
        contacts: [],
        timelineEntries: [],
      });

      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ status: "PHONE_SCREEN" });

      expect(res.status).toBe(200);
      // Never the column's now() default: a real instant renders as the next
      // day for anyone west of UTC changing status in the evening.
      const { occurredAt } = prismaMock.timelineEntry.create.mock.calls[0][0].data;
      expect(occurredAt).toBeInstanceOf(Date);
      expect(occurredAt.toISOString()).toMatch(/T00:00:00\.000Z$/);
    });

    it("rejects an unparseable occurredAt", async () => {
      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ status: "PHONE_SCREEN", occurredAt: "not-a-date" });

      expect(res.status).toBe(400);
      expect(prismaMock.application.update).not.toHaveBeenCalled();
      expect(prismaMock.timelineEntry.create).not.toHaveBeenCalled();
    });

    it("does not treat occurredAt alone as a field to update", async () => {
      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ occurredAt: "2026-08-03" });

      expect(res.status).toBe(400);
      expect(prismaMock.application.update).not.toHaveBeenCalled();
    });

    it("does not log a duplicate when PATCHing the same status", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", status: "PHONE_SCREEN" });
      prismaMock.application.update.mockResolvedValue({
        id: "app-1",
        status: "PHONE_SCREEN",
        contacts: [],
      });

      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ status: "PHONE_SCREEN" });

      expect(res.status).toBe(200);
      expect(prismaMock.timelineEntry.create).not.toHaveBeenCalled();
      expect(prismaMock.application.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it("does not log anything when status isn't part of the PATCH", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", status: "APPLIED" });
      prismaMock.application.update.mockResolvedValue({
        id: "app-1",
        status: "APPLIED",
        contacts: [],
      });

      const res = await request(app)
        .patch("/api/applications/app-1")
        .send({ source: "Referral" });

      expect(res.status).toBe(200);
      expect(prismaMock.timelineEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/applications/:id/timeline-entries", () => {
    it("rejects a missing or invalid status", async () => {
      const missing = await request(app)
        .post("/api/applications/app-1/timeline-entries")
        .send({});
      const invalid = await request(app)
        .post("/api/applications/app-1/timeline-entries")
        .send({ status: "GHOSTED" });

      expect(missing.status).toBe(400);
      expect(invalid.status).toBe(400);
      expect(prismaMock.timelineEntry.create).not.toHaveBeenCalled();
    });

    it("returns 404 for an application the user does not own", async () => {
      prismaMock.application.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/applications/app-1/timeline-entries")
        .send({ status: "INTERVIEW" });

      expect(res.status).toBe(404);
    });

    it("creates a manual entry with an optional note and date", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", userId: "user-1" });
      prismaMock.timelineEntry.create.mockResolvedValue({
        id: "entry-1",
        applicationId: "app-1",
        status: "INTERVIEW",
        note: "Round 2 with the eng manager",
        occurredAt: new Date("2026-07-20"),
      });

      const res = await request(app)
        .post("/api/applications/app-1/timeline-entries")
        .send({ status: "INTERVIEW", note: "Round 2 with the eng manager", occurredAt: "2026-07-20" });

      expect(res.status).toBe(201);
      expect(prismaMock.timelineEntry.create).toHaveBeenCalledWith({
        data: {
          applicationId: "app-1",
          status: "INTERVIEW",
          note: "Round 2 with the eng manager",
          occurredAt: new Date("2026-07-20"),
        },
      });
    });
  });
});
