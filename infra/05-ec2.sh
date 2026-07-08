#!/usr/bin/env bash
# Launches the API instance: t4g.micro (arm64) Amazon Linux 2023, instance
# profile from 03, API security group, user-data that installs Docker, and a
# static Elastic IP. Re-running skips anything already created.
set -euo pipefail
source "$(dirname "$0")/env.sh"
require_duckdns_host

API_SG="$(sg_id "$SG_API")"
[ "$API_SG" != "None" ] || { echo "Run 01-security-groups.sh first." >&2; exit 1; }

# ---------- key pair (private key saved locally, gitignored) ----------
PEM="$(dirname "$0")/${KEY_PAIR}.pem"
if aws ec2 describe-key-pairs --key-names "$KEY_PAIR" >/dev/null 2>&1; then
  echo "Key pair exists: $KEY_PAIR (private key should be at $PEM)"
else
  aws ec2 create-key-pair --key-name "$KEY_PAIR" \
    --query "KeyMaterial" --output text >"$PEM"
  chmod 600 "$PEM"
  echo "Key pair created, private key: $PEM — BACK THIS UP, it is shown only once."
fi

# ---------- instance ----------
EXISTING="$(aws ec2 describe-instances \
  --filters "Name=tag:App,Values=$APP" "Name=instance-state-name,Values=pending,running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)"

if [ "$EXISTING" != "None" ] && [ -n "$EXISTING" ]; then
  INSTANCE_ID="$EXISTING"
  echo "Instance exists: $INSTANCE_ID"
  echo "NOTE: /opt/app/deploy.env is written by user-data at launch only. If"
  echo "DUCKDNS_HOST, ECR settings, or SSM_PATH changed, update it on the"
  echo "instance by hand (or terminate and re-run this script)."
else
  AMI_ID="$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query "Parameter.Value" --output text)"
  SUBNET_ID="$(vpc_subnet_ids | awk '{print $1}')"
  echo "AMI: $AMI_ID  Subnet: $SUBNET_ID"

  USERDATA="$(mktemp)"
  cat >"$USERDATA" <<EOF
#!/bin/bash
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user

# docker compose v2 plugin (arm64)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/app
cat >/opt/app/deploy.env <<DEPLOYENV
AWS_REGION=${AWS_REGION}
ECR_REGISTRY=${ECR_REGISTRY}
ECR_IMAGE=${ECR_REGISTRY}/${ECR_REPO}:latest
DUCKDNS_HOST=${DUCKDNS_HOST}
SSM_PATH=${SSM_PATH}
DEPLOYENV
EOF

  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type t4g.micro \
    --key-name "$KEY_PAIR" \
    --security-group-ids "$API_SG" \
    --subnet-id "$SUBNET_ID" \
    --iam-instance-profile "Name=$EC2_ROLE" \
    --user-data "file://$USERDATA" \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP}-api},{Key=App,Value=${APP}}]" \
    --query "Instances[0].InstanceId" --output text)"
  rm -f "$USERDATA"
  echo "Launched: $INSTANCE_ID — waiting for running state..."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi

# ---------- Elastic IP ----------
ALLOC_ID="$(eip_allocation_id)"
if [ "$ALLOC_ID" = "None" ] || [ -z "$ALLOC_ID" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${APP}-eip},{Key=App,Value=${APP}}]" \
    --query "AllocationId" --output text)"
  echo "Allocated EIP: $ALLOC_ID"
fi
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null

EIP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" \
  --query "Addresses[0].PublicIp" --output text)"

echo
echo "Instance: $INSTANCE_ID"
echo "Elastic IP: $EIP"
echo "Next: point DuckDNS at it (06-duckdns.sh), then set the GitHub repo"
echo "variables INSTANCE_ID=$INSTANCE_ID, ECR_REGISTRY=$ECR_REGISTRY, DUCKDNS_HOST=$DUCKDNS_HOST"
