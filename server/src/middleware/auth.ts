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

    let user = await prisma.user.findUnique({ where: { firebaseUid } });

    if (!user) {
      if (!email) {
        res
          .status(401)
          .json({ error: "Firebase account has no email address." });
        return;
      }

      user = await prisma.user.upsert({
        where: { email },
        update: { firebaseUid },
        create: { firebaseUid, email },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}
