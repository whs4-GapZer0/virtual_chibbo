"""Read-only AWS calls through the AWS CLI already on the GitHub runner.

The CLI paginates and retries throttled calls itself, so the exporter needs
no third-party package.  Credentials come from the job's OIDC role.
"""

from __future__ import annotations

from datetime import datetime
import json
import subprocess
from typing import Any

ACTIVE_STACK_STATUSES = (
    "CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "IMPORT_COMPLETE",
    "IMPORT_ROLLBACK_COMPLETE", "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
    "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
    "UPDATE_ROLLBACK_FAILED", "ROLLBACK_COMPLETE",
)


class AwsError(RuntimeError):
    """An AWS read failed; the export must not claim complete coverage."""


def _cli(*args: str, region: str) -> Any:
    command = ["aws", *args, "--region", region, "--output", "json", "--no-cli-pager"]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=1800)
    except (OSError, subprocess.SubprocessError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        raise AwsError(f"aws {' '.join(args[:2])} 실패: {detail.strip()[:300]}") from error
    try:
        return json.loads(result.stdout or "{}")
    except ValueError as error:
        raise AwsError(f"aws {' '.join(args[:2])} 응답 형식 오류") from error


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def write_events(region: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """Every non-read-only management event in ``region`` between start and end."""

    payload = _cli("cloudtrail", "lookup-events", "--start-time", _iso(start), "--end-time", _iso(end),
                   "--lookup-attributes", "AttributeKey=ReadOnly,AttributeValue=false", region=region)
    events = []
    for item in payload.get("Events", []):
        try:
            event = json.loads(item["CloudTrailEvent"])
        except (KeyError, TypeError, ValueError) as error:
            raise AwsError("CloudTrail 이벤트 형식 오류") from error
        event["_region"] = region
        events.append(event)
    return events


def stack_resources(region: str, prefix: str) -> list[dict[str, str]]:
    """Physical resources of every active CloudFormation stack named ``prefix*``."""

    stacks = _cli("cloudformation", "list-stacks", "--stack-status-filter", *ACTIVE_STACK_STATUSES, region=region)
    resources = []
    for stack in stacks.get("StackSummaries", []):
        name = stack.get("StackName", "")
        if not name.startswith(prefix):
            continue
        listed = _cli("cloudformation", "list-stack-resources", "--stack-name", name, region=region)
        for item in listed.get("StackResourceSummaries", []):
            if item.get("PhysicalResourceId"):
                resources.append({"stack": name, "logical_id": item.get("LogicalResourceId", ""),
                                  "physical_id": item["PhysicalResourceId"], "type": item.get("ResourceType", "")})
    return resources


def task_definition_images(region: str, reference: str) -> list[str]:
    payload = _cli("ecs", "describe-task-definition", "--task-definition", reference, region=region)
    definitions = (payload.get("taskDefinition") or {}).get("containerDefinitions") or []
    return [item.get("image", "") for item in definitions if item.get("image")]


def upload(region: str, bucket: str, key: str, path: str) -> None:
    _cli("s3api", "put-object", "--bucket", bucket, "--key", key, "--body", path,
         "--content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", region=region)
