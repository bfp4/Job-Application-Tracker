import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../lib/http/http";

const router = Router();

/**
 * The digest opt-out, reachable from an email client with no session.
 *
 * Mounted at /unsubscribe rather than under /api on purpose: everything under
 * /api sits behind verifyAppCheck, and an App Check token can only come from
 * the real web app. A link clicked in Gmail has none, so an /api route here
 * would 401 every recipient who tried to opt out — a broken unsubscribe link,
 * which is the specific thing CAN-SPAM §7704(a)(3) prohibits.
 *
 * Authorization is possession of the token alone. That is why User
 * .unsubscribeToken is random rather than derived from the id or the email
 * (see schema.prisma): the worst a leaked token can do is stop that one
 * person's reminder emails, and it grants no read access to anything.
 */

/**
 * Deliberately tighter than the /api limiter (300/15min) and keyed per IP.
 * Nothing here is expensive, but the route is unauthenticated and takes a
 * bearer-ish secret in the query string, so this bounds how fast one host can
 * grind through the token space. 122 bits of randomness means that space is
 * not realistically searchable anyway — this is the belt to that suspenders.
 */
const unsubscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

/**
 * These are the only HTML responses the API serves, and the global
 * `default-src 'none'` policy from securityHeaders would blank the page's
 * styling. Relax it to exactly what the page uses — its own inline stylesheet —
 * and nothing else. Scripts stay forbidden: the page has none, and the form
 * below works without them.
 */
function htmlHeaders(res: Response): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // The token is in the URL. Keep it out of any onward Referer header and out
  // of shared caches.
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

const PAGE_STYLES = `
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f8fafc; color: #0f172a;
  }
  main {
    max-width: 30rem; width: 100%; background: #fff; border: 1px solid #e2e8f0;
    border-radius: 16px; padding: 32px; text-align: center;
  }
  h1 { margin: 0 0 12px; font-size: 20px; }
  p { margin: 0 0 20px; color: #475569; }
  button {
    font: inherit; font-weight: 600; cursor: pointer; border: 0;
    border-radius: 10px; padding: 12px 20px; background: #7c3aed; color: #fff;
  }
  a { color: #7c3aed; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f172a; color: #f1f5f9; }
    main { background: #1e293b; border-color: #334155; }
    p { color: #cbd5e1; }
  }
`;

/**
 * `title` and `bodyHtml` are always string literals from this file — never
 * caller-supplied. The one piece of caller input that does reach the page is
 * the token, interpolated into the confirm form's action URL below, and it is
 * kept inert by two things that must both stay true: `encodeURIComponent`, and
 * the surrounding attribute being double-quoted. `encodeURIComponent` does not
 * escape `'`, so switching that attribute to single quotes would reintroduce
 * an injection point.
 *
 * htmlHeaders' `default-src 'none'` is the backstop — with no `script-src` to
 * fall back to, an injected script would not execute — but treat it as the
 * second layer, not a licence to drop the first.
 */
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · JobTracker</title>
<style>${PAGE_STYLES}</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;
}

function invalidLinkPage(res: Response): void {
  htmlHeaders(res);
  res.status(404).send(
    page(
      "Link not valid",
      `<h1>This unsubscribe link isn't valid</h1>
       <p>It may have already been used, or the account may have been deleted.
       You can also turn reminder emails off from Settings inside the app.</p>`
    )
  );
}

/** Reads the `u` query parameter, rejecting arrays and empty values. */
function readToken(req: Request): string | null {
  const raw = req.query.u;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * GET /unsubscribe?u=<token>
 *
 * Shows a confirmation button and changes nothing. A GET must stay side-effect
 * free here because mail providers and corporate link scanners routinely
 * pre-fetch every URL in a message to check it for malware — if the opt-out
 * happened on GET, those scanners would silently unsubscribe people who never
 * clicked anything, and the user would just notice their reminders stopped.
 */
router.get(
  "/",
  unsubscribeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const token = readToken(req);
    if (!token) {
      invalidLinkPage(res);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { unsubscribeToken: token },
      select: { emailOptOut: true },
    });
    if (!user) {
      invalidLinkPage(res);
      return;
    }

    if (user.emailOptOut) {
      htmlHeaders(res);
      res.send(
        page(
          "Already unsubscribed",
          `<h1>You're already unsubscribed</h1>
           <p>You won't receive daily reminder emails from JobTracker. You can
           turn them back on any time in Settings.</p>`
        )
      );
      return;
    }

    htmlHeaders(res);
    res.send(
      page(
        "Unsubscribe",
        `<h1>Turn off reminder emails?</h1>
         <p>You'll stop receiving the daily digest of follow-ups due and
         applications you haven't submitted. Your account and saved
         applications are not affected.</p>
         <form method="post" action="/unsubscribe?u=${encodeURIComponent(token)}">
           <button type="submit">Unsubscribe</button>
         </form>`
      )
    );
  })
);

/**
 * POST /unsubscribe?u=<token>
 *
 * The actual opt-out. Hit both by the confirm button above and directly by
 * mail providers honoring List-Unsubscribe-Post (RFC 8058), which send a bare
 * POST with no confirmation step — so this must succeed without a body, a
 * session, or a CSRF token. There is nothing to protect against CSRF here:
 * the token in the URL *is* the credential, and an attacker who has it could
 * simply request the URL themselves.
 *
 * Idempotent — a second POST is a no-op that still reports success, so a
 * provider retry never produces an error.
 */
router.post(
  "/",
  unsubscribeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const token = readToken(req);
    if (!token) {
      invalidLinkPage(res);
      return;
    }

    const result = await prisma.user.updateMany({
      where: { unsubscribeToken: token },
      data: { emailOptOut: true },
    });

    if (result.count === 0) {
      invalidLinkPage(res);
      return;
    }

    htmlHeaders(res);
    res.send(
      page(
        "Unsubscribed",
        `<h1>You're unsubscribed</h1>
         <p>You won't receive daily reminder emails from JobTracker any more.
         Your account and saved applications are untouched, and you can turn
         reminders back on in Settings.</p>`
      )
    );
  })
);

export default router;
