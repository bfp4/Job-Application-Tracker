#!/usr/bin/env bash
# Builds, zips, and creates/updates the reminder Lambda inside the VPC.
# DATABASE_URL is read (decrypted) from SSM and baked into the function's
# KMS-encrypted environment — the once-a-day function skips an SSM round
# trip per cold start.
set -euo pipefail
source "$(dirname "$0")/env.sh"

LAMBDA_DIR="$(dirname "$0")/../lambda"

# ---------- build + zip ----------
(cd "$LAMBDA_DIR" && npm ci && node build.mjs)
ZIP="$(winpath "$LAMBDA_DIR/function.zip")"
rm -f "$ZIP"
if command -v zip >/dev/null 2>&1; then
  (cd "$LAMBDA_DIR/dist" && zip -q ../function.zip index.js)
else
  # Git Bash on Windows has no zip; Compress-Archive is fine for a JS-only zip.
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Force -Path '$(cygpath -w "$LAMBDA_DIR/dist/index.js")' -DestinationPath '$(cygpath -w "$ZIP")'"
fi
echo "Bundle: $ZIP"

# ---------- config ----------
ROLE_ARN="$(aws iam get-role --role-name "$LAMBDA_ROLE" --query "Role.Arn" --output text)"
LAMBDA_SG_ID="$(sg_id "$SG_LAMBDA")"
SUBNETS="$(vpc_subnet_ids | tr '\t ' ',,' | sed 's/,*$//')"
DATABASE_URL="$(aws ssm get-parameter --name "${SSM_PATH}/DATABASE_URL" \
  --with-decryption --query "Parameter.Value" --output text)"

# The physical postal address CAN-SPAM requires in every digest (15 U.S.C.
# §7704(a)(5)). Kept in SSM rather than in this repo because it is a real home
# or mailbox address and the repo is public.
#
# Not optional and not defaulted: the handler refuses to send without it, so a
# missing parameter should stop the deploy here with a clear message rather
# than produce a function that throws once a day at 14:00 UTC.
require_duckdns_host
MAILING_ADDRESS="$(aws ssm get-parameter --name "${SSM_PATH}/MAILING_ADDRESS" \
  --query "Parameter.Value" --output text 2>/dev/null || true)"
if [ -z "$MAILING_ADDRESS" ] || [ "$MAILING_ADDRESS" = "None" ]; then
  cat >&2 <<EOF
${SSM_PATH}/MAILING_ADDRESS is not set.

The daily reminder digest is commercial email, and CAN-SPAM requires the
sender's valid physical postal address in the message body. Set it once:

  aws ssm put-parameter --name "${SSM_PATH}/MAILING_ADDRESS" --type String \\
    --value "JobTracker, 123 Example St, Springfield, IL 62704" --overwrite

A PO box or a virtual mailbox is fine; a fake address is not — a wrong one
violates §7704(a)(5) exactly as much as a missing one.
EOF
  exit 1
fi

# JSON via node so special characters in the connection string survive.
ENV_JSON="$(winpath "$LAMBDA_DIR/.env-vars.json")"
DB_URL="$DATABASE_URL" SES_FROM_ADDR="$SES_IDENTITY" \
MAIL_ADDR="$MAILING_ADDRESS" UNSUB_URL="https://${DUCKDNS_HOST}/unsubscribe" node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    Variables: {
      DATABASE_URL: process.env.DB_URL,
      SES_FROM: process.env.SES_FROM_ADDR,
      MAILING_ADDRESS: process.env.MAIL_ADDR,
      UNSUBSCRIBE_BASE_URL: process.env.UNSUB_URL,
    },
  }));
' "$ENV_JSON"
trap 'rm -f "$ENV_JSON"' EXIT

# ---------- create or update ----------
if aws lambda get-function --function-name "$LAMBDA_FUNCTION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$LAMBDA_FUNCTION" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_FUNCTION"
  aws lambda update-function-configuration --function-name "$LAMBDA_FUNCTION" \
    --environment "file://$ENV_JSON" >/dev/null
  echo "Updated: $LAMBDA_FUNCTION"
else
  aws lambda create-function \
    --function-name "$LAMBDA_FUNCTION" \
    --runtime nodejs22.x \
    --architectures arm64 \
    --handler index.handler \
    --memory-size 256 \
    --timeout 60 \
    --role "$ROLE_ARN" \
    --zip-file "fileb://$ZIP" \
    --vpc-config "SubnetIds=${SUBNETS},SecurityGroupIds=${LAMBDA_SG_ID}" \
    --environment "file://$ENV_JSON" \
    --tags "App=${APP}" >/dev/null
  echo "Created: $LAMBDA_FUNCTION (first VPC invoke is slow — ENI provisioning)"
fi

echo "Manual test: aws lambda invoke --function-name $LAMBDA_FUNCTION out.json && cat out.json"
