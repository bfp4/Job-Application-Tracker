---
name: verify
description: How to run and drive this app end-to-end for verification — launch commands, disposable Firebase test users, DB seeding, Playwright GUI drive, and cleanup.
---

# Verifying changes end-to-end

## Launch

- API: `cd server && npm run dev` → http://localhost:5000 (`/health` for readiness). Needs `server/.env`; `DATABASE_URL` points at localhost:15433 (tunnel to RDS — make sure the tunnel is up; a successful `prisma migrate` or query proves it).
- Client: `cd client && npm run dev` → http://localhost:3000 (takes ~30s to compile a page on first hit).

## Auth handle (no shared credentials needed)

Every API route requires a Firebase ID token. Mint a disposable user with the client web API key from `client/.env.local` (`NEXT_PUBLIC_FIREBASE_API_KEY`):

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<API_KEY>
{"email":"verify-<rand>@example.com","password":"<rand>","returnSecureToken":true}
```

→ `idToken` goes in `Authorization: Bearer <idToken>`. The first authed request auto-creates the `User` row (see `server/src/middleware/auth.ts`). **Save the password** — you need it for the GUI login and for token refresh.

## Seeding data

Most flows hang off an Application, which needs a JobPosting. Seed directly with Prisma: drop a `*.tmp.ts` script in `server/` (so `node_modules` resolves), start it with `import "dotenv/config"` **before** importing `./src/lib/prisma` or `./src/lib/firebaseAdmin`, run with `npx tsx <file>`, delete it after. (`npx tsx -e "..."` silently prints nothing on Windows — always use a file.)

## GUI drive

Playwright works: chromium browsers are installed in `%LOCALAPPDATA%\ms-playwright`; `npm i playwright` in the scratchpad gives the library. Log in through `/login` (labels are `htmlFor`-associated: `getByLabel("Email")`, button "Sign in"), then navigate.

Gotchas on the application detail page:
- Several sections each have an "Add" button — scope by form: `page.locator("form").filter({ hasText: "Name *" })`.
- Section form labels are NOT `htmlFor`-associated — select inputs by placeholder.
- `locator("li", { hasText: ... })` stops matching once a card switches to edit mode (values live in inputs, not text).
- Make scripts idempotent: pre-delete leftovers from aborted runs via the API before adding.

## Cleanup (always)

1. DB: tmp Prisma script deleting the test user's child rows, then the user (children first — no cascade from User).
2. Firebase: `accounts:delete` with the idToken fails with `CREDENTIAL_TOO_OLD_LOGIN_AGAIN` if the token is >5 min old — either re-login first, or delete via admin SDK: tmp script in `server/` using `adminAuth.deleteUser(uid)` (with `dotenv/config`).
3. Remove the `*.tmp.ts` scripts and stop both dev servers.
