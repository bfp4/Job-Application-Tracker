#!/usr/bin/env bash
# Points the DuckDNS subdomain at the Elastic IP. One-shot: the EIP is
# static, so there is no need for a refresh cron.
# Requires: export DUCKDNS_TOKEN=<token from https://www.duckdns.org>
set -euo pipefail
source "$(dirname "$0")/env.sh"
require_duckdns_host

: "${DUCKDNS_TOKEN:?Set DUCKDNS_TOKEN (from your DuckDNS account page)}"

SUBDOMAIN="${DUCKDNS_HOST%%.duckdns.org}"
EIP="$(aws ec2 describe-addresses --filters "Name=tag:App,Values=$APP" \
  --query "Addresses[0].PublicIp" --output text)"
[ "$EIP" != "None" ] || { echo "No Elastic IP found — run 05-ec2.sh first." >&2; exit 1; }

RESULT="$(curl -fsS "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=${EIP}")"
echo "DuckDNS: $RESULT ($DUCKDNS_HOST -> $EIP)"
[ "$RESULT" = "OK" ] || exit 1

echo "Verify with: nslookup $DUCKDNS_HOST (TTL is 60s)"
