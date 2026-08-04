import type { Request, Response, NextFunction } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import app from "../lib/firebaseAdmin";

/** Raised for an APP_CHECK_ENFORCED the server refuses to interpret. */
export class AppCheckConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppCheckConfigError";
  }
}

/**
 * Reads APP_CHECK_ENFORCED strictly: exactly "true" or "false", ignoring case
 * and surrounding whitespace. Anything else raises instead of reading as off.
 *
 * This used to be a bare `!== "true"`, which meant "ture", "1", "yes" or a
 * stray quote turned attestation off across the entire API — no error, no
 * warning, and nothing in a response to reveal it. The flag is either
 * understood or the server says so.
 */
export function isAppCheckEnforced(): boolean {
  const raw = process.env.APP_CHECK_ENFORCED;
  if (raw === undefined) return false;

  const value = raw.trim().toLowerCase();
  if (value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;

  throw new AppCheckConfigError(
    `APP_CHECK_ENFORCED is ${JSON.stringify(raw)}, which is neither "true" nor ` +
      `"false". Refusing to guess: reading it as "false" would silently drop ` +
      `App Check attestation from every /api route.`
  );
}

/**
 * Startup gate, called from index.ts before the server listens.
 *
 * In production an unenforced App Check is a deployment mistake, not a
 * configuration choice — the container sets APP_CHECK_ENFORCED=true
 * (deploy/docker-compose.yml), so anything else means something went wrong on
 * the way to the instance. Better to fail the deploy's health check than to
 * serve an unattested API that looks healthy.
 *
 * Everywhere else it warns: running locally without the flag is normal, but it
 * should be visible in the log rather than assumed.
 */
export function assertAppCheckConfigured(): void {
  // Deliberately not caught: a value we can't parse is fatal in every
  // environment, because it always means the flag isn't doing what it reads
  // like it's doing.
  const enforced = isAppCheckEnforced();
  if (enforced) return;

  if (process.env.NODE_ENV === "production") {
    throw new AppCheckConfigError(
      "APP_CHECK_ENFORCED is not \"true\" but NODE_ENV is \"production\". " +
        "Refusing to start an unattested API in production — set " +
        "APP_CHECK_ENFORCED=true, or unset NODE_ENV if this isn't production."
    );
  }

  console.warn(
    "WARNING: App Check enforcement is OFF (APP_CHECK_ENFORCED is not \"true\"). " +
      "Every /api route will accept requests with no attestation token. " +
      "This is expected for local development and must never be the case in production."
  );
}

/**
 * Verifies a Firebase App Check token, attesting the request came from our real
 * app rather than a script hitting the API directly. Clients send the token in
 * the `X-Firebase-AppCheck` header.
 *
 * Enforcement is opt-in via APP_CHECK_ENFORCED=true so this can run locally
 * without the Firebase console + web client configured; see
 * `assertAppCheckConfigured`, which is what stops that opt-in from reaching
 * production by accident.
 */
export async function verifyAppCheck(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let enforced: boolean;
  try {
    enforced = isAppCheckEnforced();
  } catch {
    // Unreachable once the server has started — assertAppCheckConfigured
    // rejects this value at boot. Kept because the one thing this middleware
    // must never do on a config it can't read is wave the request through.
    res.status(503).json({
      error: "Server misconfigured.",
      code: "APP_CHECK_MISCONFIGURED",
    });
    return;
  }

  if (!enforced) {
    next();
    return;
  }

  const token = req.header("X-Firebase-AppCheck");
  if (!token) {
    res.status(401).json({
      error: "Missing App Check token.",
      code: "APP_CHECK_REQUIRED",
    });
    return;
  }

  try {
    await getAppCheck(app).verifyToken(token);
    next();
  } catch {
    res.status(401).json({
      error: "Invalid App Check token.",
      code: "APP_CHECK_INVALID",
    });
  }
}
