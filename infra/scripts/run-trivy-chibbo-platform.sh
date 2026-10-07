#!/usr/bin/env bash
# Produce an immutable Trivy source report for the currently published Chibbo
# platform image. The report contains package and operating-system metadata,
# never application data, and is read by GapZer0 only through its Chibbo role.
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${EVIDENCE_BUCKET:?EVIDENCE_BUCKET is required}"
: "${CHIBBO_ENVIRONMENT:?CHIBBO_ENVIRONMENT is required}"
: "${CHIBBO_PLATFORM_IMAGE_URI:?CHIBBO_PLATFORM_IMAGE_URI is required}"

# Trivy 0.75.0 multi-platform image index, resolved on 2026-10-03. Keep the
# digest immutable; a scanner-image upgrade must be an explicit code review.
readonly TRIVY_IMAGE="${TRIVY_IMAGE:-public.ecr.aws/aquasecurity/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa}"
readonly OUTPUT_ROOT="${TRIVY_OUTPUT_ROOT:-/var/lib/chibbo-trivy}"
readonly RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
readonly ARCHIVE_KEY="exports/trivy/chibbo/chibbo-platform-${RUN_ID}.json"
readonly LATEST_KEY="exports/trivy/chibbo/latest.json"
# CycloneDX SBOM of the same scan.  GapZer0 uploads it to Dependency-Track,
# so its inventory is exactly the packages of the image the service runs.
readonly SBOM_ARCHIVE_KEY="exports/trivy/chibbo/sbom-chibbo-platform-${RUN_ID}.cdx.json"
readonly SBOM_LATEST_KEY="exports/trivy/chibbo/sbom-latest.cdx.json"
readonly CONTAINER_NAME="chibbo-trivy-platform"

umask 077
install -d -m 700 "$OUTPUT_ROOT"
install -d -m 700 "$OUTPUT_ROOT/cache"
run_dir="$(mktemp -d "${OUTPUT_ROOT}/.scan.XXXXXX")"
chmod 0733 "$run_dir"
cleanup() {
  find "$run_dir" -mindepth 1 -depth -delete
  rmdir "$run_dir" 2>/dev/null || true
}
trap cleanup EXIT

# Resolve the digest from the active Chibbo ECS service rather than from a
# potentially un-deployed image pushed most recently to ECR.
service_arns_output="$(aws resourcegroupstaggingapi get-resources \
  --region "$AWS_REGION" \
  --resource-type-filters ecs:service \
  --tag-filters Key=Project,Values=virtual-chibbo Key=Owner,Values=ChibboCompany Key=Environment,Values="$CHIBBO_ENVIRONMENT" \
  --query 'ResourceTagMappingList[].ResourceARN' \
  --output text)"
read -r -a service_arns <<<"$service_arns_output"
test "${#service_arns[@]}" -eq 1
service_arn="${service_arns[0]}"
service_path="${service_arn##*:service/}"
cluster_name="${service_path%%/*}"
read -r task_definition running_count desired_count <<<"$(aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster "$cluster_name" \
  --services "$service_arn" \
  --query 'services[0].[taskDefinition,runningCount,desiredCount]' \
  --output text)"
test -n "$task_definition" && test "$task_definition" != "None"
test "$running_count" -gt 0 && test "$running_count" -eq "$desired_count"
images_output="$(aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$task_definition" \
  --query 'taskDefinition.containerDefinitions[].image' \
  --output text)"
read -r -a images <<<"$images_output"
matching_images=()
for image in "${images[@]}"; do
  [[ "$image" == "${CHIBBO_PLATFORM_IMAGE_URI}@sha256:"* ]] && matching_images+=("$image")
done
test "${#matching_images[@]}" -eq 1
image_ref="${matching_images[0]}"

for name in "$CONTAINER_NAME" "${CONTAINER_NAME}-sbom"; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    docker rm -f "$name" >/dev/null
  fi
done

# Trivy reads the private ECR image with the scanner's instance role through
# the AWS SDK. Only vulnerability scanning is enabled because AST-C-06 judges
# the image operating system's support status, not source-code secrets.
docker run --rm \
  --name "$CONTAINER_NAME" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --log-driver none \
  --mount "type=bind,src=${run_dir},dst=/output" \
  --mount "type=bind,src=${OUTPUT_ROOT}/cache,dst=/root/.cache" \
  -e AWS_REGION \
  -e AWS_DEFAULT_REGION="$AWS_REGION" \
  -e TRIVY_CACHE_DIR=/root/.cache \
  "$TRIVY_IMAGE" image \
    --scanners vuln \
    --list-all-pkgs \
    --format json \
    --output /output/report.json \
    "$image_ref"

scan_file="${run_dir}/report.json"
sbom_file="${run_dir}/sbom.cdx.json"
python3 - "$scan_file" "$image_ref" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
metadata = report.get("Metadata") if isinstance(report, dict) else None
operating_system = metadata.get("OS") if isinstance(metadata, dict) else None
if report.get("ArtifactName") != sys.argv[2]:
    raise SystemExit("Trivy report does not identify the running image digest")
if not isinstance(operating_system, dict) or not isinstance(operating_system.get("Family"), str) or not operating_system["Family"]:
    raise SystemExit("Trivy report does not contain operating-system metadata")
PY

# Derive the SBOM from that report instead of scanning again: same digest,
# same package list.  Conversion needs no network or registry access.  An
# SBOM failure never withholds the report AST-C-06 and TVM-C-01 judge; the
# run still exits non-zero after publishing it.
sbom_ok=1
docker run --rm \
  --name "${CONTAINER_NAME}-sbom" \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --log-driver none \
  --mount "type=bind,src=${run_dir},dst=/output" \
  "$TRIVY_IMAGE" convert \
    --format cyclonedx \
    --output /output/sbom.cdx.json \
    /output/report.json || sbom_ok=0
if [ "$sbom_ok" = 1 ] && ! python3 - "$scan_file" "$sbom_file" <<'PY'
import json
import sys

# GapZer0 must find every application package of the report in
# Dependency-Track: compare by purl, else by name (group joined, any case).
def key(name, version):
    return (str(name).casefold(), version)

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
with open(sys.argv[2], encoding="utf-8") as sbom_file:
    sbom = json.load(sbom_file)
subject = (sbom.get("metadata") or {}).get("component") or {}
if sbom.get("bomFormat") != "CycloneDX" or subject.get("name") != report["ArtifactName"]:
    raise SystemExit("CycloneDX SBOM does not describe the scanned image")
purls, names = set(), set()
for component in sbom.get("components") or []:
    if isinstance(component, dict):
        purls.add(component.get("purl"))
        name, group, version = component.get("name"), component.get("group"), component.get("version")
        names.add(key(name, version))
        if group:
            names |= {key(f"{group}/{name}", version), key(f"{group}:{name}", version)}
packages = [
    package for result in report.get("Results") or [] if isinstance(result, dict) and result.get("Class") == "lang-pkgs"
    for package in result.get("Packages") or [] if isinstance(package, dict)
]
missing = [
    package.get("Name") for package in packages
    if (package.get("Identifier") or {}).get("PURL") not in purls and key(package.get("Name"), package.get("Version")) not in names
]
if not packages or missing:
    raise SystemExit(f"CycloneDX SBOM is missing application packages: {missing[:5]}")
PY
then
  sbom_ok=0
fi

# The GapZer0 evidence bucket is versioned. Keep timestamped source objects
# for audit and update stable, versioned keys GapZer0 reads.  The SBOM goes
# first, so a new report is never published without its SBOM.
publish() {
  aws s3api put-object --region "$AWS_REGION" --bucket "$EVIDENCE_BUCKET" --key "$1" --body "$2" \
    --content-type "$3" --server-side-encryption AES256 --metadata "$4" --no-cli-pager >/dev/null
}
if [ "$sbom_ok" = 1 ]; then
  for object_key in "$SBOM_ARCHIVE_KEY" "$SBOM_LATEST_KEY"; do
    publish "$object_key" "$sbom_file" application/vnd.cyclonedx+json source=virtual-chibbo,scanner=trivy,format=cyclonedx
  done
fi
for object_key in "$ARCHIVE_KEY" "$LATEST_KEY"; do
  publish "$object_key" "$scan_file" application/json source=virtual-chibbo,scanner=trivy
done

printf 'Trivy source artifact archived: s3://%s/%s\n' "$EVIDENCE_BUCKET" "$ARCHIVE_KEY"
printf 'Trivy latest source artifact: s3://%s/%s\n' "$EVIDENCE_BUCKET" "$LATEST_KEY"
if [ "$sbom_ok" != 1 ]; then
  echo "CycloneDX SBOM was not produced or validated; the report was published without it" >&2
  exit 1
fi
printf 'CycloneDX SBOM latest artifact: s3://%s/%s\n' "$EVIDENCE_BUCKET" "$SBOM_LATEST_KEY"
