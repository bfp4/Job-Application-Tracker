import type { NextFunction, Request, RequestHandler, Response } from "express";

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
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
