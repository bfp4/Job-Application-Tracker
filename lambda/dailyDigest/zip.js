/**
 * Zips dist/ into function.zip for Lambda deployment.
 *
 * Why a Node script instead of the Unix `zip` CLI: `zip` isn't available on
 * Windows (where this repo is developed), so shelling out to it isn't portable.
 * archiver produces a forward-slash, Lambda-compatible zip on every platform.
 *
 * The archive root must contain index.js and node_modules/ directly (NOT nested
 * under a dist/ folder), because the Lambda handler is configured as
 * "index.handler" and Node resolves @prisma/client from ./node_modules.
 */
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const lambdaDir = __dirname;
const distDir = path.join(lambdaDir, "dist");
const zipPath = path.join(lambdaDir, "function.zip");

if (!fs.existsSync(path.join(distDir, "index.js"))) {
  console.error(
    "dist/index.js not found. Run `npm run build` first (or use `npm run package`)."
  );
  process.exit(1);
}

fs.rmSync(zipPath, { force: true });

const output = fs.createWriteStream(zipPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`Created function.zip (${mb} MB) from dist/`);
});

archive.on("warning", (err) => {
  if (err.code === "ENOENT") {
    console.warn(err.message);
  } else {
    throw err;
  }
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
// Contents of dist/ at the zip root (index.js + node_modules/ alongside it).
archive.directory(distDir, false);
archive.finalize();
