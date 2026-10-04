"""Fail a pull request whose body leaves the change record empty.

The merged pull request is Chibbo's change record (GRC TVM-C-06 ``changes``):
the target asset, risk assessment and rollback plan must be written before
review, and an approving review by someone other than the author is the
approval.  Run from the ``pr-governance`` workflow with ``PR_BODY`` set.
"""

from __future__ import annotations

import os
import sys

from chibbo_evidence import forms, registers

REQUIRED = ("변경 요약", "대상 자산", "위험 평가", "롤백 계획")


def problems(body: str | None, known_assets: set[str]) -> list[str]:
    fields = forms.sections(body)
    found = [f"'{title}' 칸이 비었습니다." for title in REQUIRED if not forms.value(fields, title)]
    asset = forms.asset_id(fields.get("대상 자산"))
    if forms.value(fields, "대상 자산") and asset not in known_assets:
        found.append("'대상 자산'에 governance/assets.json의 자산 ID(예: A-04)를 적어야 합니다.")
    return found


def main() -> int:
    known = set(registers.load(os.environ.get("GOVERNANCE_DIR", "governance")).assets)
    found = problems(os.environ.get("PR_BODY"), known)
    for message in found:
        print(f"::error title=PR 변경 기록::{message}")
    if not found:
        print("PR 변경 기록 확인: 변경 요약·대상 자산·위험 평가·롤백 계획이 있습니다.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
