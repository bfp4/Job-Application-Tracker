import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { upsert: vi.fn() },
    jobPosting: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../middleware/auth/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));

import jobsRouter from "./jobs";

const app = express();
app.use(express.json());
app.use("/api/jobs", jobsRouter);

const validBody = {
  jobUrl: "https://example.com/jobs/1",
  title: "Software Engineer",
  companyName: "Acme",
  location: ["New York, NY"],
  salary: "$120k",
  description: "Build things.",
};

describe("POST /api/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.company.upsert.mockResolvedValue({ id: "company-1", name: "Acme" });
    prismaMock.jobPosting.upsert.mockResolvedValue({ id: "posting-1" });
  });

  it("rejects non-http(s) URLs, including javascript: (stored-XSS vector)", async () => {
    for (const jobUrl of ["javascript:alert(1)", "ftp://example.com/x", "not a url"]) {
      const res = await request(app).post("/api/jobs").send({ ...validBody, jobUrl });
      expect(res.status).toBe(400);
      expect(prismaMock.jobPosting.upsert).not.toHaveBeenCalled();
    }
  });

  it("rejects a missing title or company name", async () => {
    expect((await request(app).post("/api/jobs").send({ ...validBody, title: "  " })).status).toBe(400);
    expect((await request(app).post("/api/jobs").send({ ...validBody, companyName: undefined })).status).toBe(400);
  });

  it("rejects a location that is not an array of non-empty strings", async () => {
    expect((await request(app).post("/api/jobs").send({ ...validBody, location: "NYC" })).status).toBe(400);
    expect((await request(app).post("/api/jobs").send({ ...validBody, location: ["NYC", ""] })).status).toBe(400);
  });

  it("saves a valid job scoped to the authenticated user", async () => {
    const res = await request(app).post("/api/jobs").send(validBody);

    expect(res.status).toBe(201);
    expect(prismaMock.jobPosting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_jobUrl: { userId: "user-1", jobUrl: validBody.jobUrl } },
        create: expect.objectContaining({ userId: "user-1", jobUrl: validBody.jobUrl }),
      })
    );
  });

  it("treats optional fields as absent rather than failing", async () => {
    const res = await request(app).post("/api/jobs").send({
      jobUrl: validBody.jobUrl,
      title: validBody.title,
      companyName: validBody.companyName,
    });

    expect(res.status).toBe(201);
    expect(prismaMock.jobPosting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ location: [], salary: null, description: null }),
      })
    );
  });
});

describe("PATCH /api/jobs/:id", () => {
  const existing = {
    id: "posting-1",
    userId: "user-1",
    jobUrl: validBody.jobUrl,
    title: validBody.title,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.company.upsert.mockResolvedValue({ id: "company-2", name: "Globex" });
    prismaMock.jobPosting.findFirst.mockResolvedValue(existing);
    prismaMock.jobPosting.update.mockResolvedValue({ ...existing, title: "Staff Engineer" });
  });

  it("updates only the fields provided", async () => {
    const res = await request(app)
      .patch("/api/jobs/posting-1")
      .send({ title: "  Staff Engineer  ", salary: "" });

    expect(res.status).toBe(200);
    expect(prismaMock.jobPosting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "posting-1" },
        // Trimmed, blank salary cleared, and nothing else touched.
        data: { title: "Staff Engineer", salary: null },
      })
    );
  });

  it("resolves a new company name to a Company row", async () => {
    const res = await request(app).patch("/api/jobs/posting-1").send({ companyName: "Globex" });

    expect(res.status).toBe(200);
    expect(prismaMock.company.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Globex" } })
    );
    expect(prismaMock.jobPosting.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { companyId: "company-2" } })
    );
  });

  it("rejects a non-http(s) URL (stored-XSS vector)", async () => {
    const res = await request(app)
      .patch("/api/jobs/posting-1")
      .send({ jobUrl: "javascript:alert(1)" });

    expect(res.status).toBe(400);
    expect(prismaMock.jobPosting.update).not.toHaveBeenCalled();
  });

  it("rejects an empty title rather than blanking it", async () => {
    const res = await request(app).patch("/api/jobs/posting-1").send({ title: "   " });

    expect(res.status).toBe(400);
    expect(prismaMock.jobPosting.update).not.toHaveBeenCalled();
  });

  it("rejects a body with no updatable fields", async () => {
    const res = await request(app).patch("/api/jobs/posting-1").send({ nope: true });

    expect(res.status).toBe(400);
    expect(prismaMock.jobPosting.update).not.toHaveBeenCalled();
  });

  it("404s on another user's posting", async () => {
    prismaMock.jobPosting.findFirst.mockResolvedValue(null);

    const res = await request(app).patch("/api/jobs/posting-1").send({ title: "Staff Engineer" });

    expect(res.status).toBe(404);
    expect(prismaMock.jobPosting.findFirst).toHaveBeenCalledWith({
      where: { id: "posting-1", userId: "user-1" },
    });
    expect(prismaMock.jobPosting.update).not.toHaveBeenCalled();
  });

  it("409s when the new URL is one the user already tracks", async () => {
    prismaMock.jobPosting.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ id: "posting-2" });

    const res = await request(app)
      .patch("/api/jobs/posting-1")
      .send({ jobUrl: "https://example.com/jobs/2" });

    expect(res.status).toBe(409);
    expect(prismaMock.jobPosting.update).not.toHaveBeenCalled();
  });

  it("allows a PATCH that re-sends the posting's own URL unchanged", async () => {
    const res = await request(app)
      .patch("/api/jobs/posting-1")
      .send({ jobUrl: validBody.jobUrl, title: "Staff Engineer" });

    expect(res.status).toBe(200);
    // No collision lookup: the URL didn't actually change.
    expect(prismaMock.jobPosting.findFirst).toHaveBeenCalledTimes(1);
  });
});
