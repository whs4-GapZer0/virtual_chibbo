from __future__ import annotations

from pathlib import Path
import unittest

from chibbo_evidence import forms, pr_check, registers

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
ASSETS = {"A-01", "A-04"}


def filled_body() -> str:
    return (TEMPLATE
            .replace("## 변경 요약\n", "## 변경 요약\n지원서 목록 페이지 정렬 수정\n")
            .replace("## 대상 자산\n", "## 대상 자산\nA-04\n")
            .replace("## 위험 평가\n", "## 위험 평가\n영향 낮음: 화면 정렬만 바뀜\n")
            .replace("## 롤백 계획\n", "## 롤백 계획\n이전 이미지 digest로 되돌림\n"))


class FormsTest(unittest.TestCase):
    def test_issue_form_fields_and_no_response(self) -> None:
        body = "### 대상 자산\n\nA-06 S3 이력서 버킷\n\n### 보완 통제\n\n_No response_\n\n### 만료일\n\n2026-11-30\n"
        fields = forms.sections(body)
        self.assertEqual(forms.asset_id(fields["대상 자산"]), "A-06")
        self.assertEqual(forms.value(fields, "보완 통제"), "")
        self.assertEqual(forms.value(fields, "만료일"), "2026-11-30")

    def test_comments_are_not_content_and_first_heading_wins(self) -> None:
        fields = forms.sections("## 위험 평가\n<!-- 예시 -->\n\n## 위험 평가\n낮음\n")
        self.assertEqual(fields["위험 평가"], "")


class PullRequestCheckTest(unittest.TestCase):
    def test_the_untouched_template_fails_every_required_section(self) -> None:
        self.assertEqual(len(pr_check.problems(TEMPLATE, ASSETS)), 4)

    def test_a_filled_template_passes(self) -> None:
        self.assertEqual(pr_check.problems(filled_body(), ASSETS), [])

    def test_an_unknown_asset_fails(self) -> None:
        body = filled_body().replace("## 대상 자산\nA-04\n", "## 대상 자산\n플랫폼 전체\n")
        self.assertEqual(pr_check.problems(body, ASSETS), ["'대상 자산'에 governance/assets.json의 자산 ID(예: A-04)를 적어야 합니다."])

    def test_the_bundled_registers_load(self) -> None:
        loaded = registers.load(ROOT / "governance")
        self.assertIn("A-04", loaded.assets)
        self.assertEqual(loaded.deploy_workflows[".github/workflows/deploy.yml"], "A-04")
        self.assertEqual(loaded.asset_for_resource("ResumeBucket1A2B3C", "AWS::S3::Bucket"), "A-06")
        self.assertEqual(loaded.asset_for_resource("AppSecurityGroup99", "AWS::EC2::SecurityGroup"), "A-02")
        self.assertEqual(loaded.asset_for_resource("ProwlerScannerABC", "AWS::EC2::Instance"), "A-14")
        self.assertIsNone(loaded.asset_for_resource("Something", "AWS::Lambda::Function"))
        self.assertEqual(loaded.asset_for_event_source("rds.amazonaws.com"), "A-05")
        self.assertEqual(loaded.asset_for_event_source("lambda.amazonaws.com"), "A-01")
        self.assertIn("6kitty", loaded.approvers["risk_acceptance"])

    def test_issue_form_asset_options_match_the_register(self) -> None:
        loaded = set(registers.load(ROOT / "governance").assets)
        for name in ("change.yml", "risk-acceptance.yml", "incident.yml"):
            text = (ROOT / ".github" / "ISSUE_TEMPLATE" / name).read_text(encoding="utf-8")
            options = {forms.asset_id(line) for line in text.splitlines() if line.strip().startswith("- A-")}
            self.assertEqual(options, loaded, name)


if __name__ == "__main__":
    unittest.main()
