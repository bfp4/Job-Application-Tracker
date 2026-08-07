import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./lib/http/http";
import { assertAppCheckConfigured, verifyAppCheck } from "./middleware/appCheck/appCheck";
import { securityHeaders } from "./middleware/securityHeaders/securityHeaders";
import resumesRouter from "./routes/resumes";
import applicationsRouter from "./routes/applications/applications";
import followUpsRouter from "./routes/followUps";
import questionsRouter from "./routes/questions/questions";
import contactsRouter from "./routes/contacts/contacts";
import timelineEntriesRouter from "./routes/timelineEntries/timelineEntries";
import jobsRouter from "./routes/jobs/jobs";
import userRouter from "./routes/user/user";
import adminRouter from "./routes/admin/admin";
import unsubscribeRouter from "./routes/unsubscribe/unsubscribe";

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

// Before anything is wired up: refuse to serve an unattested API in production,
// and say so out loud everywhere else. Throwing here exits non-zero, so a bad
// deploy fails its health check instead of quietly serving without App Check.
assertAppCheckConfigured();

// Don't advertise the framework, and set defensive headers on everything —
// health, routes, 404s and error responses alike.
app.disable("x-powered-by");
app.use(securityHeaders);

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((o) => o.trim()),
  })
);
app.use(express.json());

// Throttle abusive traffic (bot mass-signup / brute force). Keyed per IP.
// Behind a proxy (Caddy), trust it so the client IP — not the proxy — is used.
app.set("trust proxy", 1);
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // per-IP requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// The digest opt-out, mounted OUTSIDE /api and therefore ahead of the App
// Check gate below. It is clicked from a mail client, which has no App Check
// token and no session — under /api every recipient would get a 401 instead of
// unsubscribing, i.e. a broken opt-out link. It carries its own, tighter rate
// limiter (see routes/unsubscribe.ts).
app.use("/unsubscribe", unsubscribeRouter);

// Rate limiting + App Check attestation guard the API surface (health stays
// open, so the container healthcheck and the deploy smoke test are never
// throttled).
//
// ORDER MATTERS, and not only for cost. verifyAppCheck used to run first,
// which meant an unattested request was rejected before it ever reached the
// limiter — and express-rate-limit only counts requests that reach it. So the
// one kind of traffic most worth shedding, a flood of junk tokens, consumed
// none of the attacker's budget and was effectively unlimited, while each
// request still bought a signature verification on a 2-vCPU box.
//
// Cheapest check first: the counter sheds junk, and only requests already
// inside the rate budget cost a verification.
app.use("/api", apiLimiter, verifyAppCheck);

app.use("/api/resumes", resumesRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/follow-ups", followUpsRouter);
app.use("/api/questions", questionsRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/timeline-entries", timelineEntriesRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/user", userRouter);
app.use("/api/admin", adminRouter);

// Central error middleware — asyncHandler routes rejected promises here.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
