#!/usr/bin/env bash
# Verifies the SES email identity used as both sender and (while SES is in
# sandbox mode) the only allowed recipient.
set -euo pipefail
source "$(dirname "$0")/env.sh"

if aws sesv2 get-email-identity --email-identity "$SES_IDENTITY" >/dev/null 2>&1; then
  STATUS="$(aws sesv2 get-email-identity --email-identity "$SES_IDENTITY" \
    --query "VerifiedForSendingStatus" --output text)"
  echo "Identity exists: $SES_IDENTITY (verified: $STATUS)"
else
  aws sesv2 create-email-identity --email-identity "$SES_IDENTITY" >/dev/null
  echo "Identity created: $SES_IDENTITY"
  STATUS="false"
fi

if [ "$STATUS" != "True" ] && [ "$STATUS" != "true" ]; then
  echo
  echo "ACTION REQUIRED: open the inbox for $SES_IDENTITY and click the"
  echo "verification link AWS just sent. Re-run this script to confirm."
fi
