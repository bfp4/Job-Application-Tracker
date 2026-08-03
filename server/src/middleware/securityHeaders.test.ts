import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { securityHeaders } from "./securityHeaders";

/** A stand-in for index.ts's wiring: headers first, then whatever responds. */
function makeApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  return app;
}

describe("securityHeaders", () => {
  it("stops the page from being framed", async () => {
    const res = await request(makeApp()).get("/health");

    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets the remaining defensive headers", async () => {
    const res = await request(makeApp()).get("/health");

    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
  });

  it("doesn't advertise the framework", async () => {
    const res = await request(makeApp()).get("/health");

    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("still sets them on 404s and on thrown errors", async () => {
    const app = makeApp();

    const notFound = await request(app).get("/nope");
    expect(notFound.status).toBe(404);
    expect(notFound.headers["x-frame-options"]).toBe("DENY");

    const errored = await request(app).get("/boom");
    expect(errored.status).toBe(500);
    expect(errored.headers["x-frame-options"]).toBe("DENY");
  });
});
