#!/usr/bin/env bash
# Opens a local port onto the private RDS instance, tunnelled through the API
# EC2 box using SSM port forwarding. This replaces the old `ssh -L` tunnel —
# the instance has no inbound SSH (see 01-security-groups.sh).
#
# Leave it running in its own terminal; Ctrl-C closes the tunnel.
#
#   ./infra/tunnel.sh                  # localhost:15433 -> RDS:5432
#   LOCAL_PORT=15444 ./infra/tunnel.sh # different local port
#
# Requires the AWS Session Manager plugin (the aws CLI alone is not enough), and
# ssm:StartSession on the instance plus the port-forwarding document.
#
# Deliberately does NOT source env.sh: that resolves VPC_ID via
# rds:DescribeDBInstances at source time, which the restricted day-to-day IAM
# user is not granted.
set -euo pipefail
export MSYS_NO_PATHCONV=1

AWS_REGION="${AWS_REGION:-us-east-2}"
LOCAL_PORT="${LOCAL_PORT:-15433}"
REMOTE_PORT="${REMOTE_PORT:-5432}"
HERE="$(dirname "$0")"

if ! command -v session-manager-plugin >/dev/null 2>&1; then
  echo "session-manager-plugin is not on PATH." >&2
  echo "  Install it, then open a NEW terminal so PATH picks it up:" >&2
  echo "  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html" >&2
  exit 1
fi

# ---------- which instance ----------
# It has to be *this* project's API box. This used to take the first Online SSM
# instance in the region, which was fine until the account gained a second
# project: another app's instance sorted first, and since it isn't in the RDS
# security group the tunnel opened, accepted the connection, then dropped it —
# surfacing as "Can't reach database server", which points at everything except
# the real cause. Filter on the App tag that 05-ec2.sh sets instead.
APP="${APP:-jobtracker}"
INSTANCE_ID="${INSTANCE_ID:-}"
if [ -z "$INSTANCE_ID" ]; then
  INSTANCE_ID="$(aws ssm describe-instance-information --region "$AWS_REGION" \
    --filters "Key=tag:App,Values=$APP" \
    --query "InstanceInformationList[?PingStatus=='Online'].InstanceId | [0]" \
    --output text 2>/dev/null || true)"
fi
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "No Online SSM instance tagged App=$APP in $AWS_REGION." >&2
  echo "  Other projects' instances are deliberately not eligible: they aren't" >&2
  echo "  in the database's security group, so a tunnel through one fails later" >&2
  echo "  and looks like an unreachable database." >&2
  echo "  Set INSTANCE_ID=i-... explicitly, or check the agent is running." >&2
  exit 1
fi

# ---------- which database host ----------
# The endpoint is not committed to git: read it from the gitignored prod.env,
# an explicit RDS_HOST, or the RDS API (needs rds:DescribeDBInstances).
RDS_HOST="${RDS_HOST:-}"
if [ -z "$RDS_HOST" ] && [ -f "$HERE/prod.env" ]; then
  RDS_HOST="$(grep -oE '@[A-Za-z0-9.-]+\.rds\.amazonaws\.com' "$HERE/prod.env" |
    head -1 | cut -c2-)"
fi
if [ -z "$RDS_HOST" ]; then
  RDS_HOST="$(aws rds describe-db-instances --region "$AWS_REGION" \
    --db-instance-identifier "${RDS_INSTANCE_ID:-job-tracker}" \
    --query "DBInstances[0].Endpoint.Address" --output text 2>/dev/null || true)"
fi
if [ -z "$RDS_HOST" ] || [ "$RDS_HOST" = "None" ]; then
  echo "Could not determine the RDS endpoint." >&2
  echo "  Set RDS_HOST=<name>.rds.amazonaws.com, or run where infra/prod.env exists." >&2
  exit 1
fi

# ---------- local port must be free ----------
if (echo >"/dev/tcp/127.0.0.1/$LOCAL_PORT") 2>/dev/null; then
  echo "Port $LOCAL_PORT is already in use — is a tunnel already running?" >&2
  exit 1
fi

echo "Tunnel : localhost:${LOCAL_PORT} -> ${RDS_HOST}:${REMOTE_PORT}"
echo "Via    : ${INSTANCE_ID} (${AWS_REGION})"
echo
echo "This is PRODUCTION. Point DATABASE_URL at localhost:${LOCAL_PORT} only when"
echo "you mean to touch live data. Ctrl-C closes the tunnel."
echo

exec aws ssm start-session --region "$AWS_REGION" --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${RDS_HOST}\"],\"portNumber\":[\"${REMOTE_PORT}\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}"
