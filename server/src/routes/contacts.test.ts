import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    contact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const { generateConnectMessageMock, getLatestBaseResumeMock, getObjectTextMock } =
  vi.hoisted(() => ({
    generateConnectMessageMock: vi.fn(),
    getLatestBaseResumeMock: vi.fn(),
    getObjectTextMock: vi.fn(),
  }));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));
vi.mock("../services/linkedinMessage", () => ({
  generateConnectMessage: generateConnectMessageMock,
}));
vi.mock("../lib/baseResume", () => ({
  getLatestBaseResume: getLatestBaseResumeMock,
}));
vi.mock("../lib/s3", () => ({ getObjectText: getObjectTextMock }));

import applicationsRouter from "./applications";
import contactsRouter from "./contacts";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);
app.use("/api/contacts", contactsRouter);

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    applicationId: "app-1",
    name: "Dana Smith",
    position: "Engineering Manager",
    linkedinUrl: "https://www.linkedin.com/in/dana",
    phone: "+1 555 123 4567",
    email: "dana@company.com",
    notes: null,
    linkedinStatus: "NONE",
    connectMessage: null,
    ...overrides,
  };
}

describe("contacts endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/applications/:id/contacts", () => {
    it("rejects a missing or empty name", async () => {
      const empty = await request(app)
        .post("/api/applications/app-1/contacts")
        .send({ name: "   " });
      const missing = await request(app)
        .post("/api/applications/app-1/contacts")
        .send({ email: "dana@company.com" });

      expect(empty.status).toBe(400);
      expect(missing.status).toBe(400);
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });

    it("rejects a linkedinUrl that is not an http(s) URL", async () => {
      const res = await request(app)
        .post("/api/applications/app-1/contacts")
        .send({ name: "Dana", linkedinUrl: "javascript:alert(1)" });

      expect(res.status).toBe(400);
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });

    it("returns 404 for an application the user does not own", async () => {
      prismaMock.application.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/applications/app-1/contacts")
        .send({ name: "Dana" });

      expect(res.status).toBe(404);
      expect(prismaMock.contact.create).not.toHaveBeenCalled();
    });

    it("creates a contact, storing empty optional fields as null", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1" });
      prismaMock.contact.create.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ id: "contact-1", ...data })
      );

      const res = await request(app)
        .post("/api/applications/app-1/contacts")
        .send({
          name: "  Dana Smith  ",
          position: "   ",
          linkedinUrl: "",
          email: "dana@company.com",
        });

      expect(res.status).toBe(201);
      expect(prismaMock.contact.create).toHaveBeenCalledWith({
        data: {
          applicationId: "app-1",
          name: "Dana Smith",
          position: null,
          linkedinUrl: null,
          email: "dana@company.com",
        },
      });
      expect(res.body.contact.name).toBe("Dana Smith");
    });
  });

  describe("PATCH /api/contacts/:id", () => {
    it("rejects a body with no valid fields", async () => {
      const res = await request(app).patch("/api/contacts/contact-1").send({});

      expect(res.status).toBe(400);
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });

    it("rejects an invalid linkedinUrl", async () => {
      const res = await request(app)
        .patch("/api/contacts/contact-1")
        .send({ linkedinUrl: "not a url" });

      expect(res.status).toBe(400);
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });

    it("returns 404 for a contact the user does not own", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/contacts/contact-1")
        .send({ name: "Dana" });

      expect(res.status).toBe(404);
      expect(prismaMock.contact.findFirst).toHaveBeenCalledWith({
        where: { id: "contact-1", application: { userId: "user-1" } },
      });
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });

    it("updates only the provided fields", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(contactRow());
      prismaMock.contact.update.mockResolvedValue(
        contactRow({ position: "Director", notes: null })
      );

      const res = await request(app)
        .patch("/api/contacts/contact-1")
        .send({ position: "Director", notes: "" });

      expect(res.status).toBe(200);
      expect(prismaMock.contact.update).toHaveBeenCalledWith({
        where: { id: "contact-1" },
        data: { position: "Director", notes: null },
      });
      expect(res.body.contact.position).toBe("Director");
    });

    it("updates the LinkedIn status", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(contactRow());
      prismaMock.contact.update.mockResolvedValue(
        contactRow({ linkedinStatus: "CONNECTED" })
      );

      const res = await request(app)
        .patch("/api/contacts/contact-1")
        .send({ linkedinStatus: "CONNECTED" });

      expect(res.status).toBe(200);
      expect(prismaMock.contact.update).toHaveBeenCalledWith({
        where: { id: "contact-1" },
        data: { linkedinStatus: "CONNECTED" },
      });
    });

    it("rejects an unknown LinkedIn status", async () => {
      const res = await request(app)
        .patch("/api/contacts/contact-1")
        .send({ linkedinStatus: "PENDING" });

      expect(res.status).toBe(400);
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });

    it("rejects a connectMessage over 300 characters", async () => {
      const res = await request(app)
        .patch("/api/contacts/contact-1")
        .send({ connectMessage: "x".repeat(301) });

      expect(res.status).toBe(400);
      expect(prismaMock.contact.update).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/contacts/:id/connect-message", () => {
    function contactWithApplication(overrides: Record<string, unknown> = {}) {
      return {
        ...contactRow(overrides),
        application: {
          status: "APPLIED",
          notes: "Great culture fit.",
          jobPosting: { title: "Backend Engineer", company: { name: "Acme" } },
        },
      };
    }

    it("returns 404 for a contact the user does not own", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(null);
      getLatestBaseResumeMock.mockResolvedValue(null);

      const res = await request(app).post("/api/contacts/contact-1/connect-message");

      expect(res.status).toBe(404);
      expect(generateConnectMessageMock).not.toHaveBeenCalled();
    });

    it("generates a message from the resume and saves it", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(contactWithApplication());
      getLatestBaseResumeMock.mockResolvedValue({ markdownS3Key: "resume.md" });
      getObjectTextMock.mockResolvedValue("# Resume\nBackend engineer.");
      generateConnectMessageMock.mockResolvedValue("Hi Dana, I applied for the role…");
      prismaMock.contact.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve(contactRow({ ...data }))
      );

      const res = await request(app).post("/api/contacts/contact-1/connect-message");

      expect(res.status).toBe(201);
      expect(getObjectTextMock).toHaveBeenCalledWith("resume.md");
      expect(generateConnectMessageMock).toHaveBeenCalledWith(
        { name: "Dana Smith", position: "Engineering Manager", notes: null },
        expect.objectContaining({ title: "Backend Engineer" }),
        "APPLIED",
        "Great culture fit.",
        "# Resume\nBackend engineer."
      );
      expect(prismaMock.contact.update).toHaveBeenCalledWith({
        where: { id: "contact-1" },
        data: { connectMessage: "Hi Dana, I applied for the role…" },
      });
      expect(res.body.contact.connectMessage).toBe("Hi Dana, I applied for the role…");
    });

    it("still generates a message when no resume is uploaded", async () => {
      prismaMock.contact.findFirst.mockResolvedValue(contactWithApplication());
      getLatestBaseResumeMock.mockResolvedValue(null);
      generateConnectMessageMock.mockResolvedValue("Hi Dana…");
      prismaMock.contact.update.mockResolvedValue(
        contactRow({ connectMessage: "Hi Dana…" })
      );

      const res = await request(app).post("/api/contacts/contact-1/connect-message");

      expect(res.status).toBe(201);
      expect(getObjectTextMock).not.toHaveBeenCalled();
      expect(generateConnectMessageMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "APPLIED",
        expect.anything(),
        null
      );
    });
  });

  describe("DELETE /api/contacts/:id", () => {
    it("returns 404 when nothing was deleted", async () => {
      prismaMock.contact.deleteMany.mockResolvedValue({ count: 0 });

      const res = await request(app).delete("/api/contacts/contact-1");

      expect(res.status).toBe(404);
    });

    it("deletes with the ownership filter and returns 204", async () => {
      prismaMock.contact.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app).delete("/api/contacts/contact-1");

      expect(res.status).toBe(204);
      expect(prismaMock.contact.deleteMany).toHaveBeenCalledWith({
        where: { id: "contact-1", application: { userId: "user-1" } },
      });
    });
  });
});
