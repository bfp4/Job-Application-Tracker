#!/usr/bin/env bash
# Creates the SES VPC interface endpoint so the (internet-less) VPC Lambda
# can call the SES API. Single AZ to keep the cost to ~$7/mo; private DNS is
# VPC-wide so the Lambda resolves email.<region>.amazonaws.com regardless of
# which subnet its ENI lands in.
#
# If the SES API service is not available in this region, fall back to the
# SMTP endpoint (com.amazonaws.<region>.email-smtp) and send via SMTP
# (nodemailer) instead of the SES SDK.
set -euo pipefail
source "$(dirname "$0")/env.sh"

SERVICE="com.amazonaws.${AWS_REGION}.email"
VPC_ID="$(vpc_id)"
VPCE_SG="$(sg_id "$SG_VPCE")"
[ "$VPCE_SG" != "None" ] || { echo "Run 01-security-groups.sh first." >&2; exit 1; }

if ! aws ec2 describe-vpc-endpoint-services --query "ServiceNames" --output text |
  tr '\t' '\n' | grep -qx "$SERVICE"; then
  echo "ERROR: $SERVICE is not available in $AWS_REGION." >&2
  echo "Fallback: create com.amazonaws.${AWS_REGION}.email-smtp instead and" >&2
  echo "switch the Lambda to SMTP sending. See infra/README.md." >&2
  exit 1
fi

EXISTING="$(aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=service-name,Values=$SERVICE" \
  --query "VpcEndpoints[?State!='deleted'].VpcEndpointId | [0]" --output text)"
if [ "$EXISTING" != "None" ] && [ -n "$EXISTING" ]; then
  echo "Endpoint exists: $EXISTING"
  exit 0
fi

SUBNET_ID="$(vpc_subnet_ids | awk '{print $1}')"
aws ec2 create-vpc-endpoint \
  --vpc-id "$VPC_ID" \
  --vpc-endpoint-type Interface \
  --service-name "$SERVICE" \
  --subnet-ids "$SUBNET_ID" \
  --security-group-ids "$VPCE_SG" \
  --private-dns-enabled \
  --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=${APP}-ses},{Key=App,Value=${APP}}]" \
  --query "VpcEndpoint.VpcEndpointId" --output text
echo "Endpoint created (takes a minute or two to become available)."
