import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { upsert: vi.fn() },
    jobPosting: { upsert: vi.fn() },
  },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
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
    prismaMock.company.upsert.mockResolvedValue({ id: "company-1", name: "Acme", website: null });
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
