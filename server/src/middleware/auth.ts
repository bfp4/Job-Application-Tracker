import type { Request, Response, NextFunction } from "express";
import type { User } from "@prisma/client";
import { adminAuth } from "../lib/firebaseAdmin";
import { prisma } from "../lib/prisma";

// Augment Express's Request type so downstream handlers can read req.user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Express middleware that authenticates requests using a Firebase ID token.
 *
 * - Reads the `Authorization: Bearer <token>` header
 * - Verifies the token with firebase-admin
 * - Finds or creates the matching User row (keyed on firebaseUid)
 * - Attaches the User to req.user
 * - Responds 401 if the token is missing or invalid
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header." });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const firebaseUid = decoded.uid;
    const email = decoded.email ?? null;

    // Require a confirmed email before granting access. Google (and other
    // trusted providers) set email_verified: true, so those sign-ins pass;
    // password sign-ups must click the verification link first.
    if (decoded.email_verified !== true) {
      res.status(403).json({
        error: "Please confirm your email address before continuing.",
        code: "EMAIL_NOT_VERIFIED",
      });
      return;
    }

    let user = await prisma.user.findUnique({ where: { firebaseUid } });

    if (!user) {
      if (!email) {
        res
          .status(401)
          .json({ error: "Firebase account has no email address." });
        return;
      }

      // Fail closed rather than silently rebinding an existing account to a
      // new Firebase UID: if a row already owns this email under a different
      // UID, refuse instead of overwriting it.
      const existingByEmail = await prisma.user.findUnique({ where: { email } });
      if (existingByEmail && existingByEmail.firebaseUid !== firebaseUid) {
        res.status(409).json({
          error: "This email is already associated with another account.",
          code: "EMAIL_ALREADY_LINKED",
        });
        return;
      }

      user =
        existingByEmail ??
        (await prisma.user.create({ data: { firebaseUid, email } }));
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}
