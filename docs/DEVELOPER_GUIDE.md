# Developer Guide

Everything you need to be productive in this repo. The [README](../README.md) sells the
product; this explains how it is built and what will bite you.

Read sections 1–4 before your first change. Sections 5–8 are reference. Section 9 has
step-by-step recipes for the common kinds of change, and section 10 is the list of
invariants that are load-bearing — most of them are not obvious from the code alone.

---

## 1. What the app is

A job-application tracker with a Claude-powered career coach attached. A user uploads one
resume, tracks job postings through a pipeline, and can run five AI features against any
single application:

| Feature | Endpoint | Model | Output |
| --- | --- | --- | --- |
| Resume tips | `POST /api/applications/:id/resume-tips` | Sonnet | Structured fit analysis |
| Tailored resume | `POST /api/applications/:id/tailored-resume` | Sonnet | Rewritten resume + PDF |
| Cover letter | `POST /api/applications/:id/cover-letter` | Sonnet | Letter + PDF |
| Application answer | `POST /api/questions/:id/answer` | Haiku | One form answer |
| LinkedIn connect note | `POST /api/contacts/:id/connect-message` | Haiku | ≤300-char note |

Everything else — the pipeline, follow-ups, contacts, timeline, the daily digest email —
exists to feed those five with real context.

Two cross-cutting concepts you will meet everywhere:

- **Career Specialization.** A per-user enum (`GENERAL`, `SOFTWARE_ENGINEERING`,
  `HEALTHCARE`, …) that swaps in field-specific guidance for every AI prompt. A nurse gets
  "certifications to pursue" where an engineer gets "technologies to study".
- **Tier + quota.** `BASIC` users get 10 AI calls per UTC day; `PREMIUM` and `ADMIN` are
  unlimited. `ADMIN` is only settable by direct DB edit, never through the API.

---

## 2. Repo layout

Four independent npm packages. There is no workspace root — each has its own
`package.json`, lockfile, and `node_modules`, and you `cd` into it to run anything.

```
server/      Express + TypeScript API, Prisma, all AI code       ← most work happens here
client/      Next.js 15 App Router frontend (deployed on Vercel)
lambda/      Scheduled reminder-digest Lambda (raw SQL, no Prisma)
infra/       Numbered, idempotent AWS CLI provisioning scripts
deploy/      Files copied onto the EC2 box (compose, Caddyfile, deploy script)
.github/     CI + deploy workflow
.claude/     Skills: `deploy`, `verify`
docs/        This guide
```

### `server/src` map

```
index.ts               App wiring: security headers → CORS → json → App Check → rate limit → routers → errorHandler
routes/                One router per resource. HTTP concerns only: parse, authorize, respond.
services/              Everything that calls Claude, plus the job-board scrapers.
  scrapers/            Pluggable board integrations (Ashby, Greenhouse).
lib/                   Shared primitives — see below.
middleware/            auth (Firebase), appCheck (attestation), quota (AI budget).
test-helpers/          Shared fixtures.
prisma/                schema.prisma + hand-checked migrations.
```

The `lib/` modules worth knowing on day one:

| Module | Why it exists |
| --- | --- |
| `anthropic.ts` | The **only** place that talks to the Anthropic SDK. Models, reasoning levels, structured outputs, refusal handling, billed-failure tagging. |
| `prompt.ts` | Shared prompt building: `formatPostingForPrompt`, `truncate`, and `jobPostingFingerprint` (the staleness hash). |
| `http.ts` | `asyncHandler` + the central `errorHandler`. |
| `inFlight.ts` | Process-local guard so a double-click can't double-bill a model call. |
| `validation.ts` | `isValidHttpUrl`, `isNonEmptyString`, `parseNullableDate`, … |
| `dates.ts` | `startOfUtcDay` — calendar dates are stored at UTC midnight, always. |
| `careerSpecializations.ts` | The specialization enum's labels and fallback; every `*Specializations.ts` module keys off it. |
| `s3.ts`, `pdfToMarkdown.ts`, `resumeRender.ts`, `coverLetterRender.ts`, `pdfLayout.ts` | Resume I/O: upload, PDF→Markdown at upload time, and JSON→PDF rendering on download. |

`routes/` never calls the Anthropic SDK directly, and `services/` never touches
`req`/`res`. That split is what makes the services unit-testable without HTTP.

---

## 3. Local setup

**Prerequisites:** Node 22+, a PostgreSQL database, a Firebase project (Auth enabled), an
S3 bucket, an Anthropic API key. Google Maps and App Check keys are optional locally.

```bash
# API
cd server
cp .env.example .env          # fill in DATABASE_URL, Firebase Admin, AWS, ANTHROPIC_API_KEY
npm install
npx prisma migrate deploy
npm run dev                   # http://localhost:5000  — /health returns {"status":"ok"}

# Client, separate terminal
cd client
cp .env.example .env.local    # Firebase Web SDK config (+ optional Maps key)
npm install
npm run dev                   # http://localhost:3000
```

Notes that save time:

- **Leave `APP_CHECK_ENFORCED` unset locally.** With it on and no reCAPTCHA key on the
  client, every `/api/*` request 401s before it reaches a route — including ones that
  don't exist, which makes route probes useless as a "did my code deploy" signal.
- **Blank `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` disables App Check on the client**
  cleanly; `getAppCheckToken()` returns `null` and `apiFetch` omits the header.
- **Develop against a local database.** `.env.example` points there by default, and
  production RDS is private anyway — your laptop cannot reach it. Reaching prod takes two
  deliberate acts: run `./infra/tunnel.sh` (SSM port forwarding; the instance has **no
  inbound SSH**) and swap `DATABASE_URL` to `localhost:15433`. 15433 rather than 5433
  because Hyper-V reserves port ranges on Windows. `prisma migrate dev` has wiped this
  database before — see the README before pointing anything that writes at prod.
- **Stale dev servers cause phantom failures.** A pile of leftover `npm run dev` processes
  silently drops whole test files from a vitest run and makes `prisma generate` fail with
  `EPERM` on Windows. If a local green looks too easy, count your node processes first.

To drive the app end-to-end with a real login (disposable Firebase users, seeding,
Playwright), use the **`verify` skill** rather than re-deriving it.

---

## 4. How a request flows

```
Browser
  └─ apiFetch()                      attaches Firebase ID token + App Check token
      └─ HTTPS → Caddy (prod only)   terminates TLS for the DuckDNS host
          └─ Express
              ├─ securityHeaders     CSP/nosniff/frame-deny on every response
              ├─ cors                CORS_ORIGIN allowlist
              ├─ express.json        100kb default body cap
              ├─ verifyAppCheck      /api/* only; no-op unless APP_CHECK_ENFORCED=true
              ├─ rateLimit           300 req / 15 min / IP, trust proxy = 1
              ├─ authenticate        verify ID token → find-or-create User → req.user
              └─ route handler       ownership check → work → JSON
                  └─ errorHandler    ContentRefusedError → 422; anything else → 500
```

**`authenticate`** (`middleware/auth.ts`) does four things worth remembering:

1. Rejects unverified emails with `403 EMAIL_NOT_VERIFIED`. Google sign-ins pass
   automatically (`email_verified: true`); password sign-ups must click the link.
2. Lazily creates the `User` row on the first authenticated request. There is no signup
   endpoint — the row appears when the token first arrives.
3. Fails closed on an email that already belongs to a different `firebaseUid`
   (`409 EMAIL_ALREADY_LINKED`) rather than silently rebinding the account.
4. Attaches the full Prisma `User` to `req.user`, so handlers read `tier` and
   `careerSpecialization` without another query.

`requireAdmin` runs after it and gates `/api/admin/*` on `tier === "ADMIN"`.

### Ownership is enforced per query, not per layer

There is no row-level security and no ORM-level scoping. **Every** handler filters by the
authenticated user itself:

```ts
const application = await prisma.application.findFirst({
  where: { id: req.params.id, userId: req.user!.id },   // ← both, always
});
if (!application) { res.status(404).json({ error: "Application not found." }); return; }
```

Use `findFirst` with both keys and 404 on miss — never `findUnique({ where: { id } })`
followed by a separate ownership `if`, and never a 403 (which confirms the row exists to
someone who shouldn't know). Child resources (`follow-ups`, `questions`, `contacts`,
`timeline-entries`) reach the user through their parent application; look at
`routes/followUps.ts` for the shape.

---

## 5. Data model

Full schema with commentary: [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).
The comments there are the specification — read them before changing a model.

```
User ──┬── BaseResume ────┐        (append-only; a new upload = a new row)
       ├── JobPosting ──┐ │
       ├── Application ─┴─┼── ResumeAnalysis   (1:1, staleness-gated)
       │      │           ├── TailoredResume   (1:1, staleness-gated, `edited` flag)
       │      │           └── CoverLetter      (1:1, staleness-gated, `edited` flag)
       │      ├── FollowUp        (reminderSentAt — digest dedupe)
       │      ├── TimelineEntry   (one row per stage occupied)
       │      ├── ApplicationQuestion
       │      └── Contact         (connectMessage + connectMessageHash)
       └── PremiumRequest

Company ── JobPosting            (shared across users, keyed by name)
```

Design points you need to know:

- **Postings are per-user.** `@@unique([userId, jobUrl])`. Two users pasting the same URL
  get two independent rows, so nobody can rewrite what another user sees. `Company` is the
  one genuinely shared table.
- **`BaseResume` is append-only.** Nothing is updated in place; `getLatestBaseResume()`
  takes the newest. This is why the staleness hashes can identify a resume by *id* instead
  of hashing its contents.
- **Calendar dates are stored at UTC midnight** (`appliedDate`, `followUpDate`,
  `occurredAt`). Both write paths for `occurredAt` send the *client's* calendar day
  explicitly, because at 8pm in New York the server's UTC day is already tomorrow. The
  column's `now()` default is a floor for raw API clients, not something app code should
  fall through to.
- **AI output is stored as opaque `Json`.** The DB does not validate its shape, so the
  server type, the JSON schema, and the client type must be kept in sync by hand — see
  §10.
- **Timeline entries are auto-created** by `PATCH /api/applications/:id` when `status`
  actually changes (re-saving the same status logs nothing), and are hand-editable
  afterward for backfill.

### Migrations

Migrations live in `server/prisma/migrations/` and are applied in production by
`prisma migrate deploy`, which runs **on the EC2 instance** during deploy — the only place
that can reach the private RDS. You never run it yourself.

> ⚠️ **The `prisma migrate dev` phantom-drift trap.** `PremiumRequest` has a *partial*
> unique index (`WHERE status = 'PENDING'`) that Prisma's schema DSL cannot express. It
> exists only in migration `20260802000000_premium_request_pending_unique`. Because
> `schema.prisma` doesn't mention it, `migrate dev` reads it as drift and will silently add
> a `DROP INDEX "PremiumRequest_userId_pending_unique"` to **the next migration it
> generates, whatever that migration was actually for**. Delete that line before applying.
> `src/lib/migrations.test.ts` replays all migrations and fails CI if the index ends up
> dropped — if that test goes red, this is why.

Also: the production DB was baselined on 2026-07-03 (`prisma migrate baseline`) and no
pre-reset data survives. Check the migration history before running `migrate dev` against
it.

---

## 6. Server conventions

**Route file shape.** Every handler is `asyncHandler(async (req, res) => …)` — Express 4
does not forward async rejections, and an unhandled one kills the process under Node's
default settings. The wrapper routes them to `errorHandler`.

**Status codes carry meaning here; match the existing usage:**

| Code | Used for |
| --- | --- |
| 400 | Malformed input, or a precondition the user can fix (no resume uploaded yet) |
| 401 | Missing/invalid token, or App Check rejection (`code: APP_CHECK_*`) |
| 403 | Unverified email, or non-admin on `/api/admin/*` |
| 404 | Not found **or** not yours — never distinguish the two |
| 409 | Nothing changed since the last AI run, a generation is already in flight, or a duplicate (`jobUrl`, pending premium request) |
| 422 | Well-formed but unprocessable — Claude refused (`CONTENT_REFUSED`), or a board couldn't find the posting |
| 429 | Rate limit, or `AI_QUOTA_EXCEEDED` |
| 502 | An upstream board failed |

Error bodies are `{ error: string }`, plus a stable `code` when the client branches on it
(`EMAIL_NOT_VERIFIED`, `AI_QUOTA_EXCEEDED`, `CONTENT_REFUSED`, `APP_CHECK_REQUIRED`). Add a
`code` whenever the client needs to tell two failures apart — matching on message text is
not a contract.

**Validation** is explicit and hand-rolled (no zod). Reuse `lib/validation.ts`; for
multi-field payloads follow the parser pattern in `lib/jobPostingInput.ts` — a single
`parse*Fields()` returning `{ ok: true, data } | { ok: false, error }`, accepting any
subset so POST and PATCH share it.

`isValidHttpUrl` is a **security** check, not a formatting one: posting URLs render as
links in the UI, so a `javascript:` URL is a stored-XSS vector. `routes/jobs.test.ts`
asserts it. Never widen it.

**Uploads** are capped at 10 MB in memory, mimetype-filtered by multer, and then checked
against the real `%PDF-` magic bytes — the client-supplied mimetype is not trusted.

PDF text extraction runs on a **worker thread** (`lib/pdfToMarkdown.ts`), never on the
event loop: it is CPU-bound, and a deliberately malformed PDF can spin long enough to
stall every other request in the process. Each parse gets 20 seconds before the worker is
killed, and no more than `MAX_CONCURRENT_PDF_PARSES` run at once — one V8 isolate plus a
10 MB buffer per upload adds up fast on a 1 GB box. Keep both bounds if you touch it.

---

## 7. The AI subsystem

This is the part of the codebase with the most non-obvious rules, because every mistake
here costs real money. All five features follow one pipeline:

```
route: load context (application + posting + latest resume)
  → ownership check .................................. 404
  → precondition (resume uploaded?) .................. 400
  → staleness check: saved hash still current? ....... 409
  → in-flight guard: tryAcquire(applicationId) ....... 409
  → reserveAiCall(userId, tier) ...................... 429
  → read resume markdown from S3
  → service → generateStructured() → Claude
  → billed = true          ← nothing past this line is free to retry
  → persist (upsert)
  → 201
catch: if (reserved && !billed) releaseAiCallOnFailure(...)
finally: guard.release(applicationId)
```

Copy that sequence exactly when adding a feature. The ordering is deliberate: the checks
that can still reject the request run *before* the reservation, so a Basic user's cap is
never spent on a request that never reaches the model.

### `lib/anthropic.ts` — the single door to the model

`generateStructured({ system, prompt, schema, model, reasoning, maxTokens })` is the only
way to call Claude. It streams and reassembles with `finalMessage()` (a non-streaming call
at these token budgets risks an HTTP timeout while an Express request is held open) and
returns one parsed object.

**Model choice.** `SONNET` (`claude-sonnet-5`) writes long-form documents; `HAIKU`
(`claude-haiku-4-5`) handles short, tightly specified drafts at roughly a third of the
price. Default is Sonnet.

**Reasoning.** `"off" | "low" | "medium" | "high"`, defaulting to `medium` — deliberately
below the API's own default of `high`, since reasoning tokens bill at the output rate and
nothing here is a hard reasoning problem. The two model families express this differently:
Sonnet takes adaptive thinking plus `output_config.effort`; Haiku 4.5 predates `effort`
(it 400s on the parameter) and takes a fixed thinking budget instead. **The ladders are not
equivalent across families** — pick a level for a new call site by looking at its output,
not by copying a name from another feature.

**`maxTokens` is shared with thinking.** Leave generous headroom or the JSON gets truncated
mid-object; resume tips uses 16000 for a much smaller payload.

**Two failure modes arrive as a successful HTTP 200** and are handled here:

- `stop_reason: "refusal"` → `ContentRefusedError` → `errorHandler` maps it to 422 with an
  actionable message. Not a bug; a user can fix it by trimming the posting.
- `stop_reason: "max_tokens"` → an explicit error, so you see the real cause instead of a
  cryptic `JSON.parse` failure.

Both are tagged as **billed failures** via a `Symbol` (so the tag can never leak into a
JSON error body and survives on error types this module doesn't own, like a `SyntaxError`).
`isBilledModelFailure()` reads it, and the quota code refuses to refund those.

Structured outputs guarantees only that the *final* text block matches the schema, so
`extractStructuredJson` takes the last text block, not the first.

### Quota accounting (`middleware/quota.ts`)

`reserveAiCall` is a single conditional `UPDATE` that resets-if-new-day, checks the limit,
and increments in one statement — Postgres serializes concurrent updates on the row, so two
tabs cannot both slip through on the same pre-increment read. Call it immediately before
the generation attempt.

`releaseAiCallOnFailure` refunds a reservation only when the attempt cost nothing (S3 read
failed, transport error, missing API key). It never refunds after Claude answered. Call
sites track that with a local `billed` flag *in addition* to `isBilledModelFailure`,
because the symbol only covers failures raised inside the Anthropic client — a DB write
that fails after a successful generation must not refund either. Without that flag, a write
that fails every time would let a Basic user burn unbounded tokens at zero quota cost,
which is exactly what the cap exists to prevent.

The refund is best-effort and **never rejects**: every call site runs it from a `catch` on
the way to re-throwing the *original* error, so letting a refund error escape would replace
a 422 refusal with a generic 500.

### Staleness gating

A saved AI artifact records `baseResumeId` + `jobPostingHash`. While both still match, the
server refuses to regenerate (409) and the client disables the button. Uploading a new
resume or editing the posting changes one of them and re-enables it.

`jobPostingFingerprint(posting)` (in `lib/prompt.ts`) is the shared SHA-256 over every
posting field an AI prompt reads — title, company name, location, salary, description, URL.
It is deliberately shared so all features agree on what "the posting changed" means.

The LinkedIn note uses a wider hash, `connectMessageFingerprint`, which folds in the
contact, the application's status and notes, the resume id, and the specialization —
because all of those feed its prompt. **If you add an input to a prompt, add it to that
prompt's fingerprint**, or the gate will refuse regenerates the user is entitled to and the
button will look broken.

`connectMessageUpToDate` is computed server-side on *every* response that carries contacts,
not just the GET — a PATCH to the application's own status or notes re-enables the button
for all of its contacts at once.

### In-flight guard (`lib/inFlight.ts`)

A `Set` in process memory guarding the check-then-act window, so a double-click or a second
tab can't double-bill. Each feature owns its own guard instance so they never block each
other. **This is not a distributed lock** — it is correct for exactly one API container. If
the API ever scales past one instance, replace it with a DB- or Redis-backed lock.

### Specializations

Each AI feature keeps a `lib/*Specializations.ts` map keyed by `CareerSpecialization`,
holding that field's guidance (and, for resume tips, its two focus-section definitions).
Labels always come from `careerSpecializations.ts` so wording can't drift between features.

For resume tips the focus keys are **part of the persisted contract** — they are JSON keys
in stored analyses. Never rename one that has shipped; old analyses would stop rendering.

---

## 8. Client conventions

Next.js 15 App Router, React 19, Tailwind 3. Every page is `"use client"` — there is no
server-side data fetching, because every request needs a Firebase ID token from the browser.

**Pages** (`src/app/`): `/` (landing), `/login`, `/signup`, `/forgot-password`,
`/dashboard`, `/applications`, `/applications/[id]`, `/settings`, `/admin`.
`/applications/[id]` is the big one — it hosts all five AI sections.

**`AppShell`** wraps every authenticated page: nav (Admin link only for `tier: ADMIN`), the
AI-usage badge, and `useRequireAuth`. `useRequireAdmin` guards `/admin`.

**`apiFetch` / `apiJson`** (`lib/api.ts`) are the only way to reach the API. They attach the
ID token and the App Check token, set `Content-Type` unless the body is `FormData`, and
resolve relative paths against `NEXT_PUBLIC_API_URL`. `apiJson` throws with the server's
`error` message on a non-2xx.

`apiFetch` also fires `notifyAiUsage()` after **every settled** AI-generation request (POST
to one of five path suffixes), not just successful ones — because a failure raised after
Claude answered deliberately keeps its quota reservation, and gating on `ok` left the usage
badge under-reporting. The listener re-reads the authoritative count from `/api/user/me`.

**`AuthContext`** owns Firebase auth *and* the backend user row (`appUser`: tier, quota,
pending request). Several details there are hard-won and commented — read them before
touching it:

- `providerIds` is tracked in separate state because Firebase mutates the `User` object in
  place on `reload()`, so React would never re-render after a password is added to a
  Google-only account.
- A sequence ref discards responses that resolve out of order or after sign-out.
- A transient failure **keeps** the last known-good `appUser`. Blanking it on any error
  meant one 429 dropped the admin link and usage badge mid-session — and on `/admin` the
  redirect guard is itself gated on `appUser`, so it neither redirected nor recovered.
- A 401 carrying an `APP_CHECK_*` code is **not** treated as a dead session; App Check
  rejections say nothing about the user's login state.
- `refreshAppUserIfStale` stamps its timestamp on *attempt*, not success, so a failing
  request isn't retried on every navigation.

**Styling** goes through `lib/ui.ts` — shared class tokens (`btnPrimary`, `btnAiSm`,
`cardClassName`, `inputClassName`, …) so a control looks identical everywhere. Add layout
utilities at the call site; don't fork a token. Actions that invoke a model use the `btnAi*`
tokens **and** the sparkle glyph — the glyph is what actually marks them.

**Types** in `lib/types.ts` mirror the server's Prisma models and AI content shapes by hand.
There is no codegen. See §10.

---

## 9. Testing

```bash
cd server && npm test        # vitest
cd client && npm test && npm run lint
cd lambda && npm test
```

CI (`.github/workflows/ci.yml`) runs three jobs — server, client, lambda — on every push
and PR: `npm ci`, `prisma generate` (server), `tsc --noEmit`, tests, plus `eslint` on the
client.

**Server tests** are route-level, using `supertest` against a bare Express app with the
router mounted, and mocks at the module boundary:

```ts
const { prismaMock } = vi.hoisted(() => ({ prismaMock: { jobPosting: { upsert: vi.fn() } } }));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../middleware/auth", () => ({
  authenticate: (req, _res, next) => { req.user = { id: "user-1" } as never; next(); },
}));
import jobsRouter from "./jobs";        // ← import AFTER the mocks
```

Prisma, S3, and Anthropic are always mocked — no test hits a database or spends a token.
`vi.hoisted` is required because `vi.mock` is hoisted above imports.

What's covered on purpose: the staleness fingerprint, input validation (including the
`javascript:` URL check), ownership and staleness behavior on the AI endpoints, quota
reserve/refund, the structural validation that stops a malformed hand-edited draft from
reaching the PDF renderer, and the migration guard.

**Client tests** run in a `node` environment against `src/**/*.test.ts` — pure logic only
(list sorting/filtering, auth-error mapping, status tables, date formatting under several
timezones). There are no component tests; to verify UI, drive the real app with the
`verify` skill.

---

## 10. Invariants — the list that matters

Things that are correct for a reason and will break quietly if you change them.

**Cross-file contracts that nothing enforces.** AI output is stored as opaque `Json`, so
drift renders empty sections instead of erroring. When you touch one, touch all of its
partners — each is marked `KEEP IN SYNC` in the source:

| Change | Also update |
| --- | --- |
| A `CareerSpecialization` value | `schema.prisma` enum · `lib/careerSpecializations.ts` · every `lib/*Specializations.ts` · `client/src/lib/types.ts` |
| Resume-tips content shape | `ResumeTipsContent` + `resumeTipsSchema` (`services/resumeTips.ts`) · focus keys in `lib/resumeTipsSpecializations.ts` · `ResumeTipsContent`/`ResumeTipsFocusKey` in `client/src/lib/types.ts` · labels in `client/src/lib/resumeTipsFocus.ts` |
| Tailored resume / cover letter shape | the service's type + schema · the renderer in `lib/resumeRender.ts` / `lib/coverLetterRender.ts` · the client type |
| A model/field the reminder digest reads | `lambda/src/db.ts` — it queries `FollowUp`, `Application`, `User`, `JobPosting`, `Company` with **raw SQL** and will not fail to compile on a rename |
| Region or resource names in CI | `infra/env.sh` |

**Never rename a shipped resume-tips focus key.** Stored analyses are JSON.

**Never let `migrate dev` drop `PremiumRequest_userId_pending_unique`.** §5.

**Never widen `isValidHttpUrl`.** Stored-XSS vector; there is a test.

**Never refund a quota reservation after Claude answered.** §7.

**Never add a prompt input without adding it to that prompt's fingerprint.** §7.

**Never `findUnique` by id alone on a user-owned row.** §4.

**`PASSWORD_RULES` is a typing-time checklist, not enforcement.** Firebase's hosted reset
page and the REST API both bypass it. Real enforcement needs Identity Platform's password
policy, which this project isn't upgraded for. Don't write code that assumes a password
satisfies those rules.

**One account per email, recoverable either way.** Signing up with Google creates an account
with no password, so a later email/password login is rejected — and Firebase won't say why
without leaking which emails are registered. The password-reset flow is the fix: it sets a
password on that same uid, keeping the data and enabling both sign-in methods. Reset links
open Firebase's hosted handler because this project cannot repoint the action URL (the API
rejects writes under `notification.sendEmail` with `400
EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`). A custom in-app handler was built and removed; don't
rebuild it.

**Reminders are idempotent per day.** `FollowUp.reminderSentAt` and
`Application.nudgeSentAt` are stamped only *after* SES accepts that user's email, and the
Lambda isolates per-user failures then throws at the end. A retried invocation re-sends
nothing that already went out; a genuinely failed send stays queued for the next run.

**The in-flight guard is process-local.** Single container only.

---

## 11. Recipes

### Add a field to a job posting

1. `schema.prisma` → field + comment. `npx prisma migrate dev --name add_x` (check the
   generated SQL for a phantom `DROP INDEX` first — §5).
2. `lib/jobPostingInput.ts` → parse + validate it.
3. Decide whether AI prompts read it. If yes: add it to `formatPostingForPrompt` **and**
   to `jobPostingFingerprint` — otherwise editing it won't unlock a regenerate.
4. `client/src/lib/types.ts` → mirror it; `components/JobPostingForm.tsx` → render it.
5. Test in `routes/jobs.test.ts`.

### Add a new AI feature

1. **Service** in `services/`: export the content type, the JSON schema, and a
   `generateX(resumeMarkdown, posting, specialization)` that calls `generateStructured`.
   Start at `reasoning: "medium"` and a generous `maxTokens`; tune by looking at output.
2. **Specialization map** in `lib/xSpecializations.ts`, keyed by `CareerSpecialization`,
   taking labels from `careerSpecializations.ts`.
3. **Model** in `schema.prisma` if it's persisted: `applicationId @unique`, `baseResumeId`,
   `jobPostingHash`, `content Json`, and `edited` if it's hand-editable.
4. **Routes**: a GET returning `{ artifact, upToDate, hasResume }` and a POST following the
   pipeline in §7 *exactly* — including the `billed` flag and its own `createInFlightGuard()`.
5. **Client**: a section component under `components/`, wired into
   `app/applications/[id]/page.tsx`, using `btnAi*` + the sparkle glyph, disabled while
   `upToDate`. Mirror the content type in `lib/types.ts`.
6. **Tests**: ownership, staleness 409, in-flight 409, quota 429, and the refund path.
7. If the POST path suffix is new, add it to `AI_GENERATION_PATH_SUFFIXES` in
   `client/src/lib/api.ts` so the usage badge updates.
8. If it's hand-editable and renders to a PDF, structurally validate the edited draft
   server-side before storing it (see `isCoverLetterContent`).

### Add a job-board scraper

Implement the `Scraper` interface (`services/scrapers/types.ts`) — `source`, a cheap
`matches(url)` hostname check, and `scrape(url)` returning a `NormalizedPosting`. Throw
`ScrapeError` with the right code (`INVALID_URL`, `UNSUPPORTED_URL`, `NOT_FOUND`,
`UPSTREAM_ERROR`) for expected failures. Append it to the `scrapers` array in
`services/scrapers/index.ts` — the route and the client contract don't change. Copy
`ashby.test.ts` for the test shape.

### Add a Career Specialization

Add the enum value in `schema.prisma` (+ migration), the label in
`lib/careerSpecializations.ts`, an entry in **every** `lib/*Specializations.ts` map
(TypeScript's `Record<CareerSpecialization, …>` will point you at each one), the two new
resume-tips focus keys in `client/src/lib/types.ts`, and their labels in
`client/src/lib/resumeTipsFocus.ts`. The Settings dropdown is server-driven — no client
change needed there.

---

## 12. Deployment

Use the **`deploy` skill** for the actual procedure; the short version:

A push to `main` **is** the deploy. CI runs server/client/lambda checks; then `deploy-api`
builds an arm64 image, pushes to ECR, and runs `deploy/on-instance-deploy.sh` on the EC2
instance via SSM Run Command (which runs `prisma migrate deploy` and restarts the
containers), then smoke-tests `/health`. `deploy-lambda` updates the function code in
parallel. Vercel redeploys the client on its own GitHub integration — it is not in
`ci.yml`, so a green Actions run says nothing about the frontend.

Production shape: EC2 t4g.micro in us-east-2 running the API container behind Caddy (TLS
for a DuckDNS host); private RDS reachable only from the API instance and the Lambda; S3
via the instance role; GitHub Actions authenticating by OIDC; secrets in SSM Parameter
Store under `/jobtracker/prod/*`, rendered to the instance's env file at deploy time. There
are no static AWS keys in production and no secrets in the repo.

`deploy-api` is guarded by an `if:` on repo variables, and **a skipped job still leaves the
workflow green** — check the job, not the workflow. Do not try to distinguish new code from
old with a route probe: App Check runs before routing and 401s every path, including
nonexistent ones.

Provisioning is scripted end-to-end in [`infra/`](../infra/README.md) — idempotent AWS CLI
scripts, numbered in run order.
