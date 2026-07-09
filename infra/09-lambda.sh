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
ZIP="$LAMBDA_DIR/function.zip"
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

# JSON via node so special characters in the connection string survive.
ENV_JSON="$LAMBDA_DIR/.env-vars.json"
DB_URL="$DATABASE_URL" SES_FROM_ADDR="$SES_IDENTITY" node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    Variables: {
      DATABASE_URL: process.env.DB_URL,
      SES_FROM: process.env.SES_FROM_ADDR,
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
