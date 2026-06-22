/**
 * Build script for the daily digest Lambda.
 *
 * AWS Lambda can't resolve this function's monorepo-relative imports into
 * /server/src (and its /server/node_modules) the way local ts-node can. So we
 * bundle everything into a single CommonJS file with esbuild.
 *
 * The one thing we can NOT bundle is @prisma/client: it loads a native query
 * engine binary at runtime that esbuild can't inline. We mark it external and
 * instead copy the already-generated Prisma client (including its native engine)
 * into dist/node_modules so Node's normal resolution finds it at runtime.
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const lambdaDir = __dirname;
const distDir = path.join(lambdaDir, "dist");
const serverNodeModules = path.join(
  lambdaDir,
  "..",
  "..",
  "server",
  "node_modules"
);

// Prisma packages that must ship alongside the bundle (kept external below).
const PRISMA_PACKAGES = [".prisma", "@prisma"];

async function bundle() {
  await esbuild.build({
    entryPoints: [path.join(lambdaDir, "index.ts")],
    outfile: path.join(distDir, "index.js"),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    // Prisma's native engine binary can't be bundled; resolve it from the
    // copied node_modules at runtime instead (see copyPrismaClient).
    external: ["@prisma/client", ".prisma/client"],
    logLevel: "info",
  });
}

/**
 * Copies the generated Prisma client + native engine from the server's
 * node_modules into dist/node_modules so the (external) @prisma/client import
 * resolves inside the deployment package.
 */
function copyPrismaClient() {
  const destNodeModules = path.join(distDir, "node_modules");

  for (const pkg of PRISMA_PACKAGES) {
    const src = path.join(serverNodeModules, pkg);
    if (!fs.existsSync(src)) {
      throw new Error(
        `Expected Prisma package not found: ${src}\n` +
          `Run \`npm install && npx prisma generate\` in /server first.`
      );
    }
    const dest = path.join(destNodeModules, pkg);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`Copied ${pkg} -> dist/node_modules/${pkg}`);
  }

  warnIfMissingLambdaEngine(destNodeModules);
}

/**
 * The Lambda runtime (Amazon Linux 2 / AL2023) needs the rhel-openssl native
 * engine. If only a local (e.g. windows/debian) engine got copied, warn loudly:
 * deployment will fail at runtime until the client is regenerated with the
 * rhel-openssl-3.0.x binaryTarget. See README.
 */
function warnIfMissingLambdaEngine(destNodeModules) {
  const engineDir = path.join(destNodeModules, ".prisma", "client");
  if (!fs.existsSync(engineDir)) return;

  const engines = fs
    .readdirSync(engineDir)
    .filter((f) => f.includes("query") && f.includes("engine"));
  const hasRhel = engines.some((f) => f.includes("rhel"));

  if (!hasRhel) {
    console.warn(
      "\n[warning] No rhel-openssl Prisma engine found in the copied client.\n" +
        "          Engines present: " +
        (engines.join(", ") || "(none)") +
        "\n          Lambda runs on Amazon Linux and needs an rhel engine.\n" +
        "          Add binaryTargets = [\"native\", \"rhel-openssl-3.0.x\"] to the\n" +
        "          Prisma schema and re-run `npx prisma generate` in /server.\n"
    );
  }
}

async function main() {
  fs.rmSync(distDir, { recursive: true, force: true });
  await bundle();
  copyPrismaClient();
  console.log("\nBuild complete: dist/index.js (+ dist/node_modules for Prisma)");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
