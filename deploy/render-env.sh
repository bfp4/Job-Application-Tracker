#!/usr/bin/env bash
# Renders /opt/app/.env from SSM Parameter Store SecureStrings under
# /jobtracker/prod/*. Runs on the EC2 instance (instance role grants
# ssm:GetParametersByPath + kms:Decrypt on this path only).
set -euo pipefail

# SSM_PATH arrives via /opt/app/deploy.env (sourced by on-instance-deploy.sh),
# the same value infra/env.sh used to scope the IAM grant and write the params.
SSM_PATH="${SSM_PATH:-/jobtracker/prod}"
ENV_FILE="/opt/app/.env"

umask 077
tmp="$(mktemp)"

# Values are written single-quoted: docker compose's env_file parser strips
# the quotes but does NOT expand escape sequences inside them, so the
# Firebase key's literal \n survives (double quotes would expand it, and
# older parsers keep them entirely). Constraint carried over from the text
# parsing here: values must be single-line and must not contain single quotes.
aws ssm get-parameters-by-path \
  --path "$SSM_PATH" \
  --with-decryption \
  --query "Parameters[*].[Name,Value]" \
  --output text |
  while IFS=$'\t' read -r name value; do
    key="${name##*/}"
    printf "%s='%s'\n" "$key" "$value" >>"$tmp"
  done

if [ ! -s "$tmp" ]; then
  echo "No parameters found under $SSM_PATH — refusing to write an empty $ENV_FILE" >&2
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Rendered $(grep -c '=' "$ENV_FILE") variables to $ENV_FILE"
