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

docker image prune -f
echo "Deploy complete: $ECR_IMAGE"
