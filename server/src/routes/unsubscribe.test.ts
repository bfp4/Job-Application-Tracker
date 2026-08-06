import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import unsubscribeRouter from "./unsubscribe";

const app = express();
app.use("/unsubscribe", unsubscribeRouter);

const TOKEN = "tok-abc123";

describe("GET /unsubscribe", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The one behavior this whole route shape exists for. Mail providers and
   * corporate security scanners pre-fetch every link in a message; if GET
   * performed the opt-out, they would unsubscribe people who never clicked,
   * and the only symptom would be reminders silently stopping.
   */
  it("does not unsubscribe anyone — it only shows a confirmation form", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailOptOut: false });

    const res = await request(app).get(`/unsubscribe?u=${TOKEN}`);

    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(res.text).toContain("<form method=\"post\"");
    expect(res.text).toContain("Turn off reminder emails?");
  });

  it("looks the user up by token, never by id or email", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailOptOut: false });

    await request(app).get(`/unsubscribe?u=${TOKEN}`);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { unsubscribeToken: TOKEN },
      select: { emailOptOut: true },
    });
  });

  it("404s an unknown token without saying whether it ever existed", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/unsubscribe?u=nope");

    expect(res.status).toBe(404);
    expect(res.text).toContain("isn't valid");
  });

  it("404s when the token is missing entirely", async () => {
    const res = await request(app).get("/unsubscribe");

    expect(res.status).toBe(404);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  // ?u=a&u=b arrives as an array; treating it as a string would stringify to
  // "a,b" and hit the database with a token nobody has.
  it("404s a repeated u parameter rather than coercing the array", async () => {
    const res = await request(app).get("/unsubscribe?u=a&u=b");

    expect(res.status).toBe(404);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("tells an already-unsubscribed user so, instead of offering the form again", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailOptOut: true });

    const res = await request(app).get(`/unsubscribe?u=${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("already unsubscribed");
  });

  it("relaxes the CSP only as far as its own inline styles, still forbidding scripts", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailOptOut: false });

    const res = await request(app).get(`/unsubscribe?u=${TOKEN}`);
    const csp = res.headers["content-security-policy"];

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).not.toContain("script-src");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("POST /unsubscribe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets emailOptOut for the token's owner", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post(`/unsubscribe?u=${TOKEN}`);

    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { unsubscribeToken: TOKEN },
      data: { emailOptOut: true },
    });
    expect(res.text).toContain("You're unsubscribed");
  });

  /**
   * RFC 8058 one-click: Gmail and Outlook POST this URL directly from their own
   * Unsubscribe button, with a form-encoded body and no session, no cookie and
   * no CSRF token. It has to work exactly as sent.
   */
  it("accepts a bare provider one-click POST with a form body and no session", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post(`/unsubscribe?u=${TOKEN}`)
      .type("form")
      .send("List-Unsubscribe=One-Click");

    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
  });

  // Providers retry. A second POST must not look like a failure.
  it("is idempotent — a repeat POST still reports success", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    const first = await request(app).post(`/unsubscribe?u=${TOKEN}`);
    const second = await request(app).post(`/unsubscribe?u=${TOKEN}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("404s a token that matches nobody", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post("/unsubscribe?u=nope");

    expect(res.status).toBe(404);
  });

  it("404s a missing token without writing", async () => {
    const res = await request(app).post("/unsubscribe");

    expect(res.status).toBe(404);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});
