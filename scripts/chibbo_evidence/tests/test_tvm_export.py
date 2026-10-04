from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
import json
from pathlib import Path
import unittest
import zipfile

from chibbo_evidence import registers, tvm_export, xlsx

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
NOW = datetime(2026, 10, 5, 15, 40, tzinfo=UTC)  # 00:40 KST on 10-06
INSTANCE = "038485873836"
RUN = "https://github.com/whs4-GapZer0/virtual_chibbo/actions/runs/{}"
DIGEST = "sha256:" + "ab" * 32
TASK = "arn:aws:ecs:ap-northeast-2:992764023398:task-definition/ChibboApplicationDevTask:7"
MIGRATOR = "arn:aws:ecs:ap-northeast-2:992764023398:task-definition/ChibboMigratorDevMigrationTask:3"


def body(asset: str, risk: str) -> str:
    return (TEMPLATE.replace("## 변경 요약\n", "## 변경 요약\n정렬 수정\n")
            .replace("## 대상 자산\n", f"## 대상 자산\n{asset}\n")
            .replace("## 위험 평가\n", f"## 위험 평가\n{risk}\n")
            .replace("## 롤백 계획\n", "## 롤백 계획\n이전 digest\n"))


def event(event_id: str, at: str, name: str, source: str, identity: dict, *, region: str = "ap-northeast-2",
          request: dict | None = None, response: dict | None = None) -> dict:
    return {"eventID": event_id, "eventTime": at, "eventName": name, "eventSource": source, "userIdentity": identity,
            "requestParameters": request or {}, "responseElements": response, "readOnly": False, "_region": region}


def role(name: str) -> dict:
    return {"type": "AssumedRole", "arn": f"arn:aws:sts::992764023398:assumed-role/{name}/session",
            "sessionContext": {"sessionIssuer": {"userName": name}}}


USER = {"type": "IAMUser", "arn": "arn:aws:iam::992764023398:user/hkksi"}
SSO = role("AWSReservedSSO_Admin_0123")
DEPLOY, CFN = role("chibbo-dev-github-deploy"), role("chibbo-dev-cloudformation-execution")


def issue(number: int, author: str, fields: dict[str, str], *, labels=(), label_events=(), state="open",
          closed_at=None, state_reason=None, created="2026-10-04T00:00:00Z") -> dict:
    text = "".join(f"### {title}\n\n{value}\n\n" for title, value in fields.items())
    return {"number": number, "user": {"login": author}, "body": text, "state": state, "closed_at": closed_at,
            "state_reason": state_reason, "created_at": created, "labels": [{"name": name} for name in labels],
            "html_url": f"https://github.com/whs4-GapZer0/virtual_chibbo/issues/{number}",
            "label_events": [{"event": "labeled", "label": label, "actor": actor, "created_at": at} for label, actor, at in label_events]}


def raw() -> tvm_export.Raw:
    data = tvm_export.Raw("whs4-GapZer0/virtual_chibbo", "dev", "chibbo-platform-dev")
    data.pulls = [
        {"number": 20, "user": {"login": "6kitty"}, "body": "## Why\nscanner run", "created_at": "2026-10-03T16:00:00Z",
         "merged_at": "2026-10-03T17:39:37Z", "merge_commit_sha": "m20", "head": {"sha": "h20"},
         "html_url": "https://github.com/whs4-GapZer0/virtual_chibbo/pull/20", "reviews": []},
        {"number": 22, "user": {"login": "jae"}, "body": body("A-04", "낮음: 화면만 바뀜"), "created_at": "2026-10-04T01:00:00Z",
         "merged_at": "2026-10-05T03:00:00Z", "merge_commit_sha": "m22", "head": {"sha": "h22"},
         "html_url": "https://github.com/whs4-GapZer0/virtual_chibbo/pull/22",
         "reviews": [
             {"state": "APPROVED", "user": {"login": "jae"}, "submitted_at": "2026-10-05T02:30:00Z", "commit_id": "h22"},
             {"state": "APPROVED", "user": {"login": "6kitty"}, "submitted_at": "2026-10-04T05:00:00Z", "commit_id": "old"},
             {"state": "APPROVED", "user": {"login": "6kitty"}, "submitted_at": "2026-10-05T02:00:00Z", "commit_id": "h22"},
         ]},
    ]
    data.runs = [
        {"id": 1, "path": ".github/workflows/deploy-prowler-scanner.yml", "head_sha": "m20",
         "run_started_at": "2026-10-03T20:42:31Z", "updated_at": "2026-10-03T20:45:35Z", "html_url": RUN.format(1)},
        {"id": 2, "path": ".github/workflows/deploy.yml", "head_sha": "m22",
         "run_started_at": "2026-10-05T04:00:00Z", "updated_at": "2026-10-05T04:20:00Z", "html_url": RUN.format(2)},
        {"id": 3, "path": ".github/workflows/deploy.yml", "head_sha": "m22",
         "run_started_at": "2026-10-05T05:00:00Z", "updated_at": "2026-10-05T05:01:00Z", "html_url": RUN.format(3)},
    ]
    data.run_pulls = {"m20": 20, "m22": 22}
    data.stack_resources = [
        {"stack": "ChibboProwlerScannerDev", "logical_id": "ProwlerScanner5E2A", "physical_id": "i-0scanner123", "type": "AWS::EC2::Instance"},
        {"stack": "ChibboFoundationDev", "logical_id": "AppSecurityGroupABC", "physical_id": "sg-0app456789", "type": "AWS::EC2::SecurityGroup"},
        {"stack": "ChibboFoundationDev", "logical_id": "ChibboProwlerReadOnlyRole9F", "physical_id": "ChibboProwlerReadOnlyRole", "type": "AWS::IAM::Role"},
    ]
    data.events = [
        event("e1", "2026-10-03T20:43:00Z", "ExecuteChangeSet", "cloudformation.amazonaws.com", DEPLOY, request={"stackName": "ChibboProwlerScannerDev"}),
        event("e1b", "2026-10-03T20:44:00Z", "RunInstances", "ec2.amazonaws.com", CFN, response={"instancesSet": {"items": [{"instanceId": "i-0scanner123"}]}}),
        event("e2m", "2026-10-05T04:07:00Z", "RunTask", "ecs.amazonaws.com", DEPLOY, request={"taskDefinition": MIGRATOR}),
        event("e2", "2026-10-05T04:10:00Z", "UpdateService", "ecs.amazonaws.com", CFN, request={"taskDefinition": TASK}),
        event("e3", "2026-10-03T18:00:00Z", "PutRolePolicy", "iam.amazonaws.com", USER, region="us-east-1", request={"roleName": "ChibboProwlerReadOnlyRole"}),
        event("e4", "2026-10-03T18:05:00Z", "PutRolePolicy", "iam.amazonaws.com", USER, region="us-east-1", request={"roleName": "ChibboProwlerReadOnlyRole"}),
        event("e5", "2026-10-05T01:30:00Z", "AuthorizeSecurityGroupIngress", "ec2.amazonaws.com", SSO, request={"groupId": "sg-0app456789"}),
        event("e6", "2026-10-05T01:31:00Z", "UpdateInstanceInformation", "ssm.amazonaws.com", role("chibbo-dev-prowler-scanner"), request={"instanceId": "i-0scanner123"}),
        event("e7", "2026-10-05T01:32:00Z", "PutRolePolicy", "iam.amazonaws.com", USER, region="us-east-1", request={"roleName": "gapzero-ec2-runtime"}),
        event("e8", "2026-10-05T01:33:00Z", "StartSession", "ssm.amazonaws.com", SSO, request={"target": "i-0scanner123"}),
        event("e9", "2026-10-04T10:00:00Z", "CreateChangeSet", "cloudformation.amazonaws.com", DEPLOY, request={"stackName": "ChibboFoundationDev"}),
    ]
    image = f"992764023398.dkr.ecr.ap-northeast-2.amazonaws.com/chibbo-platform-dev@{DIGEST}"
    data.task_images = {TASK: [image], MIGRATOR: [image]}
    data.change_issues = [issue(30, "jae", {
        "대상 자산": "A-02 VPC chibbo 네트워크", "실행 예정 시작 (KST)": "2026-10-05 10:00", "실행 예정 종료 (KST)": "2026-10-05 11:00",
        "변경 목적과 범위": "보안 그룹 규칙 추가", "위험 평가": "낮음", "롤백 방법": "규칙 삭제", "검증 계획": "접속 확인",
    }, labels=["change", "change-approved"], label_events=[("change-approved", "6kitty", "2026-10-05T00:30:00Z")])]
    accepted = {"대상 자산": "A-03 ALB 공개 HTTPS 진입점", "수용하려는 위험과 근거": "elbv2_insecure_ssl_ciphers",
                "보완 통제": "WAF 차단 규칙", "만료일": "2026-11-30", "재검토일": "2026-11-15", "조치 책임자": "jae"}
    data.risk_issues = [
        issue(40, "jae", accepted, labels=["risk-acceptance", "risk-accepted"], label_events=[("risk-accepted", "6kitty", "2026-10-04T03:00:00Z")]),
        issue(41, "jae", accepted, labels=["risk-acceptance"]),
        issue(42, "jae", accepted, labels=["risk-acceptance", "risk-accepted"], label_events=[("risk-accepted", "6kitty", "2026-10-04T03:00:00Z")],
              state="closed", closed_at="2026-10-05T00:00:00Z", state_reason="completed"),
        issue(43, "jae", accepted, labels=["risk-acceptance"], state="closed", closed_at="2026-10-05T00:00:00Z", state_reason="not_planned"),
        issue(44, "6kitty", accepted, labels=["risk-acceptance", "risk-accepted"], label_events=[("risk-accepted", "6kitty", "2026-10-04T03:00:00Z")]),
    ]
    data.verifications = [{"schema": "chibbo.image-verification/v1", "artifact_id": DIGEST, "verified_at": "2026-10-05T04:05:00Z",
                           "inspected_at": "2026-10-05T04:06:00Z", "method": "signature", "result": "passed",
                           "trusted_source_ref": "awskms:///alias/chibbo/dev/image-signing", "report_ref": RUN.format(2),
                           "sbom_ref": f"{RUN.format(2)}#sbom", "expected_sha256": "", "actual_sha256": ""}]
    return data


class TvmExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registers = registers.load(ROOT / "governance")
        cls.tables = tvm_export.build(raw(), cls.registers, instance_id=INSTANCE, now=NOW, run_url=RUN.format(99))

    def by(self, tab: str, key: str) -> dict[str, dict[str, str]]:
        return {row[key]: row for row in self.tables[tab]}

    def test_pipeline_runs_that_changed_aws_are_executions_of_their_pull_request(self) -> None:
        executions = self.by("executions", "execution_id")
        self.assertEqual(executions["RUN-1"]["change_id"], "PR-20")
        self.assertEqual(executions["RUN-1"]["asset_id"], "A-14")  # the scanner workflow's asset, which CloudTrail shows it touched
        self.assertEqual(executions["RUN-1"]["executed_at"], "2026-10-04T05:43:00+09:00")
        self.assertEqual(executions["RUN-2"]["change_id"], "PR-22")
        self.assertEqual(executions["RUN-2"]["asset_id"], "A-04")
        self.assertNotIn("RUN-3", executions)  # failed before changing anything

    def test_people_and_stray_pipeline_calls_are_out_of_band_executions(self) -> None:
        executions = self.by("executions", "execution_id")
        self.assertEqual(executions["CT-e3"]["change_id"], "")
        self.assertEqual(executions["CT-e3"]["asset_id"], "A-01")
        self.assertIn("2건: PutRolePolicy", executions["CT-e3"]["source_ref"])
        self.assertEqual(executions["CT-e5"]["change_id"], "CHG-30")
        self.assertEqual(executions["CT-e5"]["asset_id"], "A-02")
        self.assertEqual(executions["CT-e9"]["change_id"], "")
        self.assertEqual(set(executions), {"RUN-1", "RUN-2", "CT-e3", "CT-e5", "CT-e9"})

    def test_change_records_carry_only_real_assessment_and_approval(self) -> None:
        changes = self.by("changes", "change_id")
        self.assertEqual({k: changes["PR-20"][k] for k in ("asset_id", "risk_ref", "approver", "executed_at")},
                         {"asset_id": "", "risk_ref": "", "approver": "", "executed_at": "2026-10-04T05:43:00+09:00"})
        self.assertEqual(changes["PR-22"]["approver"], "6kitty")  # not the author, and on the merged commit
        self.assertEqual(changes["PR-22"]["approved_at"], "2026-10-05T11:00:00+09:00")
        self.assertEqual(changes["PR-22"]["assessed_at"], "2026-10-04T10:00:00+09:00")
        self.assertEqual(changes["PR-22"]["result_ref"], RUN.format(2))
        self.assertEqual(changes["CHG-30"]["approver"], "6kitty")
        self.assertEqual(changes["CHG-30"]["executed_at"], "2026-10-05T10:30:00+09:00")

    def test_risk_acceptances(self) -> None:
        exceptions = self.by("exceptions", "exception_id")
        self.assertEqual(exceptions["RA-40"]["status"], "active")
        self.assertEqual(exceptions["RA-40"]["expires_at"], "2026-11-30T23:59:59+09:00")
        self.assertEqual(exceptions["RA-40"]["review_at"], "2026-11-15T23:59:59+09:00")
        self.assertEqual(exceptions["RA-40"]["compensating_control"], "WAF 차단 규칙")
        self.assertEqual(exceptions["RA-41"]["status"], "pending_approval")
        self.assertEqual(exceptions["RA-42"]["status"], "closed")
        self.assertIn("completed", exceptions["RA-42"]["closure_ref"])
        self.assertNotIn("RA-43", exceptions)  # rejected requests are not exceptions
        self.assertEqual((exceptions["RA-44"]["status"], exceptions["RA-44"]["approver"]), ("pending_approval", ""))  # self-approval

    def test_image_deployments_intakes_and_verifications(self) -> None:
        deployments = [(row["deployment_id"], row["artifact_id"], row["intake_id"]) for row in self.tables["deployments"]]
        self.assertEqual(deployments, [("CT-e2m", DIGEST, "IMG-abababababab"), ("CT-e2", DIGEST, "IMG-abababababab")])
        [intake] = self.tables["intakes"]
        # The migration task is the first use, after the 04:06 gate.
        self.assertEqual((intake["supplier_id"], intake["first_used_at"], intake["inspected_at"]),
                         ("SUP-CHIBBO-CI", "2026-10-05T13:07:00+09:00", "2026-10-05T13:06:00+09:00"))
        [verification] = self.tables["verifications"]
        self.assertEqual((verification["method"], verification["result"]), ("signature", "passed"))
        self.assertEqual(self.tables["hardware"], [])

    def test_registers_and_coverage(self) -> None:
        self.assertEqual({row["supplier_id"] for row in self.tables["suppliers"]} >= {"SUP-CHIBBO-CI"}, True)
        self.assertEqual({row["asset_id"] for row in self.tables["assets"]}, set(self.registers.assets))
        coverage = self.by("coverage", "source")
        self.assertEqual(set(coverage), set(tvm_export.COLLECTED))
        self.assertNotIn("events", coverage)
        row = coverage["executions"]
        self.assertEqual((row["period_end"], row["collected_at"], row["status"]),
                         ("2026-10-06T00:25:00+09:00", "2026-10-06T00:40:00+09:00", "complete"))
        self.assertEqual(row["period_start"], "2026-07-08T00:40:01+09:00")
        for tab, rows in self.tables.items():
            self.assertTrue(all(row["instance_id"] == INSTANCE for row in rows), tab)

    def test_workbook_has_every_contract_tab_with_headers(self) -> None:
        data = xlsx.workbook(tvm_export.sheets(self.tables, notice=["설명\t시험"]))
        with zipfile.ZipFile(BytesIO(data)) as archive:
            workbook = archive.read("xl/workbook.xml").decode("utf-8")
            first = archive.read("xl/worksheets/sheet2.xml").decode("utf-8")
        for tab in [*tvm_export.HEADERS]:
            self.assertIn(f'name="{tab}"', workbook)
        self.assertIn("<t>change_id</t>", first)
        self.assertEqual(data, xlsx.workbook(tvm_export.sheets(self.tables, notice=["설명\t시험"])))  # byte-stable


if __name__ == "__main__":
    unittest.main()
