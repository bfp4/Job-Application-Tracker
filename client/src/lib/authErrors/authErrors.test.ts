import { describe, expect, it } from "vitest";
import {
  friendlyAuthError,
  isBadCredentialError,
  validatePassword,
} from "./authErrors";

describe("validatePassword", () => {
  it("accepts a password meeting every rule", () => {
    expect(validatePassword("Password!1")).toBeNull();
  });

  it.each([
    ["too short", "Ab!1", "at least 8 characters"],
    ["no uppercase", "password!1", "one uppercase letter"],
    ["no special character", "Password12", "one special character"],
  ])("rejects a password with %s", (_label, password, expected) => {
    expect(validatePassword(password)).toBe(`Password needs: ${expected}.`);
  });

  it("reports the first unmet rule when several fail", () => {
    expect(validatePassword("abc")).toBe("Password needs: at least 8 characters.");
  });
});

describe("friendlyAuthError", () => {
  it("maps a known Firebase code to friendly copy", () => {
    expect(friendlyAuthError({ code: "auth/email-already-in-use" }, "fallback")).toBe(
      "An account with this email already exists."
    );
  });

  // Wrong-password, no-such-user and invalid-credential collapse to one
  // message on purpose — distinguishing them tells an attacker which emails
  // are registered.
  it("gives the same message for every bad-credential code", () => {
    const messages = [
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
    ].map((code) => friendlyAuthError({ code }, "fallback"));

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe("Incorrect email or password.");
  });

  it.each([
    ["an unknown code", { code: "auth/some-new-thing" }],
    ["a non-object", "boom"],
    ["null", null],
    ["an object with no code", {}],
  ])("falls back for %s", (_label, err) => {
    expect(friendlyAuthError(err, "fallback")).toBe("fallback");
  });
});

describe("isBadCredentialError", () => {
  it.each([["auth/invalid-credential"], ["auth/wrong-password"], ["auth/user-not-found"]])(
    "flags %s so the login page can offer a password reset",
    (code) => {
      expect(isBadCredentialError({ code })).toBe(true);
    }
  );

  it.each([
    ["a different auth failure", { code: "auth/too-many-requests" }],
    ["a non-object", "boom"],
    ["null", null],
  ])("does not flag %s", (_label, err) => {
    expect(isBadCredentialError(err)).toBe(false);
  });
});
