import "dotenv/config";
import { ingestJobs } from "../services/jobIngestion";
import { prisma } from "../lib/prisma";
import type { JobSearchParams } from "../jobSources/types";

/**
 * Thin CLI wrapper around ingestJobs() for manual/local testing.
 *
 * Usage:
 *   npm run fetch-jobs -- "<query>" "<location>" [day|week|month]
 *
 * Examples:
 *   npm run fetch-jobs -- "software engineer" "New York"
 *   npm run fetch-jobs -- "data analyst" "Remote" week
 */
async function main() {
  const [query, location, postedWithin] = process.argv.slice(2);

  if (!query || !location) {
    console.error(
      'Usage: npm run fetch-jobs -- "<query>" "<location>" [day|week|month]'
    );
    process.exit(1);
  }

  if (postedWithin && !["day", "week", "month"].includes(postedWithin)) {
    console.error(
      `Invalid postedWithin "${postedWithin}". Must be one of: day, week, month.`
    );
    process.exit(1);
  }

  const params: JobSearchParams = {
    query,
    location,
    ...(postedWithin
      ? { postedWithin: postedWithin as JobSearchParams["postedWithin"] }
      : {}),
  };

  console.log("Fetching jobs with params:", params);

  const { summary } = await ingestJobs(params);

  console.log("\nIngestion summary:");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error("fetch-jobs failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
