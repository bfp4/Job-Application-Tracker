import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ContentRefusedError } from "./anthropic";

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

/**
 * Central error middleware: logs the failure and returns a generic 500.
 * Handlers signal expected failures with explicit status responses; anything
 * that reaches here is a bug or an infrastructure error.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
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

  res.status(500).json({ error: "Something went wrong. Please try again." });
}
