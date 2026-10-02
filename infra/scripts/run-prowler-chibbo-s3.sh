#!/usr/bin/env bash
# Produce a source-only Chibbo S3 posture report on the dedicated scanner.
#
# The scanner receives its own short-lived EC2 credentials through IMDSv2 and
# assumes the narrowly scoped ChibboProwlerReadOnlyRole.  It does not read any
# GapZer0 connector secret, application secret, or long-lived access key.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${EVIDENCE_BUCKET:?EVIDENCE_BUCKET is required}"
: "${TARGET_ROLE_ARN:?TARGET_ROLE_ARN is required}"
: "${TARGET_ROLE_EXTERNAL_ID:?TARGET_ROLE_EXTERNAL_ID is required}"
: "${CHIBBO_PROWLER_RESOURCE_ARNS:?CHIBBO_PROWLER_RESOURCE_ARNS is required}"

readonly PROWLER_IMAGE="${PROWLER_IMAGE:-prowlercloud/prowler:5.44.0}"
readonly OUTPUT_ROOT="${PROWLER_OUTPUT_ROOT:-/var/lib/chibbo-prowler}"
readonly RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
readonly OUTPUT_NAME="chibbo-s3-inf-c-01-${RUN_ID}"
readonly ARCHIVE_KEY="exports/prowler/chibbo/${OUTPUT_NAME}.ocsf.json"
readonly CONTAINER_NAME="chibbo-prowler-s3"

umask 077
install -d -m 700 "$OUTPUT_ROOT"
run_dir="$(mktemp -d "${OUTPUT_ROOT}/.scan.XXXXXX")"
# Prowler's upstream image runs unprivileged.  The per-run directory may be
# traversed and written by that container, but cannot be listed by other users.
chmod 0733 "$run_dir"
cleanup() {
  find "$run_dir" -mindepth 1 -depth -delete
  rmdir "$run_dir" 2>/dev/null || true
}
trap cleanup EXIT

read -r -a resource_arns <<<"$CHIBBO_PROWLER_RESOURCE_ARNS"
test "${#resource_arns[@]}" -eq 2

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# IMDSv2 hop limit two is set on the Scanner instance. Prowler obtains the
# scanner role from IMDS and assumes the S3-only target role itself.  Do not
# repeat --check: Prowler v5 retains only the final repeated flag.
docker run --rm \
  --name "$CONTAINER_NAME" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --log-driver none \
  --mount "type=bind,src=${run_dir},dst=/output" \
  "$PROWLER_IMAGE" aws \
    --region "$AWS_REGION" \
    --role "$TARGET_ROLE_ARN" \
    --role-session-name "chibbo-prowler-s3" \
    --session-duration 3600 \
    --external-id "$TARGET_ROLE_EXTERNAL_ID" \
    --check \
      s3_bucket_level_public_access_block \
      s3_bucket_default_encryption \
      s3_bucket_secure_transport_policy \
    --resource-arn "${resource_arns[@]}" \
    --output-formats json-ocsf \
    --output-filename "$OUTPUT_NAME" \
    --output-directory /output \
    --no-banner \
    --no-color \
    --ignore-exit-code-3

scan_file="$(find "$run_dir" -maxdepth 1 -type f -name '*.ocsf.json' -size +0c -print -quit)"
test -n "$scan_file"
python3 -m json.tool "$scan_file" >/dev/null

# The evidence bucket is private, versioned and default-encrypted.  Explicit
# SSE-S3 on the request also protects against an accidental bucket-default
# configuration change.  The object is a source artifact only; GapZer0 still
# requires an authorized Evidence Version import before it affects a control.
aws s3api put-object \
  --region "$AWS_REGION" \
  --bucket "$EVIDENCE_BUCKET" \
  --key "$ARCHIVE_KEY" \
  --body "$scan_file" \
  --content-type application/json \
  --server-side-encryption AES256 \
  --no-cli-pager >/dev/null

printf 'Prowler source artifact archived: s3://%s/%s\n' "$EVIDENCE_BUCKET" "$ARCHIVE_KEY"
