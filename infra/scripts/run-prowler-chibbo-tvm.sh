#!/usr/bin/env bash
# Produce a source-only TVM-C-01 EC2/RDS posture report on the dedicated scanner.
#
# Like the S3 runner, the scanner uses its own short-lived EC2 credentials via
# IMDSv2 and assumes ChibboProwlerReadOnlyRole.  For TVM-C-01 that role holds
# only ec2:DescribeInstances, ec2:DescribeImages and rds:DescribeDBInstances.
# The report is written next to the S3 report; GapZer0 selects the newest
# fresh artifact that actually contains a TVM-C-01 check.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${EVIDENCE_BUCKET:?EVIDENCE_BUCKET is required}"
: "${TARGET_ROLE_ARN:?TARGET_ROLE_ARN is required}"
: "${TARGET_ROLE_EXTERNAL_ID:?TARGET_ROLE_EXTERNAL_ID is required}"

readonly PROWLER_IMAGE="${PROWLER_IMAGE:-prowlercloud/prowler:5.44.0}"
readonly OUTPUT_ROOT="${PROWLER_OUTPUT_ROOT:-/var/lib/chibbo-prowler}"
readonly RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
readonly OUTPUT_NAME="chibbo-tvm-c-01-${RUN_ID}"
readonly ARCHIVE_KEY="exports/prowler/chibbo/${OUTPUT_NAME}.ocsf.json"
readonly CONTAINER_NAME="chibbo-prowler-tvm"

umask 077
install -d -m 700 "$OUTPUT_ROOT"
run_dir="$(mktemp -d "${OUTPUT_ROOT}/.tvm.XXXXXX")"
# Prowler's upstream image runs unprivileged.  The per-run directory may be
# traversed and written by that container, but cannot be listed by other users.
chmod 0733 "$run_dir"
cleanup() {
  find "$run_dir" -mindepth 1 -depth -delete
  rmdir "$run_dir" 2>/dev/null || true
}
trap cleanup EXIT

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# Prowler 5.44 check IDs (no "aws_" prefix).  The checks need no resource ARN
# filter: the target role can only describe EC2 instances, AMIs and RDS
# instances.  Do not repeat --check: Prowler v5 retains only the final flag.
docker run --rm \
  --name "$CONTAINER_NAME" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --log-driver none \
  --mount "type=bind,src=${run_dir},dst=/output" \
  "$PROWLER_IMAGE" aws \
    --region "$AWS_REGION" \
    --role "$TARGET_ROLE_ARN" \
    --role-session-name "chibbo-prowler-tvm" \
    --session-duration 3600 \
    --external-id "$TARGET_ROLE_EXTERNAL_ID" \
    --check \
      ec2_instance_older_than_specific_days \
      ec2_instance_with_outdated_ami \
      rds_instance_no_public_access \
    --output-formats json-ocsf \
    --output-filename "$OUTPUT_NAME" \
    --output-directory /output \
    --no-banner \
    --no-color \
    --ignore-exit-code-3

scan_file="$(find "$run_dir" -maxdepth 1 -type f -name '*.ocsf.json' -size +0c -print -quit)"
test -n "$scan_file"
python3 -m json.tool "$scan_file" >/dev/null

aws s3api put-object \
  --region "$AWS_REGION" \
  --bucket "$EVIDENCE_BUCKET" \
  --key "$ARCHIVE_KEY" \
  --body "$scan_file" \
  --content-type application/json \
  --server-side-encryption AES256 \
  --metadata "source=prowler,control=TVM-C-01" \
  --no-cli-pager >/dev/null

printf 'Prowler TVM source artifact archived: s3://%s/%s\n' "$EVIDENCE_BUCKET" "$ARCHIVE_KEY"
