#!/usr/bin/env bash
# Creates the four security groups. Safe to re-run: existing groups and
# duplicate rules are tolerated.
#
#   jobtracker-api    — the EC2 instance: 80/443 from anywhere, no SSH at all
#                       (shell access is SSM Session Manager — see README)
#   jobtracker-lambda — the reminder Lambda's ENIs: no ingress needed
#   jobtracker-vpce   — the SES VPC endpoint: 443 from the Lambda SG
#   jobtracker-rds    — RDS: 5432 from api + lambda SGs ONLY
#                       (created now, attached to RDS later by 11-rds-lockdown.sh)
set -euo pipefail
source "$(dirname "$0")/env.sh"

echo "VPC: $VPC_ID"

ensure_sg() {
  local name="$1" desc="$2" id
  id="$(sg_id "$name")"
  if [ "$id" = "None" ] || [ -z "$id" ]; then
    id="$(aws ec2 create-security-group --group-name "$name" \
      --description "$desc" --vpc-id "$VPC_ID" \
      --query GroupId --output text)"
    echo "Created $name -> $id" >&2
  else
    echo "Exists  $name -> $id" >&2
  fi
  printf '%s' "$id"
}

allow() {
  # allow <sg-id> <port> <source: cidr or sg-id> — duplicates are fine
  local sg="$1" port="$2" src="$3"
  if [[ "$src" == sg-* ]]; then
    aws ec2 authorize-security-group-ingress --group-id "$sg" \
      --protocol tcp --port "$port" --source-group "$src" 2>/dev/null ||
      echo "  rule exists: $sg :$port from $src"
  else
    aws ec2 authorize-security-group-ingress --group-id "$sg" \
      --protocol tcp --port "$port" --cidr "$src" 2>/dev/null ||
      echo "  rule exists: $sg :$port from $src"
  fi
}

API_SG="$(ensure_sg "$SG_API" "Job tracker API instance: HTTP/HTTPS from world, no SSH")"
LAMBDA_SG="$(ensure_sg "$SG_LAMBDA" "Job tracker reminder Lambda ENIs (egress only)")"
VPCE_SG="$(ensure_sg "$SG_VPCE" "SES VPC endpoint: HTTPS from the Lambda SG")"
RDS_SG="$(ensure_sg "$SG_RDS" "RDS Postgres: 5432 from API and Lambda SGs only")"

allow "$API_SG" 80 "0.0.0.0/0"
allow "$API_SG" 443 "0.0.0.0/0"

# No SSH rule, deliberately. Shell access is SSM Session Manager, which needs no
# inbound port at all — the instance profile already carries
# AmazonSSMManagedInstanceCore (03-iam.sh) and the agent ships with AL2023.
#
# This also removes a footgun: the old version defaulted to 0.0.0.0/0 whenever
# MY_IP was unset, and `allow` only ever adds, so every IP change left another
# stale rule behind granting SSH to whoever the ISP handed that address to next.
revoke_ssh() {
  # Clears the IPv4 CIDR rules earlier runs left behind. Scoped to permissions
  # whose FromPort is exactly 22 — it does not catch an IPv6 rule or a wider
  # port range that happens to include 22, so treat a clean run as "the rules
  # this script created are gone", not as proof that nothing can reach :22.
  # Verify with: aws ec2 describe-security-groups --group-ids <sg>
  local sg="$1" cidr
  for cidr in $(aws ec2 describe-security-groups --group-ids "$sg" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' \
    --output text); do
    aws ec2 revoke-security-group-ingress --group-id "$sg" \
      --protocol tcp --port 22 --cidr "$cidr" >/dev/null
    echo "  revoked stale SSH rule: :22 from $cidr"
  done
}
revoke_ssh "$API_SG"

allow "$VPCE_SG" 443 "$LAMBDA_SG"

allow "$RDS_SG" 5432 "$API_SG"
allow "$RDS_SG" 5432 "$LAMBDA_SG"

echo "Done. RDS SG ($RDS_SG) is NOT attached yet — 11-rds-lockdown.sh does that."
