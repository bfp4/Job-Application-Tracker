import { build } from "esbuild";

await build({
  entryPoints: ["src/handler.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/index.js",
  // pg-native is an optional require inside pg (never installed here);
  // the AWS SDK v3 ships in the nodejs22.x Lambda runtime.
  external: ["pg-native", "@aws-sdk/*"],
  minify: false,
  sourcemap: false,
  logLevel: "info",
});
