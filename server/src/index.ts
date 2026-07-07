import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { errorHandler } from "./lib/http";
import resumesRouter from "./routes/resumes";
import applicationsRouter from "./routes/applications";
import followUpsRouter from "./routes/followUps";
import jobsRouter from "./routes/jobs";

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: CORS_ORIGIN.split(",").map((o) => o.trim()),
  })
);
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api/resumes", resumesRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/follow-ups", followUpsRouter);
app.use("/api/jobs", jobsRouter);

// Central error middleware — asyncHandler routes rejected promises here.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
