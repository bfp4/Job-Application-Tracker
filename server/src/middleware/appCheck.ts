import type { Request, Response, NextFunction } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import app from "../lib/firebaseAdmin";

/**
 * Verifies a Firebase App Check token, attesting the request came from our real
 * app rather than a script hitting the API directly. Clients send the token in
 * the `X-Firebase-AppCheck` header.
 *
 * Enforcement is opt-in via APP_CHECK_ENFORCED=true so this can ship before the
 * Firebase console + web client are configured. Until then it's a no-op and
 * won't lock anyone out; flip the flag once App Check is live everywhere.
 */
export async function verifyAppCheck(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (process.env.APP_CHECK_ENFORCED !== "true") {
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
