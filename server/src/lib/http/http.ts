import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import { ContentRefusedError } from "../anthropic/anthropic";

/**
 * Wraps an async route handler so a rejected promise reaches the Express
 * error middleware instead of becoming an unhandled rejection (which, under
 * Node's default --unhandled-rejections=throw, would kill the process —
 * Express 4 does not forward async errors on its own).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** How much of an unrecognized error's message reaches the log. */
const MAX_LOGGED_MESSAGE_CHARS = 500;

/**
 * The loggable shape of an error — deliberately not the error itself.
 *
 * Container logs are plaintext on the instance's disk, readable by anyone with
 * an SSM session and kept until the disk fills. That is a much weaker container
 * than the database these values came from, and a copy that outlives it: a
 * deleted account's notes are gone from Postgres and S3 but still sit in
 * whatever was logged months ago. So nothing user-supplied is written here.
 *
 * Note that logging `err.message` instead of `err` is NOT sufficient, which is
 * the trap this function exists to avoid — see the validation-error branch.
 */
function safeDetail(err: unknown): Record<string, unknown> {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // `meta` carries the offending column names (P2002's `target`), never the
    // values in them — so it's the one Prisma payload that is safe verbatim.
    return { name: err.name, code: err.code, target: err.meta?.target };
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    // The message embeds a rendered dump of the query arguments — meaning the
    // user's notes, contact details, or resume text, inline. This always means
    // a query we built wrong, so `name` plus the route is enough to find it;
    // the argument values add nothing a developer needs and are exactly the
    // thing that must not land on disk. Full text still reaches a dev console
    // via the NODE_ENV branch in errorHandler.
    return { name: err.name, note: "validation error; message suppressed" };
  }

  if (err instanceof Error) {
    // Our own thrown errors carry static messages. Third-party ones may not —
    // the Anthropic SDK can echo part of a request body on a 400, and that body
    // is the prompt. Truncation bounds that rather than preventing it; this is
    // a backstop, not a guarantee.
    return { name: err.name, message: err.message.slice(0, MAX_LOGGED_MESSAGE_CHARS) };
  }

  return { value: String(err).slice(0, MAX_LOGGED_MESSAGE_CHARS) };
}

/**
 * Central error middleware: logs the failure and returns a generic 500.
 * Handlers signal expected failures with explicit status responses; anything
 * that reaches here is a bug or an infrastructure error.
 *
 * The 500 body carries an `errorId` that matches the log line's prefix, so a
 * user reporting "I got error a3f9c1" is enough to find the exact failure —
 * which is what makes it affordable to keep their data out of the log entirely.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errorId = randomUUID().slice(0, 8);

  // req.path, not req.originalUrl: the query string is caller-supplied text —
  // GET /api/admin/users?search=<someone's email> would otherwise be logged
  // verbatim. The path still carries record ids, which are not secrets.
  console.error(
    `[${errorId}] ${req.method} ${req.path} failed:`,
    process.env.NODE_ENV === "production" ? safeDetail(err) : err
  );

  if (res.headersSent) {
    next(err);
    return;
  }

  // A safety refusal is an expected outcome of a well-formed request, not a
  // bug — 422 with the reason, so the user knows to edit the posting rather
  // than retry an identical request that will be declined again.
  if (err instanceof ContentRefusedError) {
    res.status(422).json({ error: err.message, code: "CONTENT_REFUSED" });
    return;
  }

  res.status(500).json({
    error: "Something went wrong. Please try again.",
    errorId,
  });
}
