"""Daily export of Chibbo's real change, intake and analysis records for GRC TVM.

GapZer0 GRC judges TVM-C-06, TVM-E-03 and TVM-E-04 for the recruitment
platform from this workbook (contract ``gapzero.tvm/v1``: one tab per role,
English headers, an ``instance_id`` column, a ``coverage`` row per collected
role).  The job writes ``exports/tvm/chibbo/chibbo-tvm-<UTC>.xlsx`` to the
GRC evidence bucket with Chibbo's own OIDC role; GRC only reads it.

Sources (see governance/README.md):

* changes      merged pull requests (template + approving review by a listed
               approver other than the author) and approved ``change`` issues
* executions   per pull request, the first deployment run whose commit
               contains it and that CloudTrail shows changed the declared
               asset; repository-only (A-08) pull requests execute at merge;
               write events on Chibbo resources by anyone but the pipeline
               and declared workloads
* exceptions   ``risk-acceptance`` issues approved by a listed approver
* deployments  ECS RunTask/CreateService/UpdateService of the platform image
               (the migration task is the image's first use in a release)
* intakes      one per deployed image digest; verifications from main-branch
               deploy runs' ``tvm-e-03-verification`` artifact
* registers    governance/ suppliers, assets, CTI, priority rules, tuning

E-04 events are not collected yet (no SIEM covers Chibbo), so the export
claims no events coverage and GRC stays inconclusive for that control.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from fnmatch import fnmatchcase
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

from chibbo_evidence import forms
from chibbo_evidence.registers import Registers, load as load_registers

KST = timezone(timedelta(hours=9))
SCHEMA = "gapzero.tvm/v1"
HEADERS = {
    "changes": "change_id asset_id risk_ref assessed_at approver approved_at executed_at result_ref",
    "executions": "execution_id change_id asset_id executed_at source_ref",
    "exceptions": "exception_id asset_id risk_ref approver approved_at expires_at compensating_control review_at status closure_ref",
    "intakes": "intake_id kind asset_id supplier_id artifact_id inspected_at first_used_at inspection_ref",
    "suppliers": "supplier_id status source_ref",
    "verifications": "intake_id artifact_id verified_at method expected_sha256 actual_sha256 trusted_source_ref report_ref result sbom_ref",
    "hardware": "intake_id asset_id serial expected_serial manufacturer_ref seal_result inspected_at inspection_ref",
    "deployments": "deployment_id intake_id artifact_id deployed_at source_ref",
    "events": "event_id asset_id cti_id rule_id analyzed_at priority response_level analysis_ref response_ref outcome",
    "cti": "cti_id source_ref approved_by valid_from expires_at indicator_ref threat_level",
    "assets": "asset_id criticality business_impact vulnerability_level vulnerability_ref context_ref",
    "rules": "rule_id criticality business_impact vulnerability_level threat_level priority response_level version rule_ref approved_by approved_at",
    "tuning": "event_id rule_id reviewed_at disposition rule_version evidence_ref",
    "coverage": "source period_start period_end collected_at status source_ref",
}
DATA_TABS = [tab for tab in HEADERS if tab != "coverage"]
# Every role but events: no SIEM covers Chibbo yet, so its completeness is not claimed.
COLLECTED = [tab for tab in DATA_TABS if tab != "events"]
WINDOW = timedelta(days=90)
# CloudTrail event history usually lags by a few minutes; do not claim the last 15.
TRAIL_LAG = timedelta(minutes=15)
# LookupEvents already returns only ReadOnly=false events.  These are writes
# that change nothing about the system: sessions, credentials, log delivery
# and agent heartbeats.
NOT_A_CHANGE = {
    "AssumeRole", "AssumeRoleWithSAML", "AssumeRoleWithWebIdentity", "GetFederationToken", "GetSessionToken",
    "ConsoleLogin", "SwitchRole", "GetSigninToken", "CheckMfa", "CredentialChallenge", "CredentialVerification",
    "CreateToken", "CreateSession", "StartSession", "ResumeSession", "TerminateSession", "StartLiveTail",
    "StartQuery", "StopQuery", "CreateLogStream", "PutLogEvents", "UpdateInstanceInformation",
    "PutComplianceItems", "PutInventory",
}
# Pipeline mechanics: the resource changes a change set makes are logged
# separately under the CloudFormation execution role.
PIPELINE_MECHANICS = {"cloudformation.amazonaws.com"}
IMAGE_USE_EVENTS = {"RunTask", "CreateService", "UpdateService"}
REPOSITORY_ASSET = "A-08"
VERIFICATION_ARTIFACT = "tvm-e-03-verification"
VERIFICATION_SCHEMA = "chibbo.image-verification/v1"
IN_HOUSE_SUPPLIER = "SUP-CHIBBO-CI"
DEPLOY_WORKFLOW = ".github/workflows/deploy.yml"


def kst(value: datetime | None) -> str:
    return value.astimezone(KST).isoformat(timespec="seconds") if value else ""


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (parsed.replace(tzinfo=KST) if parsed.tzinfo is None else parsed).astimezone(UTC)


def parse_kst_minute(value: str) -> datetime | None:
    match = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})\s*", value or "")
    return datetime.fromisoformat(f"{match.group(1)}T{match.group(2)}:00+09:00").astimezone(UTC) if match else None


def end_of_kst_day(value: str) -> datetime | None:
    match = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})\s*", value or "")
    return datetime.fromisoformat(f"{match.group(1)}T23:59:59+09:00").astimezone(UTC) if match else None


def one_line(text: str, limit: int = 300) -> str:
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


@dataclass
class Raw:
    """Everything fetched for one export; ``build`` is a pure function of it."""

    repository: str
    environment: str
    platform_repository: str
    pulls: list[dict[str, Any]] = field(default_factory=list)
    runs: list[dict[str, Any]] = field(default_factory=list)
    # head commit of a run -> every commit reachable from it since the window start
    run_ancestors: dict[str, set[str]] = field(default_factory=dict)
    change_issues: list[dict[str, Any]] = field(default_factory=list)
    risk_issues: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    stack_resources: list[dict[str, str]] = field(default_factory=list)
    task_images: dict[str, list[str]] = field(default_factory=dict)
    verifications: list[dict[str, Any]] = field(default_factory=list)

    @property
    def pipeline_roles(self) -> set[str]:
        return {f"chibbo-{self.environment}-github-deploy", f"chibbo-{self.environment}-cloudformation-execution"}

    def workload_roles(self, registers: Registers) -> tuple[set[str], tuple[str, ...]]:
        """Roles whose calls are workloads, not changes: every IAM role the Chibbo
        stacks define except the pipeline's, plus the register's patterns."""

        roles = {item["physical_id"] for item in self.stack_resources if item["type"] == "AWS::IAM::Role"}
        return roles - self.pipeline_roles, registers.workload_roles


# -- CloudTrail -------------------------------------------------------------

@dataclass(frozen=True)
class Change:
    event: dict[str, Any]
    at: datetime
    principal: str
    kind: str  # pipeline | human
    asset_id: str


def category(event: dict[str, Any], pipeline_roles: set[str], workload_roles: set[str], patterns: tuple[str, ...]) -> str | None:
    """pipeline, human, or None for calls that changed nothing or are workloads.

    Anything not proven to be the pipeline or a declared workload counts as a
    person, so an unexpected identity type is reported rather than dropped.
    """

    if event.get("errorCode") or event.get("readOnly") is True or event.get("eventName") in NOT_A_CHANGE:
        return None
    identity = event.get("userIdentity") or {}
    kind = identity.get("type", "")
    context = identity.get("sessionContext") or {}
    issuer = (context.get("sessionIssuer") or {}).get("userName", "")
    if kind == "AssumedRole" and issuer in pipeline_roles:
        return "pipeline"
    if kind == "AWSService" or identity.get("invokedBy") or context.get("ec2RoleDelivery"):
        return None  # a service acting on its own behalf, or an instance profile
    if kind == "AssumedRole" and (issuer in workload_roles or any(fnmatchcase(issuer, pattern) for pattern in patterns)):
        return None
    return "human"


def _principal(event: dict[str, Any]) -> str:
    identity = event.get("userIdentity") or {}
    issuer = ((identity.get("sessionContext") or {}).get("sessionIssuer") or {}).get("userName", "")
    return identity.get("arn") or issuer or identity.get("type", "")


def classify(raw: Raw, registers: Registers) -> list[Change]:
    resources = sorted((item for item in raw.stack_resources if len(item["physical_id"]) >= 6),
                       key=lambda item: -len(item["physical_id"]))
    stacks = {item["stack"] for item in raw.stack_resources}
    workloads, patterns = raw.workload_roles(registers)
    changes = []
    for event in raw.events:
        kind = category(event, raw.pipeline_roles, workloads, patterns)
        at = parse_time(event.get("eventTime"))
        if kind is None or at is None:
            continue
        text = json.dumps({key: event.get(key) for key in ("requestParameters", "responseElements", "resources")},
                          ensure_ascii=False, default=str)
        owned = next((item for item in resources if item["physical_id"] in text), None)
        if kind == "human" and owned is None and not any(stack in text for stack in stacks):
            continue  # another workload in the shared account
        asset = (registers.asset_for_resource(owned["logical_id"], owned["type"]) if owned else None) \
            or registers.asset_for_event_source(event.get("eventSource", ""))
        changes.append(Change(event, at, _principal(event), kind, asset))
    return sorted(changes, key=lambda item: item.at)


def _task_definition(event: dict[str, Any]) -> str:
    """The exact task-definition ARN an ECS call ran or deployed, if any.

    The response carries the resolved revision; a family-only request would
    otherwise resolve to whatever revision is current at export time.  An
    UpdateService that does not name a task definition deploys no new image.
    """

    request = event.get("requestParameters") or {}
    response = event.get("responseElements") or {}
    if event.get("eventName") == "UpdateService" and not request.get("taskDefinition"):
        return ""
    tasks = response.get("tasks") if isinstance(response.get("tasks"), list) else []
    resolved = (response.get("service") or {}).get("taskDefinition") if isinstance(response.get("service"), dict) else None
    resolved = resolved or next((task.get("taskDefinitionArn") for task in tasks if isinstance(task, dict)), None)
    return resolved or request.get("taskDefinition") or ""


def is_chibbo_task_definition(reference: str) -> bool:
    family = reference.rsplit("task-definition/", 1)[-1]
    return family.startswith("Chibbo")


# -- builders ----------------------------------------------------------------

def _approved_review(pull: dict[str, Any], approvers: frozenset[str]) -> dict[str, Any] | None:
    """The latest approval of the merged commit by a listed approver other than the author."""

    author = ((pull.get("user") or {}).get("login") or "").lower()
    merged = parse_time(pull.get("merged_at"))
    head = (pull.get("head") or {}).get("sha")
    found = None
    for review in pull.get("reviews") or []:
        login = ((review.get("user") or {}).get("login") or "").lower()
        at = parse_time(review.get("submitted_at"))
        if (review.get("state") == "APPROVED" and login in approvers and login != author
                and at and merged and at <= merged and review.get("commit_id") == head):
            if found is None or at > found["_at"]:
                found = {**review, "_at": at, "_login": login}
    return found


def _approval_label(issue: dict[str, Any], label: str, approvers: frozenset[str]) -> tuple[str, datetime] | None:
    """The first time a listed approver (not the author) applied ``label``, if it is still applied."""

    author = ((issue.get("user") or {}).get("login") or "").lower()
    if label not in {item.get("name") for item in issue.get("labels") or []}:
        return None
    for event in sorted(issue.get("label_events") or [], key=lambda item: item.get("created_at", "")):
        actor = (event.get("actor") or "").lower()
        if event.get("event") == "labeled" and event.get("label") == label and actor in approvers and actor != author:
            at = parse_time(event.get("created_at"))
            if at:
                return actor, at
    return None


def _declared(pull: dict[str, Any]) -> str:
    return forms.asset_id(forms.sections(pull.get("body")).get("대상 자산"))


def build(raw: Raw, registers: Registers, *, instance_id: str, now: datetime, run_url: str,
          start: datetime | None = None) -> dict[str, list[dict[str, str]]]:
    start = start or now - WINDOW
    tables: dict[str, list[dict[str, str]]] = {tab: [] for tab in HEADERS}
    changes = classify(raw, registers)
    pulls = sorted((pull for pull in raw.pulls if (parse_time(pull.get("merged_at")) or start) >= start),
                   key=lambda item: item["number"])

    # Pipeline executions.  A deploy run ships every pull request merged
    # since the last run that executed it, so each pull request is executed by
    # the first run whose commit contains it and whose CloudTrail writes touched
    # its declared asset.  A re-run that executes no new pull request re-applies
    # changes already executed; it is noted on those rows.
    executed: dict[str, tuple[datetime, str]] = {}
    rows_by_run: dict[str, list[dict[str, str]]] = {}
    claimed: set[int] = set()
    for pull in pulls:
        if _declared(pull) == REPOSITORY_ASSET:
            # A repository-only change takes effect when it is merged.
            at = parse_time(pull.get("merged_at"))
            executed[f"PR-{pull['number']}"] = (at, pull.get("html_url", ""))
            tables["executions"].append({"execution_id": f"MERGE-PR{pull['number']}", "change_id": f"PR-{pull['number']}",
                                         "asset_id": REPOSITORY_ASSET, "executed_at": kst(at), "source_ref": pull.get("html_url", "")})
    for run in sorted(raw.runs, key=lambda item: item.get("run_started_at") or ""):
        begin, finish = parse_time(run.get("run_started_at")), parse_time(run.get("updated_at"))
        if begin is None or finish is None:
            continue
        mine = [change for change in changes
                if change.kind == "pipeline" and begin <= change.at <= finish + timedelta(minutes=2)]
        claimed.update(id(change) for change in mine)
        effective = [change for change in mine if change.event.get("eventSource") not in PIPELINE_MECHANICS]
        if not effective:
            continue  # nothing beyond change-set bookkeeping: the run changed no resource
        touched = Counter(change.asset_id for change in effective)
        fallback = registers.deploy_workflows.get(run.get("path", ""), "")
        fallback = fallback if fallback in touched else sorted(touched, key=lambda key: (-touched[key], key))[0]
        ancestors = raw.run_ancestors.get(run.get("head_sha", ""), set())
        at = effective[0].at
        url = run.get("html_url", "")
        shipped = [pull for pull in pulls if pull.get("merge_commit_sha") in ancestors
                   and f"PR-{pull['number']}" not in executed and (not _declared(pull) or _declared(pull) in touched)]
        if not shipped:
            for row in rows_by_run.get(run.get("head_sha", ""), []):
                row["source_ref"] = one_line(f"{row['source_ref']} · 재실행 {url} {kst(at)}", 600)
            continue
        for pull in shipped:
            change_id = f"PR-{pull['number']}"
            executed[change_id] = (at, url)
            row = {"execution_id": f"RUN-{run['id']}-PR{pull['number']}", "change_id": change_id,
                   "asset_id": _declared(pull) or fallback, "executed_at": kst(at), "source_ref": url}
            tables["executions"].append(row)
            rows_by_run.setdefault(run.get("head_sha", ""), []).append(row)

    # Out-of-band executions.  Writes inside an approved change issue's window
    # on its asset are that change's single execution; any other writes are
    # grouped per principal, asset and KST day.
    issues = []
    for issue in raw.change_issues:
        fields = forms.sections(issue.get("body"))
        approval = _approval_label(issue, "change-approved", registers.approvers["change"])
        window = (parse_kst_minute(forms.value(fields, "실행 예정 시작 (KST)")), parse_kst_minute(forms.value(fields, "실행 예정 종료 (KST)")))
        issues.append((issue, fields, approval, window))
    groups: dict[tuple[str, ...], list[Change]] = {}
    for change in changes:
        if id(change) in claimed or (change.kind == "pipeline" and change.event.get("eventSource") in PIPELINE_MECHANICS):
            continue  # a change set created or deleted outside a run changes no resource
        match = next((f"CHG-{issue['number']}" for issue, fields, approval, (begin, finish) in issues
                      if approval and begin and finish and begin <= change.at <= finish
                      and forms.asset_id(fields.get("대상 자산")) == change.asset_id), None)
        key = (match,) if match else (change.principal, change.asset_id, change.at.astimezone(KST).date().isoformat())
        groups.setdefault(key, []).append(change)
    for key, items in sorted(groups.items(), key=lambda pair: pair[1][0].at):
        first = items[0]
        change_id = key[0] if len(key) == 1 else ""
        if change_id:
            executed[change_id] = (first.at, "")
        names = ", ".join(sorted({item.event.get("eventName", "") for item in items}))
        principals = ", ".join(sorted({item.principal for item in items}))
        tables["executions"].append({
            "execution_id": f"CT-{first.event.get('eventID', '')}", "change_id": change_id, "asset_id": first.asset_id,
            "executed_at": kst(first.at),
            "source_ref": one_line(f"CloudTrail {first.event.get('_region', '')} {first.event.get('eventID', '')} · {principals} · {len(items)}건: {names}"),
        })

    # Change records: merged pull requests and console-change issues.
    for pull in pulls:
        fields = forms.sections(pull.get("body"))
        risk = forms.value(fields, "위험 평가")
        review = _approved_review(pull, registers.approvers["change"])
        done = executed.get(f"PR-{pull['number']}")
        tables["changes"].append({
            "change_id": f"PR-{pull['number']}", "asset_id": _declared(pull),
            "risk_ref": f"{pull.get('html_url', '')}#위험-평가" if risk else "",
            "assessed_at": kst(parse_time(pull.get("created_at"))) if risk else "",
            "approver": review["_login"] if review else "", "approved_at": kst(review["_at"]) if review else "",
            "executed_at": kst(done[0]) if done else "", "result_ref": done[1] if done else "",
        })
    for issue, fields, approval, _window in issues:
        done = executed.get(f"CHG-{issue['number']}")
        risk = forms.value(fields, "위험 평가")
        tables["changes"].append({
            "change_id": f"CHG-{issue['number']}", "asset_id": forms.asset_id(fields.get("대상 자산")),
            "risk_ref": f"{issue.get('html_url', '')}#위험-평가" if risk else "",
            "assessed_at": kst(parse_time(issue.get("created_at"))) if risk else "",
            "approver": approval[0] if approval else "", "approved_at": kst(approval[1]) if approval else "",
            "executed_at": kst(done[0]) if done else "", "result_ref": issue.get("html_url", "") if done else "",
        })

    # Exceptions: approved risk acceptances only.  An undecided or rejected
    # request is not an exception in effect.
    for issue in sorted(raw.risk_issues, key=lambda item: item["number"]):
        fields = forms.sections(issue.get("body"))
        approval = _approval_label(issue, "risk-accepted", registers.approvers["risk_acceptance"])
        if not approval:
            continue
        closed = issue.get("state") == "closed"
        risk = forms.value(fields, "수용하려는 위험과 근거")
        tables["exceptions"].append({
            "exception_id": f"RA-{issue['number']}", "asset_id": forms.asset_id(fields.get("대상 자산")),
            "risk_ref": f"{issue.get('html_url', '')}#수용하려는-위험과-근거" if risk else "",
            "approver": approval[0], "approved_at": kst(approval[1]),
            "expires_at": kst(end_of_kst_day(forms.value(fields, "만료일"))),
            "compensating_control": one_line(forms.value(fields, "보완 통제")),
            "review_at": kst(end_of_kst_day(forms.value(fields, "재검토일"))),
            "status": "closed" if closed else "active",
            "closure_ref": f"{issue.get('html_url', '')} ({issue.get('state_reason') or 'closed'} {kst(parse_time(issue.get('closed_at')))})" if closed else "",
        })

    # Deployments and intakes of the platform image.  The first use observed in
    # the CloudTrail window stands in for the image's first use.
    marker = f"/{raw.platform_repository}@sha256:"
    first_use: dict[str, datetime] = {}
    for change in changes:
        event = change.event
        if event.get("eventSource") != "ecs.amazonaws.com" or event.get("eventName") not in IMAGE_USE_EVENTS:
            continue
        digests = [image.split("@", 1)[1] for image in raw.task_images.get(_task_definition(event), []) if marker in image]
        if not digests:
            continue
        digest = digests[0]
        first_use[digest] = min(first_use.get(digest, change.at), change.at)
        tables["deployments"].append({
            "deployment_id": f"CT-{event.get('eventID', '')}", "intake_id": f"IMG-{digest[7:19]}", "artifact_id": digest,
            "deployed_at": kst(change.at), "source_ref": f"CloudTrail {event.get('_region', '')} {event.get('eventName')} {event.get('eventID', '')}",
        })
    verified: dict[str, dict[str, Any]] = {}
    for report in raw.verifications:
        digest = report.get("artifact_id", "")
        at = parse_time(report.get("verified_at"))
        if report.get("schema") != VERIFICATION_SCHEMA or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest or "") or at is None:
            continue
        if digest not in verified or at < parse_time(verified[digest]["verified_at"]):
            verified[digest] = report
    for digest, used in sorted(first_use.items(), key=lambda pair: pair[1]):
        report = verified.get(digest)
        tables["intakes"].append({
            "intake_id": f"IMG-{digest[7:19]}", "kind": "SW", "asset_id": registers.deploy_workflows.get(DEPLOY_WORKFLOW, "A-04"),
            "supplier_id": IN_HOUSE_SUPPLIER, "artifact_id": digest,
            "inspected_at": kst(parse_time(report.get("inspected_at"))) if report else "",
            "first_used_at": kst(used), "inspection_ref": f"{report.get('report_ref', '')}#deploy-gate" if report else "",
        })
        if report:
            tables["verifications"].append({
                "intake_id": f"IMG-{digest[7:19]}", "artifact_id": digest,
                "verified_at": kst(parse_time(report.get("verified_at"))), "method": report.get("method", ""),
                "expected_sha256": report.get("expected_sha256", ""), "actual_sha256": report.get("actual_sha256", ""),
                "trusted_source_ref": report.get("trusted_source_ref", ""), "report_ref": report.get("report_ref", ""),
                "result": report.get("result", ""), "sbom_ref": report.get("sbom_ref", ""),
            })

    # Reviewed registers.
    tables["suppliers"] = [{key: row[key] for key in ("supplier_id", "status", "source_ref")} for row in registers.suppliers]
    tables["assets"] = [{"asset_id": asset.asset_id, "criticality": asset.criticality, "business_impact": asset.business_impact,
                         "vulnerability_level": asset.vulnerability_level, "vulnerability_ref": asset.vulnerability_ref,
                         "context_ref": asset.context_ref} for asset in registers.assets.values()]
    for tab, rows in (("cti", registers.cti), ("rules", registers.rules), ("tuning", registers.tuning)):
        tables[tab] = [{name: row.get(name, "") for name in HEADERS[tab].split()} for row in rows]

    # Coverage: what this run read completely, never the events it cannot see.
    sources = {
        "changes": "GitHub 병합 PR·리뷰, change 이슈",
        "executions": "Actions 배포 실행 + CloudTrail 쓰기 이벤트(ap-northeast-2, us-east-1, 파이프라인·선언된 워크로드 외 전체)",
        "exceptions": "risk-acceptance 이슈", "intakes": "CloudTrail ECS 배포 + main 배포 검증 산출물", "suppliers": "governance/suppliers.json",
        "verifications": f"main 배포 실행의 Actions 산출물 {VERIFICATION_ARTIFACT}", "hardware": "없음(클라우드 전용)",
        "deployments": "CloudTrail ECS RunTask·CreateService·UpdateService(작업 정의 지정)", "cti": "governance/tvm/cti.json",
        "assets": "governance/assets.json", "rules": "governance/tvm/rules.json", "tuning": "governance/tvm/tuning.json",
    }
    end = now - TRAIL_LAG
    tables["coverage"] = [{"source": role, "period_start": kst(start.replace(microsecond=0) + timedelta(seconds=1)),
                           "period_end": kst(end.replace(microsecond=0)), "collected_at": kst(now.replace(microsecond=0)),
                           "status": "complete", "source_ref": f"{run_url} · {sources[role]}"} for role in COLLECTED]
    for rows in tables.values():
        for row in rows:
            row["instance_id"] = instance_id
    return tables


def sheets(tables: dict[str, list[dict[str, str]]], *, notice: list[str]) -> list[tuple[str, list[list[str]]]]:
    result = [("안내", [["항목", "내용"], *([line.split("\t", 1)[0], line.split("\t", 1)[1]] for line in notice)])]
    for tab in [*DATA_TABS, "coverage"]:
        headers = ["instance_id", *HEADERS[tab].split()]
        result.append((tab, [headers, *([row.get(name, "") for name in headers] for row in tables[tab])]))
    return result


# -- command line --------------------------------------------------------------

def fetch(registers: Registers, *, repository: str, token: str, environment: str, region: str,
          start: datetime, now: datetime) -> Raw:
    from chibbo_evidence import aws
    from chibbo_evidence.github import GitHub

    github = GitHub(token, repository)
    raw = Raw(repository, environment, f"chibbo-platform-{environment}")
    raw.pulls = github.merged_pulls()
    since = start.astimezone(UTC)
    for path in registers.deploy_workflows:
        raw.runs.extend(github.workflow_runs(Path(path).name, since.date().isoformat()))
    for run in raw.runs:
        sha = run.get("head_sha", "")
        if sha and sha not in raw.run_ancestors:
            raw.run_ancestors[sha] = github.ancestors(sha, since)
        # Only reports from main-branch release runs; a branch could dispatch
        # an altered workflow that uploads an arbitrary "passed" report.
        if run.get("path") == DEPLOY_WORKFLOW and run.get("head_branch") == "main" and run.get("event") == "workflow_dispatch":
            raw.verifications.extend(github.run_artifact_json(run["id"], VERIFICATION_ARTIFACT))
    raw.change_issues = github.issues("change")
    raw.risk_issues = github.issues("risk-acceptance")
    raw.stack_resources = aws.stack_resources(region, "Chibbo")
    workloads, patterns = raw.workload_roles(registers)
    keep = lambda event: category(event, raw.pipeline_roles, workloads, patterns) is not None  # noqa: E731
    for trail_region in dict.fromkeys((region, "us-east-1")):
        raw.events.extend(aws.write_events(trail_region, start, now, keep=keep))
    references = {_task_definition(event) for event in raw.events
                  if event.get("eventSource") == "ecs.amazonaws.com" and event.get("eventName") in IMAGE_USE_EVENTS}
    for reference in sorted(item for item in references if item and is_chibbo_task_definition(item)):
        raw.task_images[reference] = aws.task_definition_images(region, reference)
    return raw


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export Chibbo TVM records for GapZer0 GRC.")
    parser.add_argument("--instance-id", required=True, help="GRC instance ID of the recruitment platform")
    parser.add_argument("--environment", default="dev")
    parser.add_argument("--governance", default="governance")
    parser.add_argument("--out", required=True)
    parser.add_argument("--upload-bucket", default="", help="evidence bucket; empty = write the file only")
    parser.add_argument("--prefix", default="exports/tvm/chibbo/")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"\d{12}", args.instance_id):
        parser.error("--instance-id must be a 12-digit GRC instance ID")

    now = datetime.now(UTC)
    start = now - WINDOW + timedelta(minutes=1)
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    region = os.environ.get("AWS_REGION", "ap-northeast-2")
    run_url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repository}/actions/runs/{os.environ.get('GITHUB_RUN_ID', 'local')}"
    registers = load_registers(args.governance)
    raw = fetch(registers, repository=repository, token=os.environ.get("GITHUB_TOKEN", ""),
                environment=args.environment, region=region, start=start, now=now)
    tables = build(raw, registers, instance_id=args.instance_id, now=now, run_url=run_url, start=start)
    notice = [
        f"설명\t치뽀 채용지원 플랫폼의 실제 변경·도입·분석 기록을 GapZer0 GRC TVM-C-06·E-03·E-04 계약({SCHEMA})으로 내보낸 파일이다.",
        f"생성\t{kst(now)} · {run_url}",
        f"커밋\t{os.environ.get('GITHUB_SHA', '')}",
        f"범위\t{kst(start)} ~ {kst(now - TRAIL_LAG)} (CloudTrail 지연 15분 제외)",
        "events\t치뽀 자산을 덮는 SIEM이 아직 없어 수집하지 않는다. coverage에 events 행이 없다.",
        "원본\tgovernance/README.md",
    ]
    from chibbo_evidence import xlsx

    data = xlsx.workbook(sheets(tables, notice=notice))
    Path(args.out).write_bytes(data)
    counts = ", ".join(f"{tab} {len(rows)}" for tab, rows in tables.items() if tab != "coverage")
    print(f"TVM 내보내기: {counts}")
    if args.upload_bucket:
        from chibbo_evidence import aws

        key = f"{args.prefix}chibbo-tvm-{now:%Y%m%dT%H%M%SZ}.xlsx"
        aws.upload(region, args.upload_bucket, key, args.out)
        print(f"s3://{args.upload_bucket}/{key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
