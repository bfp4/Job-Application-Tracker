#!/usr/bin/env bash
# Shared configuration for all infra scripts. Source this first:
#   source "$(dirname "$0")/env.sh"
#
# Git Bash (MSYS) rewrites arguments that look like POSIX paths — e.g. the
# SSM path /jobtracker/prod would become C:/Program Files/Git/jobtracker/prod.
# MSYS_NO_PATHCONV disables that for every aws call in these scripts.
export MSYS_NO_PATHCONV=1

export AWS_REGION="${AWS_REGION:-us-east-2}"
export APP="jobtracker"
export GITHUB_REPO="bfp4/Job-Application-Tracker"

# The DuckDNS hostname the API will be served from, e.g. myjobtracker.duckdns.org
export DUCKDNS_HOST="${DUCKDNS_HOST:-}"

# Existing resources this project builds around.
export RDS_INSTANCE_ID="${RDS_INSTANCE_ID:-job-tracker}"
export S3_BUCKET="${S3_BUCKET:-job-tracker-files-ari}"

# Reminder email identity (SES sandbox: sender AND recipient must be verified).
export SES_IDENTITY="${SES_IDENTITY:-generalarileverton@gmail.com}"

# Derived names — referenced by multiple scripts, change only in one place.
# The CI workflow (.github/workflows/ci.yml env block) repeats ECR_REPO and
# LAMBDA_FUNCTION because it cannot source this file — keep them in sync.
export SG_API="${APP}-api"
export SG_LAMBDA="${APP}-lambda"
export SG_VPCE="${APP}-vpce"
export SG_RDS="${APP}-rds"
export ECR_REPO="${APP}-api"
export EC2_ROLE="${APP}-ec2"
export DEPLOY_ROLE="${APP}-github-deploy"
export LAMBDA_ROLE="${APP}-reminders-role"
export SCHEDULER_ROLE="${APP}-scheduler"
export LAMBDA_FUNCTION="${APP}-reminders"
export SCHEDULE_NAME="${APP}-daily-reminders"
export KEY_PAIR="${APP}-key"
export SSM_PATH="/jobtracker/prod"

export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Everything (EC2, Lambda, endpoints, SGs) must land in the VPC that already
# hosts RDS, so derive it from the DB instance rather than assuming a default.
# Resolved once at source time — sg_id/vpc_subnet_ids are called repeatedly
# per script and must not each re-run the RDS describe call.
export VPC_ID="$(aws rds describe-db-instances --db-instance-identifier "$RDS_INSTANCE_ID" \
  --query "DBInstances[0].DBSubnetGroup.VpcId" --output text)"

vpc_subnet_ids() {
  aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
    --query "Subnets[*].SubnetId" --output text
}

sg_id() {
  # $1 = group name; prints the id or "None"
  aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$1" "Name=vpc-id,Values=$VPC_ID" \
    --query "SecurityGroups[0].GroupId" --output text
}

require_duckdns_host() {
  if [ -z "$DUCKDNS_HOST" ]; then
    echo "Set DUCKDNS_HOST first, e.g.: export DUCKDNS_HOST=myjobtracker.duckdns.org" >&2
    exit 1
  fi
}
