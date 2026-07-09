#!/usr/bin/env bash
# Uploads production server config as SecureStrings under /jobtracker/prod/.
# Values come from infra/prod.env (gitignored — copy prod.env.example and fill in).
#
# Values are passed via file:// so quoting and the Firebase key's literal \n
# sequences survive both Git Bash and the AWS CLI untouched.
set -euo pipefail
source "$(dirname "$0")/env.sh"

SRC="$(dirname "$0")/prod.env"
if [ ! -f "$SRC" ]; then
  echo "Missing $SRC — copy infra/prod.env.example and fill in production values." >&2
  exit 1
fi

# Only these keys are uploaded. Note: no AWS access keys — the instance role
# provides S3 credentials in production. No PORT either: 5000 is fixed infra,
# baked into the Dockerfile, compose healthcheck, and Caddyfile.
KEYS=(
  DATABASE_URL
  CORS_ORIGIN
  FIREBASE_PROJECT_ID
  FIREBASE_CLIENT_EMAIL
  FIREBASE_PRIVATE_KEY
  AWS_REGION
  AWS_S3_BUCKET_NAME
  ANTHROPIC_API_KEY
)

tmp="$(winpath "$(mktemp)")"
trap 'rm -f "$tmp"' EXIT

for key in "${KEYS[@]}"; do
  # Take the line for this key, strip the KEY= prefix and surrounding quotes.
  line="$(grep -E "^${key}=" "$SRC" | head -1 || true)"
  if [ -z "$line" ]; then
    echo "SKIP  $key (not present in prod.env)"
    continue
  fi
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value" >"$tmp"
  aws ssm put-parameter --name "${SSM_PATH}/${key}" \
    --type SecureString --overwrite --value "file://$tmp" >/dev/null
  echo "OK    ${SSM_PATH}/${key}"
done

echo
echo "Round-trip check (FIREBASE_PRIVATE_KEY must match prod.env exactly):"
aws ssm get-parameter --name "${SSM_PATH}/FIREBASE_PRIVATE_KEY" --with-decryption \
  --query "Parameter.Value" --output text | head -c 60
echo " ..."
