# 치뽀 변경·예외·도입 기록

이 폴더의 대장과 GitHub 기록이 GapZer0 GRC의 TVM-C-06(변경·예외), TVM-E-03(도입 무결성), TVM-E-04(보안 이벤트 분석) 판정 원본이다. 매일 내보내기가 이 기록을 XLSX로 만들어 GRC 증적 버킷에 쓴다. 대장을 바꿀 때도 PR과 승인 리뷰를 거친다.

## 무엇이 어느 판정이 되는가

| 기록 | 위치 | GRC 표 |
| --- | --- | --- |
| 코드·인프라 변경 | main에 병합된 PR. 양식의 대상 자산·위험 평가·롤백 계획, 작성자가 아닌 사람의 승인 리뷰 | TVM-C-06 changes |
| PR로 남지 않는 변경(콘솔·CLI) | `change` 이슈. 실행 전에 작성하고 승인자가 `change-approved` 라벨을 붙인다 | TVM-C-06 changes |
| 실제 실행 | 배포 워크플로 실행, 사람 계정의 CloudTrail 쓰기 이벤트 | TVM-C-06 executions |
| 위험 수용(예외) | `risk-acceptance` 이슈. 승인자가 `risk-accepted` 라벨을 붙인다 | TVM-C-06 exceptions |
| 공급자 | `suppliers.json` | TVM-E-03 suppliers |
| 자산 맥락 | `assets.json` | TVM-E-04 assets |
| CTI·우선순위 규칙·튜닝 | `tvm/*.json` | TVM-E-04 cti·rules·tuning |
| 보안 이벤트 분석 | `incident` 이슈 | TVM-E-04 events(아직 내보내지 않음) |

- 승인자는 `approvers.json`에 있는 계정이다. 작성자 본인의 승인 리뷰·라벨은 승인으로 보지 않는다.
- 위험 수용의 만료일·재검토일이 지나면 GRC에서 실패로 나온다. 만료 전에 종결하거나 새로 승인받는다.
- `assets.json`의 `matchers`는 CloudTrail 이벤트를 자산에 연결하는 규칙이다. 새 리소스를 만들면 그 자산의 규칙에 맞는지 확인한다.

## 저장소 관리자가 할 일

1. main 브랜치 보호에서 관리자 우회를 끈다(`enforce_admins`). 필수 검사에 `pr-governance`를 넣는다. 승인 리뷰 1명 이상을 유지한다.
2. 라벨 `change-approved`, `risk-accepted`를 만든다.
3. `approvers.json`에 작성자와 다른 승인자 계정을 추가한다. 지금은 한 명뿐이라 그 사람이 쓴 기록은 승인될 수 없다.

## 매일 내보내기 (`tvm-export` 워크플로)

매일 00:40 KST에 `scripts/chibbo_evidence/tvm_export.py`가 위 기록을 GRC 계약(`gapzero.tvm/v1`)의 XLSX로 만들어 `s3://gapzero-evidence-992764023398-ap-northeast-2/exports/tvm/chibbo/chibbo-tvm-<UTC>.xlsx`에 쓴다.

- 실행 신원은 Bootstrap 스택의 `chibbo-dev-tvm-exporter` 역할이다. `chibbo-dev-evidence` 환경의 OIDC 주체만 이 역할을 쓸 수 있다. 이 역할은 CloudTrail 이력·치뽀 스택 리소스 ID·작업 정의 이미지를 읽고, 위 prefix에 쓰기만 한다.
- 실행 판정
  - 배포 워크플로 실행은 그 실행 시간 동안 파이프라인 역할의 CloudTrail 쓰기 이벤트가 있을 때만 실행으로 센다. 그 실행의 head 커밋을 만든 PR이 변경 기록이다.
  - 사람 계정(IAM 사용자·루트·SSO)의 치뽀 리소스 쓰기 이벤트는 사람·자산·날짜별 실행 하나로 묶는다. 같은 자산과 실행 예정 시간대를 가진 승인된 `change` 이슈가 있으면 그 이슈가 변경 기록이다.
  - 서비스·워크로드 역할(ECS, SSM 에이전트, 스캐너)의 호출과 세션 시작은 변경으로 세지 않는다.
- 이미지 도입: CloudTrail의 ECS `CreateService`·`UpdateService`가 가리킨 작업 정의의 `chibbo-platform-dev@sha256:…` digest마다 도입 한 건이다. 배포 워크플로가 `tvm-e-03-verification` 산출물(서명 검증 보고서)을 남기면 검증·인수검사 칸이 채워진다.
- CloudTrail 이력은 90일까지라 GRC는 89일을 검사한다. 최근 15분은 CloudTrail 지연 때문에 수집 범위에 넣지 않는다.
- 보안 이벤트(events)는 치뽀 자산을 덮는 SIEM이 생길 때까지 내보내지 않는다. 그동안 GRC TVM-E-04는 평가 불가다.

처음 켤 때:

1. 이 변경을 병합하고 `deploy-prowler-scanner`를 실행해 Bootstrap 스택에 내보내기 역할을 만든다.
2. 저장소 Settings → Environments에서 `chibbo-dev-evidence`의 배포 브랜치를 `main`으로 제한한다(첫 실행 때 자동 생성된다).
3. `tvm-export`를 수동 실행하고 S3에 파일이 생겼는지 확인한다.
