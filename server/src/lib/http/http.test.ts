import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { asyncHandler, errorHandler } from "./http";
import { ContentRefusedError } from "../anthropic/anthropic";

/** A stand-in for index.ts's wiring: a route that throws, then the handler. */
function makeApp(thrown: unknown) {
  const app = express();
  app.get(
    "/boom",
    asyncHandler(async () => {
      throw thrown;
    })
  );
  app.use(errorHandler);
  return app;
}

/**
 * Everything console.error was handed, flattened, so a leak is findable.
 *
 * Errors are rendered by hand rather than through JSON.stringify: `message` is
 * a non-enumerable own property, so stringifying an Error silently drops the
 * very field these tests exist to check. Node's console.error prints the stack
 * (name + message included), so this matches what actually reaches the log.
 */
function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  const render = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    return JSON.stringify(value);
  };
  return spy.mock.calls.map((args) => args.map(render).join(" ")).join("\n");
}

describe("errorHandler", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    spy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("keeps a Prisma validation error's arguments out of the log", async () => {
    // The shape that makes this the worst offender: Prisma renders the query
    // arguments into the message, so the user's own text is inside `message`.
    const err = new Prisma.PrismaClientValidationError(
      "Invalid `prisma.application.update()` invocation:\n\n" +
        "{ data: { notes: 'Spoke to Dana on Tuesday, her number is 555-0142' } }",
      { clientVersion: "5.22.0" }
    );

    const res = await request(makeApp(err)).get("/boom");

    expect(res.status).toBe(500);
    expect(loggedText(spy)).not.toContain("555-0142");
    expect(loggedText(spy)).not.toContain("Dana");
    // Still enough to identify what broke.
    expect(loggedText(spy)).toContain("PrismaClientValidationError");
  });

  it("logs a known request error's columns but never its values", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "5.22.0", meta: { target: ["email"] } }
    );

    await request(makeApp(err)).get("/boom");

    const text = loggedText(spy);
    expect(text).toContain("P2002");
    expect(text).toContain("email"); // the column name, which is safe
  });

  it("truncates an unrecognized error's message", async () => {
    const err = new Error("x".repeat(5000));

    await request(makeApp(err)).get("/boom");

    // 500 chars of message, and nothing approaching the original 5000.
    expect(loggedText(spy)).toContain("x".repeat(500));
    expect(loggedText(spy)).not.toContain("x".repeat(501));
  });

  it("doesn't log the query string", async () => {
    await request(makeApp(new Error("nope"))).get(
      "/boom?search=someone%40example.com"
    );

    const text = loggedText(spy);
    expect(text).not.toContain("someone@example.com");
    expect(text).not.toContain("search=");
    expect(text).toContain("/boom"); // the path itself still identifies the route
  });

  it("returns an errorId that matches the log line", async () => {
    const res = await request(makeApp(new Error("nope"))).get("/boom");

    expect(res.body.errorId).toMatch(/^[0-9a-f]{8}$/);
    // The whole point: a user quoting this id is enough to find the failure.
    expect(loggedText(spy)).toContain(res.body.errorId);
  });

  it("never leaks details to the caller", async () => {
    const err = new Prisma.PrismaClientValidationError("secret-argument-dump", {
      clientVersion: "5.22.0",
    });

    const res = await request(makeApp(err)).get("/boom");

    expect(res.body.error).toBe("Something went wrong. Please try again.");
    expect(JSON.stringify(res.body)).not.toContain("secret-argument-dump");
  });

  it("still maps a content refusal to 422 with its reason", async () => {
    const res = await request(makeApp(new ContentRefusedError("harassment"))).get(
      "/boom"
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CONTENT_REFUSED");
    expect(res.body.error).toContain("Claude declined");
  });

  it("logs the error in full outside production", async () => {
    process.env.NODE_ENV = "development";
    const err = new Prisma.PrismaClientValidationError("full argument dump here", {
      clientVersion: "5.22.0",
    });

    await request(makeApp(err)).get("/boom");

    // Local debugging is deliberately unaffected by the redaction above.
    expect(loggedText(spy)).toContain("full argument dump here");
  });
});
