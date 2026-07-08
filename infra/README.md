# Infrastructure provisioning

Bash scripts that stand up the AWS production environment: the API on EC2
(Docker + Caddy TLS behind a DuckDNS hostname) and the daily reminder Lambda
(EventBridge Scheduler → Lambda in the VPC → SES). Everything lands in the
VPC that already hosts RDS. Scripts are idempotent — re-running skips or
updates what already exists.

## Prerequisites

- AWS CLI v2, configured with credentials that can manage EC2/ECR/IAM/SSM/SES/Lambda/Scheduler (`aws sts get-caller-identity` works)
- Node 22+ (the Lambda build)
- A [DuckDNS](https://www.duckdns.org) account: pick a subdomain, note the token
- `infra/prod.env` filled in (copy `prod.env.example`) — gitignored

Run everything from Git Bash at the repo root. The scripts set
`MSYS_NO_PATHCONV=1` themselves so Git Bash does not mangle `/jobtracker/...`
parameter names into Windows paths.

## Configuration

Defaults live in `env.sh` (region `us-east-2`, RDS instance `job-tracker`,
bucket `job-tracker-files-ari`). Export overrides before running, and always
set your host:

```bash
export DUCKDNS_HOST=<yours>.duckdns.org
export MY_IP=$(curl -s https://checkip.amazonaws.com)   # restricts SSH to you
```

## Run order

| # | Script | What | Before running |
|---|--------|------|----------------|
| 1 | `01-security-groups.sh` | 4 SGs (api / lambda / vpce / rds) | — |
| 2 | `02-ecr.sh` | ECR repo, keep-last-10 | — |
| 3 | `03-iam.sh` | EC2 role, GitHub OIDC deploy role, Lambda role | — |
| 4 | `04-ssm-params.sh` | prod secrets → SSM SecureStrings | fill `infra/prod.env` |
| 5 | `05-ec2.sh` | t4g.micro + Elastic IP + Docker user-data | `DUCKDNS_HOST` set |
| 6 | `06-duckdns.sh` | point DuckDNS at the EIP | `DUCKDNS_TOKEN` set |
| — | *first deploy* | push to main → GitHub Actions deploys | set repo variables (below) |
| 7 | `07-ses.sh` | verify the sender/recipient email | click the link AWS emails |
| 8 | `08-vpce-ses.sh` | SES VPC interface endpoint (~$7/mo) | — |
| 9 | `09-lambda.sh` | build + deploy the reminder Lambda | 4, 7, 8 done |
| 10 | `10-scheduler.sh` | daily 14:00 UTC schedule | 9 done |
| 11 | `11-rds-lockdown.sh --confirm` | RDS off the internet | **everything verified + tunnel tested** |

After step 6, set GitHub repository **variables** (Settings → Secrets and
variables → Actions → Variables): `INSTANCE_ID`, `ECR_REGISTRY`,
`DUCKDNS_HOST`, `DEPLOY_ROLE_ARN` (printed by `03-iam.sh`/`05-ec2.sh`).
None are secret.

## Verification per phase

- **After 4**: `aws ssm get-parameter --name /jobtracker/prod/FIREBASE_PRIVATE_KEY --with-decryption --query Parameter.Value --output text` matches `prod.env` exactly.
- **After 6**: `nslookup $DUCKDNS_HOST` returns the Elastic IP.
- **After first deploy**: `curl https://$DUCKDNS_HOST/health` → `{"status":"ok"}` with a valid certificate; `/opt/app/.env` on the box has no `AWS_ACCESS_KEY_ID`; a resume upload works (instance role → S3).
- **After 10**: seed a follow-up due today, `aws lambda invoke --function-name jobtracker-reminders out.json` → digest email arrives; invoke again → follow-up not re-sent (`reminderSentAt` set), not-applied applications still listed (by design).
- **After 11**: direct `psql` to the RDS endpoint from your laptop times out; the tunnel works; deployed API + Lambda still work.

## SES notes

SES starts in **sandbox** mode: mail is only delivered to verified
identities. The single production user today is also the verified sender, so
this works. To email arbitrary users later, request production access in the
SES console.

If `08-vpce-ses.sh` reports the SES API endpoint is unavailable in the
region, create `com.amazonaws.<region>.email-smtp` instead and switch the
Lambda to SMTP (nodemailer) — the endpoint's private DNS covers the SMTP
hostname the same way.
