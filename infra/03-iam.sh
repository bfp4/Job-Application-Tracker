#!/usr/bin/env bash
# Creates the three IAM roles plus the GitHub OIDC provider:
#   jobtracker-ec2            — instance role: SSM agent, ECR pull, S3 R/W, read /jobtracker/prod/*
#   jobtracker-github-deploy  — assumed by GitHub Actions via OIDC (main branch only)
#   jobtracker-reminders-role — Lambda: VPC ENIs + ses:SendEmail
set -euo pipefail
source "$(dirname "$0")/env.sh"

tmp="$(winpath "$(mktemp -d)")"
trap 'rm -rf "$tmp"' EXIT

ensure_role() {
  local role="$1" trust_file="$2"
  if aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    echo "Role exists: $role"
    aws iam update-assume-role-policy --role-name "$role" --policy-document "file://$trust_file"
  else
    aws iam create-role --role-name "$role" \
      --assume-role-policy-document "file://$trust_file" \
      --query "Role.Arn" --output text
  fi
}

# ---------- (a) EC2 instance role ----------
cat >"$tmp/ec2-trust.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ec2.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF
ensure_role "$EC2_ROLE" "$tmp/ec2-trust.json"

aws iam attach-role-policy --role-name "$EC2_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

cat >"$tmp/ec2-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrPull",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3ResumeBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::${S3_BUCKET}/*"
    },
    {
      "Sid": "ReadProdParams",
      "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath", "ssm:GetParameter"],
      "Resource": "arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter${SSM_PATH}*"
    }
  ]
}
EOF
aws iam put-role-policy --role-name "$EC2_ROLE" \
  --policy-name "${EC2_ROLE}-inline" --policy-document "file://$tmp/ec2-policy.json"

if ! aws iam get-instance-profile --instance-profile-name "$EC2_ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$EC2_ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$EC2_ROLE" --role-name "$EC2_ROLE"
  echo "Instance profile created: $EC2_ROLE"
fi

# ---------- (b) GitHub OIDC provider + deploy role ----------
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  echo "OIDC provider created."
fi

# SendCommand is scoped to the exact API instance. A tag condition
# (ssm:resourceTag) would be nicer but was denied in practice; if the
# instance is ever replaced, re-run this script to refresh the ARN.
INSTANCE_ID_FOR_POLICY="$(aws ec2 describe-instances \
  --filters "Name=tag:App,Values=$APP" "Name=instance-state-name,Values=pending,running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)"
if [ "$INSTANCE_ID_FOR_POLICY" = "None" ] || [ -z "$INSTANCE_ID_FOR_POLICY" ]; then
  # Instance not launched yet (03 runs before 05 on first setup): allow any
  # instance in the account/region until a re-run pins it down.
  INSTANCE_SUFFIX="*"
  echo "NOTE: no ${APP} instance found — SendCommand scoped to instance/*."
  echo "      Re-run this script after 05-ec2.sh to pin it to the instance."
else
  INSTANCE_SUFFIX="${INSTANCE_ID_FOR_POLICY}"
fi

cat >"$tmp/gh-trust.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "$OIDC_ARN"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
EOF
ensure_role "$DEPLOY_ROLE" "$tmp/gh-trust.json"

cat >"$tmp/gh-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrLogin",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${ECR_REPO}"
    },
    {
      "Sid": "DeployViaSsmInstance",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:${AWS_REGION}:${ACCOUNT_ID}:instance/${INSTANCE_SUFFIX}",
        "arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:managed-instance/${INSTANCE_SUFFIX}"
      ]
    },
    {
      "Sid": "DeployViaSsmDocument",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": "arn:aws:ssm:${AWS_REGION}::document/AWS-RunShellScript"
    },
    {
      "Sid": "PollDeploy",
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    },
    {
      "Sid": "UpdateLambda",
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode", "lambda:GetFunction"],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:${LAMBDA_FUNCTION}"
    }
  ]
}
EOF
aws iam put-role-policy --role-name "$DEPLOY_ROLE" \
  --policy-name "${DEPLOY_ROLE}-inline" --policy-document "file://$tmp/gh-policy.json"

# ---------- (c) Lambda execution role ----------
cat >"$tmp/lambda-trust.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF
ensure_role "$LAMBDA_ROLE" "$tmp/lambda-trust.json"

# AWSLambdaVPCAccessExecutionRole = CloudWatch Logs + the EC2 ENI permissions
# a VPC-attached Lambda needs to create its network interfaces.
aws iam attach-role-policy --role-name "$LAMBDA_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole

cat >"$tmp/lambda-policy.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "SendReminderEmail",
    "Effect": "Allow",
    "Action": "ses:SendEmail",
    "Resource": "*"
  }]
}
EOF
aws iam put-role-policy --role-name "$LAMBDA_ROLE" \
  --policy-name "${LAMBDA_ROLE}-inline" --policy-document "file://$tmp/lambda-policy.json"

echo "IAM done. Deploy role ARN:"
aws iam get-role --role-name "$DEPLOY_ROLE" --query "Role.Arn" --output text
