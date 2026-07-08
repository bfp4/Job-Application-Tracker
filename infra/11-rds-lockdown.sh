#!/usr/bin/env bash
# FINAL STEP — takes RDS off the public internet:
#   1. swaps the DB's security groups to jobtracker-rds only
#      (5432 from the API instance SG and the Lambda SG)
#   2. turns off the publicly-accessible flag
#
# Both changes land in ONE modify-db-instance call, so the API never loses
# the database mid-flight.
#
# AFTER THIS, your laptop cannot reach RDS directly. Prisma migrate/studio
# go through the SSH tunnel (see README "Local dev against private RDS").
#
# Run ONLY after: the deployed API works end-to-end, the Lambda test email
# arrived, and you have verified the SSH tunnel works.
set -euo pipefail
source "$(dirname "$0")/env.sh"

RDS_SG_ID="$(sg_id "$SG_RDS")"
[ "$RDS_SG_ID" != "None" ] || { echo "Run 01-security-groups.sh first." >&2; exit 1; }

EIP="$(aws ec2 describe-addresses --filters "Name=tag:App,Values=$APP" \
  --query "Addresses[0].PublicIp" --output text)"

echo "Tunnel command for future local DB access (TEST IT FIRST in another terminal):"
echo
echo "  ssh -i infra/${KEY_PAIR}.pem -N -L 5433:$(aws rds describe-db-instances \
  --db-instance-identifier "$RDS_INSTANCE_ID" \
  --query "DBInstances[0].Endpoint.Address" --output text):5432 ec2-user@${EIP}"
echo
echo "  then use DATABASE_URL with host localhost:5433"
echo

if [ "${1:-}" != "--confirm" ]; then
  echo "Dry run. Re-run with --confirm to apply the lockdown."
  exit 0
fi

aws rds modify-db-instance \
  --db-instance-identifier "$RDS_INSTANCE_ID" \
  --vpc-security-group-ids "$RDS_SG_ID" \
  --no-publicly-accessible \
  --apply-immediately >/dev/null

echo "Lockdown applied (takes a few minutes). Verify:"
echo "  - psql/Studio direct to the RDS endpoint from this machine: must FAIL"
echo "  - the deployed API still serves data"
echo "  - aws lambda invoke still sends the digest"
