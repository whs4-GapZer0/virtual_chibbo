"""Load and validate the reviewed registers under ``governance/``."""

from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
import json
from pathlib import Path
import re
import sys
from typing import Any

LEVELS = {"low", "medium", "high", "critical"}
ASSET_ID = re.compile(r"^A-\d{2}$")


class RegisterError(ValueError):
    """A governance register is missing or malformed."""


@dataclass(frozen=True)
class Asset:
    asset_id: str
    name: str
    criticality: str
    business_impact: str
    vulnerability_level: str
    vulnerability_ref: str
    context_ref: str
    logical_ids: tuple[str, ...]
    types: tuple[str, ...]
    event_sources: tuple[str, ...]


@dataclass(frozen=True)
class Registers:
    root: Path
    assets: dict[str, Asset]
    default_asset: str
    deploy_workflows: dict[str, str]
    suppliers: tuple[dict[str, str], ...]
    approvers: dict[str, frozenset[str]]
    cti: tuple[dict[str, str], ...]
    rules: tuple[dict[str, str], ...]
    tuning: tuple[dict[str, str], ...]
    # Role-name patterns whose calls are workloads rather than changes
    # (in addition to the IAM roles the Chibbo stacks define).
    workload_roles: tuple[str, ...] = ()

    def asset_for_resource(self, logical_id: str, resource_type: str) -> str | None:
        """The asset owning a CloudFormation resource: logical ID first, then type."""

        for asset in self.assets.values():
            if any(fnmatchcase(logical_id, pattern) for pattern in asset.logical_ids):
                return asset.asset_id
        for asset in self.assets.values():
            if any(fnmatchcase(resource_type, pattern) for pattern in asset.types):
                return asset.asset_id
        return None

    def asset_for_event_source(self, event_source: str) -> str:
        for asset in self.assets.values():
            if event_source in asset.event_sources:
                return asset.asset_id
        return self.default_asset


def _load(path: Path, schema: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RegisterError(f"{path}: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema") != schema:
        raise RegisterError(f"{path}: schema는 {schema}이어야 합니다.")
    return payload


def _strings(path: Path, item: Any, required: tuple[str, ...]) -> dict[str, str]:
    if not isinstance(item, dict):
        raise RegisterError(f"{path}: 항목은 객체여야 합니다.")
    for key in required:
        if not isinstance(item.get(key), str):
            raise RegisterError(f"{path}: {key}는 문자열이어야 합니다.")
    return {key: value.strip() for key, value in item.items() if isinstance(value, str)}


def _rows(path: Path, payload: dict[str, Any], key: str, required: tuple[str, ...], identity: tuple[str, ...]) -> tuple[dict[str, str], ...]:
    items = payload.get(key)
    if not isinstance(items, list):
        raise RegisterError(f"{path}: {key}는 목록이어야 합니다.")
    rows = tuple(_strings(path, item, required) for item in items)
    seen = set()
    for row in rows:
        marker = tuple(row[name] for name in identity)
        if not all(marker) or marker in seen:
            raise RegisterError(f"{path}: {', '.join(identity)}가 비었거나 중복되었습니다.")
        seen.add(marker)
    return rows


def load(root: str | Path) -> Registers:
    base = Path(root)
    raw = _load(base / "assets.json", "chibbo.assets/v1")
    assets: dict[str, Asset] = {}
    for item in raw.get("assets") or []:
        row = _strings(base / "assets.json", item, ("asset_id", "name", "criticality", "business_impact",
                                                    "vulnerability_level", "vulnerability_ref", "context_ref"))
        matchers = item.get("matchers") or {}
        lists = {name: matchers.get(name, []) for name in ("logical_ids", "types", "event_sources")}
        if (not ASSET_ID.match(row["asset_id"]) or row["asset_id"] in assets
                or row["criticality"] not in LEVELS or row["business_impact"] not in LEVELS
                or row["vulnerability_level"] not in LEVELS | {""}
                or (row["vulnerability_level"] and not row["vulnerability_ref"])
                or not all(isinstance(values, list) and all(isinstance(v, str) and v for v in values) for values in lists.values())):
            raise RegisterError(f"assets.json: {row.get('asset_id') or '?'} 항목이 올바르지 않습니다.")
        assets[row["asset_id"]] = Asset(*(row[name] for name in ("asset_id", "name", "criticality", "business_impact",
                                                                  "vulnerability_level", "vulnerability_ref", "context_ref")),
                                         *(tuple(lists[name]) for name in ("logical_ids", "types", "event_sources")))
    default_asset = raw.get("default_asset")
    workflows = raw.get("deploy_workflows")
    if (default_asset not in assets or not isinstance(workflows, dict)
            or not all(isinstance(k, str) and value in assets for k, value in workflows.items())):
        raise RegisterError("assets.json: default_asset·deploy_workflows는 등록된 자산 ID를 가리켜야 합니다.")
    workload_roles = raw.get("workload_roles", [])
    if not isinstance(workload_roles, list) or not all(isinstance(item, str) and item.strip() for item in workload_roles):
        raise RegisterError("assets.json: workload_roles는 역할 이름 패턴 목록이어야 합니다.")

    suppliers_path = base / "suppliers.json"
    suppliers = _rows(suppliers_path, _load(suppliers_path, "chibbo.suppliers/v1"), "suppliers",
                      ("supplier_id", "status", "name", "source_ref"), ("supplier_id",))
    if any(row["status"] not in {"approved", "suspended"} for row in suppliers):
        raise RegisterError("suppliers.json: status는 approved 또는 suspended입니다.")

    approvers_path = base / "approvers.json"
    approvers_raw = _load(approvers_path, "chibbo.approvers/v1")
    approvers = {}
    for role in ("change", "risk_acceptance"):
        names = approvers_raw.get(role)
        if not isinstance(names, list) or not all(isinstance(name, str) and name.strip() for name in names):
            raise RegisterError(f"approvers.json: {role}는 GitHub 계정 목록이어야 합니다.")
        approvers[role] = frozenset(name.strip().lower() for name in names)

    tvm = base / "tvm"
    cti = _rows(tvm / "cti.json", _load(tvm / "cti.json", "chibbo.cti/v1"), "items",
                ("cti_id", "source_ref", "approved_by", "valid_from", "expires_at", "indicator_ref", "threat_level"), ("cti_id",))
    rules = _rows(tvm / "rules.json", _load(tvm / "rules.json", "chibbo.priority-rules/v1"), "rules",
                  ("rule_id", "criticality", "business_impact", "vulnerability_level", "threat_level", "priority",
                   "response_level", "version", "rule_ref", "approved_by", "approved_at"),
                  ("rule_id", "criticality", "business_impact", "vulnerability_level", "threat_level"))
    tuning = _rows(tvm / "tuning.json", _load(tvm / "tuning.json", "chibbo.tuning/v1"), "reviews",
                   ("event_id", "rule_id", "reviewed_at", "disposition", "rule_version", "evidence_ref"), ("event_id",))
    return Registers(base, assets, default_asset, dict(workflows), suppliers, approvers, cti, rules, tuning,
                     tuple(item.strip() for item in workload_roles))


def main(argv: list[str] | None = None) -> int:
    root = (argv if argv is not None else sys.argv[1:]) or ["governance"]
    try:
        registers = load(root[0])
    except RegisterError as error:
        print(f"governance 대장 오류: {error}", file=sys.stderr)
        return 1
    print(f"governance 대장 확인: 자산 {len(registers.assets)}, 공급자 {len(registers.suppliers)}, "
          f"CTI {len(registers.cti)}, 우선순위 규칙 {len(registers.rules)}, 튜닝 {len(registers.tuning)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
