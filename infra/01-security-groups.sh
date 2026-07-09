#!/usr/bin/env bash
# Creates the four security groups. Safe to re-run: existing groups and
# duplicate rules are tolerated.
#
#   jobtracker-api    — the EC2 instance: 80/443 from anywhere, 22 from MY_IP
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

API_SG="$(ensure_sg "$SG_API" "Job tracker API instance: HTTP/HTTPS from world, SSH from MY_IP")"
LAMBDA_SG="$(ensure_sg "$SG_LAMBDA" "Job tracker reminder Lambda ENIs (egress only)")"
VPCE_SG="$(ensure_sg "$SG_VPCE" "SES VPC endpoint: HTTPS from the Lambda SG")"
RDS_SG="$(ensure_sg "$SG_RDS" "RDS Postgres: 5432 from API and Lambda SGs only")"

allow "$API_SG" 80 "0.0.0.0/0"
allow "$API_SG" 443 "0.0.0.0/0"

# SSH: restrict to your current IP if MY_IP is set (recommended), else world.
SSH_CIDR="${MY_IP:+${MY_IP}/32}"
SSH_CIDR="${SSH_CIDR:-0.0.0.0/0}"
[ "$SSH_CIDR" = "0.0.0.0/0" ] && echo "WARNING: SSH open to the world — set MY_IP=<your-ip> and re-run to restrict."
allow "$API_SG" 22 "$SSH_CIDR"

allow "$VPCE_SG" 443 "$LAMBDA_SG"

allow "$RDS_SG" 5432 "$API_SG"
allow "$RDS_SG" 5432 "$LAMBDA_SG"

echo "Done. RDS SG ($RDS_SG) is NOT attached yet — 11-rds-lockdown.sh does that."
