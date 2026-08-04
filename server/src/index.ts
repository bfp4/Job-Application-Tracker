import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./lib/http";
import { assertAppCheckConfigured, verifyAppCheck } from "./middleware/appCheck";
import { securityHeaders } from "./middleware/securityHeaders";
import resumesRouter from "./routes/resumes";
import applicationsRouter from "./routes/applications";
import followUpsRouter from "./routes/followUps";
import questionsRouter from "./routes/questions";
import contactsRouter from "./routes/contacts";
import timelineEntriesRouter from "./routes/timelineEntries";
import jobsRouter from "./routes/jobs";
import userRouter from "./routes/user";
import adminRouter from "./routes/admin";

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

// App Check attestation + rate limiting guard the API surface (health stays open).
app.use("/api", verifyAppCheck, apiLimiter);

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
