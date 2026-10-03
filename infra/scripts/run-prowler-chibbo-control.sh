#!/usr/bin/env bash
# Produce one source-only GapZer0 control report on the dedicated scanner.
#
# One runner serves every control whose checks need no resource filter
# (TVM-C-01 EC2/RDS inventory, INF-E-01 ELBv2/CloudFront TLS).  The systemd
# unit supplies the control and its Prowler check IDs; the target role only
# grants the Describe/List calls those checks need.  Like the S3 runner, the
# scanner uses its own short-lived EC2 credentials via IMDSv2 and assumes
# ChibboProwlerReadOnlyRole.  Reports share one prefix; GapZer0 selects the
# newest fresh artifact that actually contains the control's checks.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${EVIDENCE_BUCKET:?EVIDENCE_BUCKET is required}"
: "${TARGET_ROLE_ARN:?TARGET_ROLE_ARN is required}"
: "${TARGET_ROLE_EXTERNAL_ID:?TARGET_ROLE_EXTERNAL_ID is required}"
: "${CHIBBO_PROWLER_CONTROL:?CHIBBO_PROWLER_CONTROL is required, for example tvm-c-01}"
: "${CHIBBO_PROWLER_CHECKS:?CHIBBO_PROWLER_CHECKS is required}"

[[ "$CHIBBO_PROWLER_CONTROL" =~ ^[a-z]+(-[a-z0-9]+)+$ ]]
read -r -a checks <<<"$CHIBBO_PROWLER_CHECKS"
test "${#checks[@]}" -gt 0
for check in "${checks[@]}"; do
  [[ "$check" =~ ^[a-z0-9_]+$ ]]
done

readonly PROWLER_IMAGE="${PROWLER_IMAGE:-prowlercloud/prowler:5.44.0}"
readonly OUTPUT_ROOT="${PROWLER_OUTPUT_ROOT:-/var/lib/chibbo-prowler}"
readonly RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
readonly OUTPUT_NAME="chibbo-${CHIBBO_PROWLER_CONTROL}-${RUN_ID}"
readonly ARCHIVE_KEY="exports/prowler/chibbo/${OUTPUT_NAME}.ocsf.json"
readonly CONTAINER_NAME="chibbo-prowler-${CHIBBO_PROWLER_CONTROL}"

umask 077
install -d -m 700 "$OUTPUT_ROOT"
run_dir="$(mktemp -d "${OUTPUT_ROOT}/.${CHIBBO_PROWLER_CONTROL}.XXXXXX")"
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

# Prowler 5.44 check IDs (no "aws_" prefix).  Do not repeat --check:
# Prowler v5 retains only the final flag, so all IDs follow one --check.
docker run --rm \
  --name "$CONTAINER_NAME" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --log-driver none \
  --mount "type=bind,src=${run_dir},dst=/output" \
  "$PROWLER_IMAGE" aws \
    --region "$AWS_REGION" \
    --role "$TARGET_ROLE_ARN" \
    --role-session-name "$CONTAINER_NAME" \
    --session-duration 3600 \
    --external-id "$TARGET_ROLE_EXTERNAL_ID" \
    --check "${checks[@]}" \
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
  --metadata "source=prowler,control=${CHIBBO_PROWLER_CONTROL^^}" \
  --no-cli-pager >/dev/null

printf 'Prowler %s source artifact archived: s3://%s/%s\n' "${CHIBBO_PROWLER_CONTROL^^}" "$EVIDENCE_BUCKET" "$ARCHIVE_KEY"
