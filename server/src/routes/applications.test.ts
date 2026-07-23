import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock, scrapeLinkedInProfileMock } = vi.hoisted(() => ({
  prismaMock: {
    application: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    jobPosting: { findFirst: vi.fn() },
    contact: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  scrapeLinkedInProfileMock: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));
vi.mock("../services/linkedProfileScraper", () => ({
  scrapeLinkedInProfile: scrapeLinkedInProfileMock,
  LinkedInScrapeError: class LinkedInScrapeError extends Error {},
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

describe("auto-set applied date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps appliedDate when creating with status APPLIED", async () => {
    prismaMock.jobPosting.findFirst.mockResolvedValue({ id: "posting-1" });
    prismaMock.application.findFirst.mockResolvedValue(null);
    prismaMock.application.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: "app-1", ...data })
    );

    const applied = await request(app)
      .post("/api/applications")
      .send({ jobPostingId: "posting-1", status: "APPLIED" });
    const notApplied = await request(app)
      .post("/api/applications")
      .send({ jobPostingId: "posting-1", status: "NOT_APPLIED" });

    expect(applied.status).toBe(201);
    expect(prismaMock.application.create.mock.calls[0][0].data.appliedDate).toBeInstanceOf(Date);
    expect(notApplied.status).toBe(201);
    expect(prismaMock.application.create.mock.calls[1][0].data).not.toHaveProperty("appliedDate");
  });

  it("stamps appliedDate on the first status change to APPLIED", async () => {
    prismaMock.application.findFirst.mockResolvedValue({
      id: "app-1",
      status: "NOT_APPLIED",
      appliedDate: null,
    });
    prismaMock.application.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: "app-1", ...data })
    );

    const res = await request(app)
      .patch("/api/applications/app-1")
      .send({ status: "APPLIED" });

    expect(res.status).toBe(200);
    expect(prismaMock.application.update.mock.calls[0][0].data.status).toBe("APPLIED");
    expect(prismaMock.application.update.mock.calls[0][0].data.appliedDate).toBeInstanceOf(Date);
  });

  it("does not overwrite an existing appliedDate on later moves to APPLIED", async () => {
    prismaMock.application.findFirst.mockResolvedValue({
      id: "app-1",
      status: "REJECTED",
      appliedDate: new Date("2026-07-01T00:00:00Z"),
    });
    prismaMock.application.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: "app-1", ...data })
    );

    const res = await request(app)
      .patch("/api/applications/app-1")
      .send({ status: "APPLIED" });

    expect(res.status).toBe(200);
    expect(prismaMock.application.update.mock.calls[0][0].data).toEqual({ status: "APPLIED" });
  });

  it("lets an explicit appliedDate in the same request win", async () => {
    prismaMock.application.findFirst.mockResolvedValue({
      id: "app-1",
      status: "NOT_APPLIED",
      appliedDate: null,
    });
    prismaMock.application.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: "app-1", ...data })
    );

    const res = await request(app)
      .patch("/api/applications/app-1")
      .send({ status: "APPLIED", appliedDate: "2026-06-30" });

    expect(res.status).toBe(200);
    expect(prismaMock.application.update.mock.calls[0][0].data.appliedDate).toEqual(
      new Date("2026-06-30")
    );
  });

  it("still allows manually changing or clearing appliedDate without a status change", async () => {
    prismaMock.application.findFirst.mockResolvedValue({
      id: "app-1",
      status: "APPLIED",
      appliedDate: new Date("2026-07-01T00:00:00Z"),
    });
    prismaMock.application.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: "app-1", ...data })
    );

    const changed = await request(app)
      .patch("/api/applications/app-1")
      .send({ appliedDate: "2026-07-05" });
    const cleared = await request(app)
      .patch("/api/applications/app-1")
      .send({ appliedDate: null });

    expect(changed.status).toBe(200);
    expect(prismaMock.application.update.mock.calls[0][0].data).toEqual({
      appliedDate: new Date("2026-07-05"),
    });
    expect(cleared.status).toBe(200);
    expect(prismaMock.application.update.mock.calls[1][0].data).toEqual({ appliedDate: null });
  });
});

// Flushes the microtask queue so the fire-and-forget scrape promise's
// then/catch/finally chain (not awaited by the route) has a chance to run
// before assertions check its effects.
function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("POST /api/applications/:id/scrape-linkedin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a missing linkedinUrl", async () => {
    const res = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({});

    expect(res.status).toBe(400);
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it("rejects a non-http linkedinUrl", async () => {
    const res = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({ linkedinUrl: "javascript:alert(1)" });

    expect(res.status).toBe(400);
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it("404s when the application doesn't belong to the user", async () => {
    prismaMock.application.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({ linkedinUrl: "https://www.linkedin.com/in/someone" });

    expect(res.status).toBe(404);
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING placeholder contact immediately, then DONE once the scrape resolves", async () => {
    prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", userId: "user-1" });
    prismaMock.contact.create.mockResolvedValue({
      id: "contact-1",
      applicationId: "app-1",
      name: "New contact",
      linkedinUrl: "https://www.linkedin.com/in/someone",
      scrapedStatus: "PENDING",
    });
    prismaMock.contact.update.mockResolvedValue({});
    scrapeLinkedInProfileMock.mockResolvedValue({ name: "Dana Smith", position: "Recruiter" });

    const res = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({ linkedinUrl: "https://www.linkedin.com/in/someone" });

    expect(res.status).toBe(201);
    expect(res.body.contact.scrapedStatus).toBe("PENDING");
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: {
        applicationId: "app-1",
        name: "New contact",
        linkedinUrl: "https://www.linkedin.com/in/someone",
        scrapedStatus: "PENDING",
      },
    });

    await flushAsync();

    expect(prismaMock.contact.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: {
        name: "Dana Smith",
        position: "Recruiter",
        scrapedStatus: "DONE",
        scrapedAt: expect.any(Date),
      },
    });
  });

  it("marks the contact FAILED when the scrape throws", async () => {
    prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", userId: "user-1" });
    prismaMock.contact.create.mockResolvedValue({
      id: "contact-2",
      name: "New contact",
      scrapedStatus: "PENDING",
    });
    prismaMock.contact.update.mockResolvedValue({});
    scrapeLinkedInProfileMock.mockRejectedValue(new Error("LinkedIn served a login wall"));

    const res = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({ linkedinUrl: "https://www.linkedin.com/in/someone" });

    expect(res.status).toBe(201);

    await flushAsync();

    expect(prismaMock.contact.update).toHaveBeenCalledWith({
      where: { id: "contact-2" },
      data: { scrapedStatus: "FAILED" },
    });
  });

  it("refuses a second scrape while one is already running", async () => {
    prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", userId: "user-1" });
    prismaMock.contact.create.mockResolvedValue({
      id: "contact-3",
      name: "New contact",
      scrapedStatus: "PENDING",
    });
    prismaMock.contact.update.mockResolvedValue({});

    let resolveScrape!: (value: { name: string | null; position: string | null }) => void;
    scrapeLinkedInProfileMock.mockReturnValue(
      new Promise((resolve) => {
        resolveScrape = resolve;
      })
    );

    // The response returns as soon as the placeholder contact is created —
    // before the scrape resolves — so awaiting it guarantees the in-flight
    // lock is already held for the second request.
    const first = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({ linkedinUrl: "https://www.linkedin.com/in/first" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/applications/app-1/scrape-linkedin")
      .send({ linkedinUrl: "https://www.linkedin.com/in/second" });

    expect(second.status).toBe(409);
    expect(prismaMock.contact.create).toHaveBeenCalledTimes(1);

    // Release the lock so this test doesn't leak PENDING state into the next.
    resolveScrape({ name: null, position: null });
    await flushAsync();
  });
});
