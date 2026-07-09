import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { makeBaseResume, makePosting } from "../test-helpers/fixtures";

const { prismaMock, getObjectTextMock, generateQuestionAnswerMock } = vi.hoisted(() => ({
  prismaMock: {
    application: { findFirst: vi.fn() },
    applicationQuestion: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    baseResume: { findFirst: vi.fn() },
  },
  getObjectTextMock: vi.fn(),
  generateQuestionAnswerMock: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/s3", () => ({ getObjectText: getObjectTextMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1" } as never;
    next();
  },
}));
vi.mock("../services/applicationQuestions", () => ({
  generateQuestionAnswer: generateQuestionAnswerMock,
}));

import applicationsRouter from "./applications";
import questionsRouter from "./questions";

const app = express();
app.use(express.json());
app.use("/api/applications", applicationsRouter);
app.use("/api/questions", questionsRouter);

const posting = makePosting();
const baseResume = makeBaseResume();

function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "question-1",
    applicationId: "app-1",
    question: "What are you proud of?",
    answer: null,
    ...overrides,
  };
}

describe("application questions endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.baseResume.findFirst.mockResolvedValue(baseResume);
    getObjectTextMock.mockResolvedValue("# Resume\nExperience...");
    generateQuestionAnswerMock.mockResolvedValue("I am proud of X.");
  });

  describe("POST /api/applications/:id/questions", () => {
    it("rejects a missing or empty question", async () => {
      const empty = await request(app)
        .post("/api/applications/app-1/questions")
        .send({ question: "   " });
      const missing = await request(app)
        .post("/api/applications/app-1/questions")
        .send({});

      expect(empty.status).toBe(400);
      expect(missing.status).toBe(400);
      expect(prismaMock.applicationQuestion.create).not.toHaveBeenCalled();
    });

    it("returns 404 for an application the user does not own", async () => {
      prismaMock.application.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/applications/app-1/questions")
        .send({ question: "Why us?" });

      expect(res.status).toBe(404);
    });

    it("creates the question trimmed", async () => {
      prismaMock.application.findFirst.mockResolvedValue({ id: "app-1", userId: "user-1" });
      prismaMock.applicationQuestion.create.mockResolvedValue(questionRow());

      const res = await request(app)
        .post("/api/applications/app-1/questions")
        .send({ question: "  Why us?  " });

      expect(res.status).toBe(201);
      expect(prismaMock.applicationQuestion.create).toHaveBeenCalledWith({
        data: { applicationId: "app-1", question: "Why us?" },
      });
    });
  });

  describe("PATCH /api/questions/:id", () => {
    it("returns 404 for a question the user does not own", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/questions/question-1")
        .send({ answer: "Hi" });

      expect(res.status).toBe(404);
      expect(prismaMock.applicationQuestion.findFirst).toHaveBeenCalledWith({
        where: { id: "question-1", application: { userId: "user-1" } },
      });
    });

    it("rejects invalid fields and empty updates", async () => {
      const badAnswer = await request(app)
        .patch("/api/questions/question-1")
        .send({ answer: 42 });
      const badQuestion = await request(app)
        .patch("/api/questions/question-1")
        .send({ question: "" });
      const noFields = await request(app).patch("/api/questions/question-1").send({});

      expect(badAnswer.status).toBe(400);
      expect(badQuestion.status).toBe(400);
      expect(noFields.status).toBe(400);
      expect(prismaMock.applicationQuestion.update).not.toHaveBeenCalled();
    });

    it("updates the answer (null clears it)", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(questionRow());
      prismaMock.applicationQuestion.update.mockResolvedValue(
        questionRow({ answer: null })
      );

      const res = await request(app)
        .patch("/api/questions/question-1")
        .send({ answer: null });

      expect(res.status).toBe(200);
      expect(prismaMock.applicationQuestion.update).toHaveBeenCalledWith({
        where: { id: "question-1" },
        data: { answer: null },
      });
    });
  });

  describe("DELETE /api/questions/:id", () => {
    it("returns 404 for a question the user does not own", async () => {
      prismaMock.applicationQuestion.deleteMany.mockResolvedValue({ count: 0 });

      expect((await request(app).delete("/api/questions/question-1")).status).toBe(404);
    });

    it("deletes an owned question", async () => {
      prismaMock.applicationQuestion.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app).delete("/api/questions/question-1");

      expect(res.status).toBe(204);
      // Ownership is enforced inside the deleteMany filter itself.
      expect(prismaMock.applicationQuestion.deleteMany).toHaveBeenCalledWith({
        where: { id: "question-1", application: { userId: "user-1" } },
      });
    });
  });

  describe("POST /api/questions/:id/answer", () => {
    function ownedQuestionWithContext(overrides: Record<string, unknown> = {}) {
      return questionRow({
        application: { id: "app-1", userId: "user-1", notes: "Met the team.", jobPosting: posting },
        ...overrides,
      });
    }

    it("returns 404 for a question the user does not own", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(null);

      const res = await request(app).post("/api/questions/question-1/answer");

      expect(res.status).toBe(404);
      expect(generateQuestionAnswerMock).not.toHaveBeenCalled();
    });

    it("returns 400 when the user has no resume", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(ownedQuestionWithContext());
      prismaMock.baseResume.findFirst.mockResolvedValue(null);

      const res = await request(app).post("/api/questions/question-1/answer");

      expect(res.status).toBe(400);
      expect(generateQuestionAnswerMock).not.toHaveBeenCalled();
    });

    it("rejects an unknown mode", async () => {
      const res = await request(app)
        .post("/api/questions/question-1/answer")
        .send({ mode: "remix" });

      expect(res.status).toBe(400);
      expect(generateQuestionAnswerMock).not.toHaveBeenCalled();
    });

    it("drafts from scratch (no existing draft) by default, and saves the answer", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(ownedQuestionWithContext());
      prismaMock.applicationQuestion.update.mockResolvedValue(
        questionRow({ answer: "I am proud of X." })
      );

      const res = await request(app).post("/api/questions/question-1/answer");

      expect(res.status).toBe(201);
      expect(getObjectTextMock).toHaveBeenCalledWith(baseResume.markdownS3Key);
      expect(generateQuestionAnswerMock).toHaveBeenCalledWith(
        "What are you proud of?",
        "# Resume\nExperience...",
        posting,
        "Met the team.",
        null
      );
      expect(prismaMock.applicationQuestion.update).toHaveBeenCalledWith({
        where: { id: "question-1" },
        data: { answer: "I am proud of X." },
      });
      expect(res.body.question.answer).toBe("I am proud of X.");
    });

    it("mode=new ignores the saved answer", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(
        ownedQuestionWithContext({ answer: "Old saved answer." })
      );
      prismaMock.applicationQuestion.update.mockResolvedValue(questionRow());

      await request(app).post("/api/questions/question-1/answer").send({ mode: "new" });

      expect(generateQuestionAnswerMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        posting,
        expect.anything(),
        null
      );
    });

    it("mode=refine passes the client's current draft to the AI", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(ownedQuestionWithContext());
      prismaMock.applicationQuestion.update.mockResolvedValue(questionRow());

      const res = await request(app)
        .post("/api/questions/question-1/answer")
        .send({ mode: "refine", draft: "My rough unsaved draft." });

      expect(res.status).toBe(201);
      expect(generateQuestionAnswerMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        posting,
        expect.anything(),
        "My rough unsaved draft."
      );
    });

    it("mode=refine falls back to the saved answer when no draft is sent", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(
        ownedQuestionWithContext({ answer: "Saved answer." })
      );
      prismaMock.applicationQuestion.update.mockResolvedValue(questionRow());

      const res = await request(app)
        .post("/api/questions/question-1/answer")
        .send({ mode: "refine" });

      expect(res.status).toBe(201);
      expect(generateQuestionAnswerMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        posting,
        expect.anything(),
        "Saved answer."
      );
    });

    it("mode=refine returns 400 when there is nothing to refine", async () => {
      prismaMock.applicationQuestion.findFirst.mockResolvedValue(
        ownedQuestionWithContext({ answer: null })
      );

      const res = await request(app)
        .post("/api/questions/question-1/answer")
        .send({ mode: "refine", draft: "   " });

      expect(res.status).toBe(400);
      expect(generateQuestionAnswerMock).not.toHaveBeenCalled();
    });
  });
});
