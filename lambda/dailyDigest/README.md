# Daily Digest Lambda

A standalone AWS Lambda that runs once a day, builds a personalized job digest
for every user, and emails it via **AWS SES**. It reuses the digest logic and
job-source adapters from `/server/src` instead of duplicating them.

See the root `README.md` for what the digest contains and how the per-search
job allocation works. This file covers **building and packaging** the function
for deployment (Phase 6c).

## Why we bundle with esbuild + copy Prisma manually

Locally, `ts-node` happily follows this function's relative imports into
`../../server/src` and resolves their dependencies from `/server/node_modules`.
**AWS Lambda cannot do either of those things at runtime:**

- It has no `/server` folder and no monorepo layout — only whatever is inside
  the uploaded zip. Relative imports that climb out of the function directory
  won't resolve.
- It can't compile TypeScript or download/compile native binaries on the fly.

So the build does two things:

1. **esbuild bundles everything into one CommonJS file.** `index.ts` and all of
   its imports — including the `/server/src` code it pulls in — are inlined into
   a single `dist/index.js` targeted at `node18`. No relative-import resolution
   is needed at runtime because there are no remaining imports to resolve...
2. **...except Prisma, which is copied in manually.** `@prisma/client` loads a
   **native query-engine binary** at runtime that esbuild can't inline. It's
   marked `external` in the bundle, and the already-generated client (from
   `/server/node_modules/.prisma` and `/server/node_modules/@prisma`) is copied
   into `dist/node_modules/` so Node's normal resolution finds it inside the zip.

## Prisma binary target (important)

The native query engine is **platform-specific**. Your local engine
(`query_engine-windows.dll.node` on Windows, or a debian build on macOS/Linux)
will **not** run on Lambda. Lambda's Node runtime is **Amazon Linux 2 / AL2023**,
which needs the `rhel-openssl-3.0.x` engine.

The Prisma schema (`/server/prisma/schema.prisma`) is configured to generate
both:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```

After changing `binaryTargets` you must regenerate the client so the rhel engine
is actually downloaded and placed in `/server/node_modules/.prisma/client`:

```bash
cd server
npx prisma generate
```

> **Note:** `prisma generate` rewrites the local (`native`) engine too, so it
> will fail with `EPERM` on Windows if a process has the engine loaded (e.g. a
> running `npm run dev` server). Stop the dev server first, or run
> `prisma generate` from WSL/Linux/CI. `build.js` prints a **warning** if it
> copies a client that has no rhel engine, so you'll know before deploying.

## Building & packaging

```bash
cd lambda/dailyDigest
npm install

# one-time (or whenever the schema/engine changes): generate the client with
# the rhel target present, from /server
cd ../../server && npx prisma generate && cd ../lambda/dailyDigest

npm run package
```

- `npm run build` → runs `build.js`: bundles `index.ts` into `dist/index.js`
  and copies the Prisma client into `dist/node_modules/`.
- `npm run package` → runs the build, then `zip.js` zips `dist/` into
  `function.zip` at the root of the deployment package.

> **Why a Node zip script instead of `zip -r`?** The classic
> `cd dist && zip -r ../function.zip .` only works where the Unix `zip` CLI
> exists. This repo is developed on Windows (no `zip`), so `zip.js` uses the
> cross-platform `archiver` library to produce an identical, Lambda-compatible
> zip on any OS.

### What `function.zip` contains

The archive root mirrors `dist/` — `index.js` and `node_modules/` sit at the top
level (not nested under a `dist/` folder), which is what Lambda expects:

```
function.zip
├── index.js                       # bundled handler (entry: "index.handler")
└── node_modules/
    ├── .prisma/
    │   └── client/                # generated client + native query engine(s)
    │       ├── query_engine-windows.dll.node          (local/native)
    │       └── libquery_engine-rhel-openssl-3.0.x.so.node   (Lambda runtime)
    └── @prisma/
        └── client/                # @prisma/client runtime
```

When deployed, the Lambda handler is `index.handler`.

## Troubleshooting Prisma binary issues at runtime

Prisma + Lambda native-engine mismatches are a common pain point. If a deployed
invocation fails with something like *"Query engine library for current platform
… could not be found"* or *"PrismaClientInitializationError"*, it almost always
means the **rhel engine isn't in the zip**. Fix:

1. Confirm `binaryTargets` includes `"rhel-openssl-3.0.x"` in
   `/server/prisma/schema.prisma`.
2. Regenerate the client (dev server stopped, or in WSL/Linux/CI):
   ```bash
   cd server && npx prisma generate
   ```
3. Verify the engine exists:
   `server/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node`
4. Re-run `npm run package` and redeploy. `build.js` will no longer print the
   "no rhel-openssl engine" warning once it's present.

> If you ever upgrade Lambda to a newer Amazon Linux that ships OpenSSL 3.x with
> a different ABI, switch the target to the matching `rhel-openssl-*` value and
> regenerate.

## Not done yet (later phases)

- Actual deployment of `function.zip` to AWS Lambda.
- EventBridge daily schedule to trigger the function.
