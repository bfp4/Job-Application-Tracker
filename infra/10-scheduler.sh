#!/usr/bin/env bash
# EventBridge Scheduler: invokes the reminder Lambda daily at 14:00 UTC
# (9-10 AM US Eastern depending on DST).
set -euo pipefail
source "$(dirname "$0")/env.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

LAMBDA_ARN="$(aws lambda get-function --function-name "$LAMBDA_FUNCTION" \
  --query "Configuration.FunctionArn" --output text)"

# ---------- scheduler role ----------
cat >"$tmp/trust.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "scheduler.amazonaws.com"},
    "Action": "sts:AssumeRole",
    "Condition": {"StringEquals": {"aws:SourceAccount": "${ACCOUNT_ID}"}}
  }]
}
EOF
if ! aws iam get-role --role-name "$SCHEDULER_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$SCHEDULER_ROLE" \
    --assume-role-policy-document "file://$tmp/trust.json" >/dev/null
  echo "Role created: $SCHEDULER_ROLE"
fi

cat >"$tmp/policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "${LAMBDA_ARN}"
  }]
}
EOF
aws iam put-role-policy --role-name "$SCHEDULER_ROLE" \
  --policy-name "${SCHEDULER_ROLE}-inline" --policy-document "file://$tmp/policy.json"

ROLE_ARN="$(aws iam get-role --role-name "$SCHEDULER_ROLE" --query "Role.Arn" --output text)"

# ---------- schedule ----------
ARGS=(
  --name "$SCHEDULE_NAME"
  --schedule-expression "cron(0 14 * * ? *)"
  --flexible-time-window "Mode=OFF"
  --target "Arn=${LAMBDA_ARN},RoleArn=${ROLE_ARN}"
)
if aws scheduler get-schedule --name "$SCHEDULE_NAME" >/dev/null 2>&1; then
  aws scheduler update-schedule "${ARGS[@]}" >/dev/null
  echo "Schedule updated: $SCHEDULE_NAME"
else
  aws scheduler create-schedule "${ARGS[@]}" >/dev/null
  echo "Schedule created: $SCHEDULE_NAME (daily 14:00 UTC)"
fi
