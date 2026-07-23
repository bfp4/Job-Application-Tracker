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

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

Deploying is outward-facing — only push when the user has asked you to deploy/ship.

## 4. Verify the deploy landed

`gh` is **not** installed here, so verify against production directly. Give the API
pipeline a few minutes (build + push + SSM), then:

```bash
# API is up and healthy:
curl -fsS https://jobstrackerapi.duckdns.org/health

# Confirm YOUR new code is live, not just that the old container is healthy.
# Probe a route you added/changed. A route that exists but needs auth returns 401;
# a route that isn't deployed yet returns 404. Example for a new authed endpoint:
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://jobstrackerapi.duckdns.org/api/jobs/scrape
# 401 = new code deployed · 404 = old code still serving (wait / check Actions)
```

For the frontend, load the relevant page on the Vercel URL and confirm the change renders.

If you have credentials, the API deploy status is also visible in GitHub Actions
(repo `bfp4/Job-Application-Tracker`) and via the SSM command history in the AWS console.

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
