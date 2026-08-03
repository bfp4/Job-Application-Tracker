#!/usr/bin/env bash
# Full deploy step, executed on the EC2 instance via SSM Run Command from
# GitHub Actions. Expects /opt/app/deploy.env to define AWS_REGION,
# ECR_REGISTRY, ECR_IMAGE and DUCKDNS_HOST (written by instance user-data).
set -euo pipefail

cd /opt/app
set -a
source ./deploy.env
set +a

aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

./render-env.sh

docker compose --env-file deploy.env pull api

# Migrations run here (not CI): only the instance can reach the private RDS.
docker compose --env-file deploy.env run --rm api npx prisma migrate deploy

docker compose --env-file deploy.env up -d

# Caddy bind-mounts /opt/app/Caddyfile, and `up -d` only recreates a container
# when the *service definition* changes — a content-only edit to the Caddyfile
# goes unnoticed, so it would sit on disk unapplied until some unrelated
# restart picked it up. Reload it explicitly. Validating first means a broken
# Caddyfile fails the deploy loudly with Caddy still serving its old config,
# rather than taking TLS down.
docker compose --env-file deploy.env exec -T caddy \
  caddy validate --config /etc/caddy/Caddyfile
docker compose --env-file deploy.env exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile

docker image prune -f
echo "Deploy complete: $ECR_IMAGE"
