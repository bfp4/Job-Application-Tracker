import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }));

vi.mock("firebase-admin/app-check", () => ({ getAppCheck: () => ({ verifyToken }) }));
vi.mock("../lib/firebaseAdmin", () => ({ default: {}, adminAuth: {} }));

import {
  AppCheckConfigError,
  assertAppCheckConfigured,
  isAppCheckEnforced,
  verifyAppCheck,
} from "./appCheck";

const app = express();
app.use("/api", verifyAppCheck);
app.get("/api/probe", (_req, res) => res.json({ ok: true }));

function probe(token?: string) {
  const req = request(app).get("/api/probe");
  return token ? req.set("X-Firebase-AppCheck", token) : req;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.APP_CHECK_ENFORCED;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("isAppCheckEnforced", () => {
  it("accepts true and false regardless of case or padding", () => {
    for (const on of ["true", "TRUE", " True ", "true\n"]) {
      process.env.APP_CHECK_ENFORCED = on;
      expect(isAppCheckEnforced(), on).toBe(true);
    }
    for (const off of ["false", "FALSE", " False "]) {
      process.env.APP_CHECK_ENFORCED = off;
      expect(isAppCheckEnforced(), off).toBe(false);
    }
  });

  it("treats unset and empty as off", () => {
    expect(isAppCheckEnforced()).toBe(false);
    process.env.APP_CHECK_ENFORCED = "   ";
    expect(isAppCheckEnforced()).toBe(false);
  });

  // The whole point of the change: none of these may read as "off".
  it.each(["ture", "1", "0", "yes", "no", "on", "off", '"true"', "true false"])(
    "refuses to interpret %j",
    (value) => {
      process.env.APP_CHECK_ENFORCED = value;
      expect(() => isAppCheckEnforced()).toThrow(AppCheckConfigError);
    }
  );
});

describe("assertAppCheckConfigured", () => {
  it("passes silently when enforcement is on", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_CHECK_ENFORCED = "true";

    expect(() => assertAppCheckConfigured()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses to start in production when enforcement is off", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_CHECK_ENFORCED = "false";

    expect(() => assertAppCheckConfigured()).toThrow(/Refusing to start an unattested API/);
  });

  it("refuses to start in production when the flag is missing entirely", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertAppCheckConfigured()).toThrow(AppCheckConfigError);
  });

  it("is fatal on an unreadable value even outside production", () => {
    process.env.APP_CHECK_ENFORCED = "ture";

    expect(() => assertAppCheckConfigured()).toThrow(AppCheckConfigError);
  });

  it("warns but starts when enforcement is off outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.APP_CHECK_ENFORCED = "false";

    expect(() => assertAppCheckConfigured()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("App Check enforcement is OFF"));
  });
});

describe("verifyAppCheck middleware", () => {
  it("lets requests through when enforcement is off", async () => {
    process.env.APP_CHECK_ENFORCED = "false";

    const res = await probe();

    expect(res.status).toBe(200);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it("401s without a token when enforcement is on", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const res = await probe();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("APP_CHECK_REQUIRED");
  });

  it("401s when the token doesn't verify", async () => {
    process.env.APP_CHECK_ENFORCED = "true";
    verifyToken.mockRejectedValue(new Error("bad token"));

    const res = await probe("garbage");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("APP_CHECK_INVALID");
  });

  it("passes a verified token through", async () => {
    process.env.APP_CHECK_ENFORCED = "true";
    verifyToken.mockResolvedValue({ appId: "app-1" });

    const res = await probe("good-token");

    expect(res.status).toBe(200);
    expect(verifyToken).toHaveBeenCalledWith("good-token");
  });

  // Startup rejects this value, so it can only be reached if that gate is ever
  // bypassed — at which point closed is the only safe direction to fail.
  it("fails closed rather than open on a value it can't read", async () => {
    process.env.APP_CHECK_ENFORCED = "ture";

    const res = await probe("good-token");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("APP_CHECK_MISCONFIGURED");
    expect(verifyToken).not.toHaveBeenCalled();
  });
});
