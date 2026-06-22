// Load environment variables from this folder's .env BEFORE importing anything
// that reads them (e.g. the Prisma client constructed in the shared server lib).
// ES module imports are evaluated top-to-bottom, so this side-effect import must
// stay first.
import "dotenv/config";

import { handler } from "./index";

async function main(): Promise<void> {
  console.log("Invoking daily digest handler locally...\n");
  const summary = await handler();
  console.log("\nDone. Summary:", summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Local digest run failed:", err);
    process.exit(1);
  });
