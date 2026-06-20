import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { authenticate } from "./middleware/auth";

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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
