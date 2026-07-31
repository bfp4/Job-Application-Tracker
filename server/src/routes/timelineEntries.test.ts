import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    timelineEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));

import timelineEntriesRouter from "./timelineEntries";

const app = express();
app.use(express.json());
app.use("/api/timeline-entries", timelineEntriesRouter);

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    applicationId: "app-1",
    status: "APPLIED",
    note: null,
    occurredAt: new Date("2026-07-01"),
    ...overrides,
  };
}

describe("timeline entry endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PATCH /api/timeline-entries/:id", () => {
    it("returns 404 for an entry the user does not own", async () => {
      prismaMock.timelineEntry.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/timeline-entries/entry-1")
        .send({ note: "Went well" });

      expect(res.status).toBe(404);
      expect(prismaMock.timelineEntry.findFirst).toHaveBeenCalledWith({
        where: { id: "entry-1", application: { userId: "user-1" } },
      });
      expect(prismaMock.timelineEntry.update).not.toHaveBeenCalled();
    });

    it("rejects invalid fields and empty updates", async () => {
      const badNote = await request(app)
        .patch("/api/timeline-entries/entry-1")
        .send({ note: 42 });
      const badDate = await request(app)
        .patch("/api/timeline-entries/entry-1")
        .send({ occurredAt: "not-a-date" });
      const noFields = await request(app).patch("/api/timeline-entries/entry-1").send({});

      expect(badNote.status).toBe(400);
      expect(badDate.status).toBe(400);
      expect(noFields.status).toBe(400);
      expect(prismaMock.timelineEntry.update).not.toHaveBeenCalled();
    });

    it("updates the note (null clears it)", async () => {
      prismaMock.timelineEntry.findFirst.mockResolvedValue(entryRow());
      prismaMock.timelineEntry.update.mockResolvedValue(entryRow({ note: null }));

      const res = await request(app)
        .patch("/api/timeline-entries/entry-1")
        .send({ note: null });

      expect(res.status).toBe(200);
      expect(prismaMock.timelineEntry.update).toHaveBeenCalledWith({
        where: { id: "entry-1" },
        data: { note: null },
      });
    });

    it("updates occurredAt", async () => {
      prismaMock.timelineEntry.findFirst.mockResolvedValue(entryRow());
      prismaMock.timelineEntry.update.mockResolvedValue(
        entryRow({ occurredAt: new Date("2026-07-15") })
      );

      const res = await request(app)
        .patch("/api/timeline-entries/entry-1")
        .send({ occurredAt: "2026-07-15" });

      expect(res.status).toBe(200);
      expect(prismaMock.timelineEntry.update).toHaveBeenCalledWith({
        where: { id: "entry-1" },
        data: { occurredAt: new Date("2026-07-15") },
      });
    });
  });

  describe("DELETE /api/timeline-entries/:id", () => {
    it("returns 404 for an entry the user does not own", async () => {
      prismaMock.timelineEntry.findFirst.mockResolvedValue(null);

      const res = await request(app).delete("/api/timeline-entries/entry-1");

      expect(res.status).toBe(404);
      expect(prismaMock.timelineEntry.delete).not.toHaveBeenCalled();
    });

    it("deletes an owned entry", async () => {
      prismaMock.timelineEntry.findFirst.mockResolvedValue(entryRow());
      prismaMock.timelineEntry.delete.mockResolvedValue(entryRow());

      const res = await request(app).delete("/api/timeline-entries/entry-1");

      expect(res.status).toBe(204);
      expect(prismaMock.timelineEntry.delete).toHaveBeenCalledWith({ where: { id: "entry-1" } });
    });
  });
});
