import type { Request, Response, NextFunction } from "express";

/**
 * Sets defensive response headers on every API response. Hand-rolled rather
 * than pulling in helmet: an API that only ever returns JSON and attachment
 * downloads needs a much smaller set than helmet's defaults.
 *
 * Nothing here is known to be exploitable today — it's the seatbelt that keeps
 * a future mistake from turning into a live hole.
 *
 * - CSP: API responses never legitimately load a script, style, or frame, so
 *   `default-src 'none'` is the honest policy. `frame-ancestors 'none'` stops
 *   any page from embedding an API response to trick a signed-in user into
 *   clicking through it.
 * - nosniff: keeps a browser from re-interpreting a JSON body as HTML.
 * - no-referrer: API URLs carry record ids in the path; don't leak them.
 * - CORP: blocks other origins from pulling responses in as a subresource.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
}
