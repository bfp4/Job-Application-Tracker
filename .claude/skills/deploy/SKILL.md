---
name: deploy
description: Deploy the Job Application Tracker to production (API on EC2 + frontend on Vercel). Use whenever asked to deploy, ship, release, or push changes live. Covers the pre-flight checks, the push-to-main trigger, and how to verify the deploy landed.
---

# Deploying the Job Application Tracker

Production has two halves, both triggered by **pushing to `main`**:

- **API** (`server/`) → GitHub Actions (`.github/workflows/ci.yml`) builds an arm64
  Docker image, pushes to ECR, and deploys to the EC2 instance via SSM Run Command,
  then smoke-tests `/health`.
- **Frontend** (`client/`) → Vercel redeploys automatically on the same push (its own
  GitHub integration, not in `ci.yml`; CI only typechecks the client).
- **Reminder Lambda** (`lambda/`) → `deploy-lambda` job updates the function code.

There is no separate "deploy" command — a push to `main` is the deploy. CI runs the
`server`, `client`, and `lambda` check jobs first; `deploy-api`/`deploy-lambda` only run
on a push to `main` and only after those pass.

## 1. Pre-flight: run the exact checks CI runs

Do this before pushing so you never ship a red build. All must pass:

```bash
# server (from server/)
npx prisma generate && npx tsc --noEmit && npm test
# client (from client/)
npx tsc --noEmit
# lambda — only if you touched lambda/ (from lambda/)
npx tsc --noEmit && npm test
```

## 2. Migrations (only if `server/prisma/schema.prisma` changed)

`prisma migrate deploy` runs **on the EC2 instance** during the deploy
(`deploy/on-instance-deploy.sh`), because only the instance can reach the private RDS.
So a schema change ships automatically with the push — you do **not** run
`migrate deploy` yourself.

- If you added a migration, make sure the migration file is committed (`prisma migrate dev`
  against the DB requires the SSH tunnel up first — see the `project-aws-prod-infra` memory).
- No schema change → nothing to do here.

## 3. Deploy

Commit the change and push to `main` (the repo's convention is linear commits directly
on `main`):

```bash
git add <files>
git commit -m "<imperative summary>

Co-Authored-By: <current model> <noreply@anthropic.com>"
git push origin main
```

Use whichever model name your harness instructions specify for the `Co-Authored-By`
trailer — don't hardcode one here, it goes stale every release.

**Shell gotcha:** this repo's default shell is Git Bash, and the PowerShell here-string
form (`-m @'…'@`) is *not* bash syntax — bash passes it through literally and you end up
with a commit whose subject line is `@`. For a multi-line message in bash use a real
heredoc (`git commit -F - <<'MSG' … MSG`) or repeated `-m` flags.

Deploying is outward-facing — only push when the user has asked you to deploy/ship.

## 4. Verify the deploy landed

`gh` is **not** installed here, but the repo is public — so verify against the GitHub
Actions REST API, keyed to the SHA you just pushed. Give the pipeline a couple of
minutes (build + push + SSM ≈ 2 min), then:

```bash
SHA=$(git rev-parse HEAD)

# Workflow-level result for YOUR commit:
curl -s "https://api.github.com/repos/bfp4/Job-Application-Tracker/actions/runs?head_sha=$SHA" \
  | grep -E '"(status|conclusion)"' | head -2

# Per-job results — this is the one that matters:
RUN=$(curl -s "https://api.github.com/repos/bfp4/Job-Application-Tracker/actions/runs?head_sha=$SHA" \
  | grep -m1 '"id"' | tr -dc '0-9')
curl -s "https://api.github.com/repos/bfp4/Job-Application-Tracker/actions/runs/$RUN/jobs" \
  | grep -E '"(name|conclusion)"' | grep -B1 -A1 'Deploy API to EC2'
```

In the jobs payload `conclusion` comes *before* `name`, so the result you want is the
line **above** `"name": "Deploy API to EC2"` — read it carefully rather than grabbing the
first `conclusion` in the output.

Check **both**, not just the first: a green workflow does **not** prove the API
deployed. `deploy-api` is guarded by an `if:` on repo variables (see Key facts), and a
**skipped job still leaves the workflow `success`**. You want the `Deploy API to EC2`
job itself at `conclusion: success`, with its `Deploy on instance via SSM` step green —
that step is where `on-instance-deploy.sh` runs, so its success is also your signal that
`prisma migrate deploy` applied cleanly against RDS.

Then confirm the service is actually serving:

```bash
curl -fsS https://jobstrackerapi.duckdns.org/health   # {"status":"ok"}
```

> ⚠️ **Do not try to tell new code from old with a route probe.** An earlier version of
> this skill suggested `401 = deployed · 404 = old code` against a newly added endpoint.
> That has been broken since App Check went app-wide (commit `0db8454`): the middleware
> runs **before** routing and returns 401 for *every* path, including ones that don't
> exist. Verified 2026-07-28 — `POST /api/definitely-not-a-real-namespace` returns 401.
> The probe reports success on the first attempt no matter what is deployed. Use the
> Actions run above; it is the only signal here that distinguishes new code from old.

**Frontend:** Vercel deploys on its own GitHub integration and is not part of `ci.yml`,
so the Actions run says nothing about it. `curl -s -o /dev/null -w '%{http_code}'
https://jobstrackeragent.vercel.app/` returning 200 only proves the site is up, not that
your bundle shipped — most pages are auth-gated. To confirm a UI change actually renders,
drive a logged-in session (see the `verify` skill) rather than asserting from a 200.

## Rollback

The image is tagged with both `:latest` and `:<git-sha>` in ECR. To roll back, revert the
commit on `main` and push (re-runs the whole pipeline with the previous code), or re-point
the instance at a prior `:<sha>` tag. Prefer a revert-and-push for a clean audit trail.

## Key facts (see the `project-aws-prod-infra` memory for the full picture)

- Region **us-east-2**, account **510997984231**, repo **bfp4/Job-Application-Tracker**.
- API host **jobstrackerapi.duckdns.org**, EC2 **i-0c01d8004b6bbe88c** (t4g.micro, arm64),
  ECR repo **jobtracker-api**.
- Deploys use an **OIDC role + SSM Run Command** (no SSH keys in GitHub). Deploy-time repo
  variables: `INSTANCE_ID`, `DEPLOY_ROLE_ARN`, `ECR_REGISTRY`, `DUCKDNS_HOST` — if unset,
  the `deploy-api` job is skipped by its `if:` guard.
- RDS is private; local DB access is via an SSH tunnel only (`project-aws-prod-infra`).
