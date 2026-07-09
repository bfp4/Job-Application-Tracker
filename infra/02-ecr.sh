#!/usr/bin/env bash
# Creates the ECR repository for the API image with scan-on-push and a
# lifecycle policy that keeps only the 10 most recent images.
set -euo pipefail
source "$(dirname "$0")/env.sh"

if aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  echo "Exists: $ECR_REGISTRY/$ECR_REPO"
else
  aws ecr create-repository --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --query "repository.repositoryUri" --output text
fi

aws ecr put-lifecycle-policy --repository-name "$ECR_REPO" --lifecycle-policy-text '{
  "rules": [{
    "rulePriority": 1,
    "description": "Keep only the 10 most recent images",
    "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10},
    "action": {"type": "expire"}
  }]
}' >/dev/null
echo "Lifecycle policy set (keep last 10)."
