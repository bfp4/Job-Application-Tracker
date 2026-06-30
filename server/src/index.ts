import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { authenticate } from "./middleware/auth";
import jobsRouter from "./routes/jobs";
import applicationsRouter from "./routes/applications";
import followUpsRouter from "./routes/followUps";
import companiesRouter from "./routes/companies";
import contactsRouter from "./routes/contacts";
import filesRouter from "./routes/files";
import resumesRouter from "./routes/resumes";
import searchPreferencesRouter from "./routes/searchPreferences";
import digestRouter from "./routes/digest";
import userRouter from "./routes/user";

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((o) => o.trim()),
  })
);
app.use(express.json());

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Protected route: returns the authenticated user's DB record.
app.get("/api/me", authenticate, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// Job search & ingestion routes (auth enforced per-route).
app.use("/api/jobs", jobsRouter);

// Application tracking, follow-ups, companies and contacts (auth per-route).
app.use("/api/applications", applicationsRouter);
app.use("/api/follow-ups", followUpsRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/contacts", contactsRouter);

// Recommended-jobs digest: saved search preferences + a dev preview endpoint.
app.use("/api/search-preferences", searchPreferencesRouter);
app.use("/api/digest", digestRouter);

// File uploads/downloads via pre-signed S3 URLs. Mounted at /api because it
// serves both /api/files/* and /api/applications/:id/files (auth per-route).
app.use("/api", filesRouter);

// Base resume upload/parse and AI resume tailoring (auth per-route).
app.use("/api/resumes", resumesRouter);

// User keywords + preference toggles (Smart Search), auth per-route.
app.use("/api/user", userRouter);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
