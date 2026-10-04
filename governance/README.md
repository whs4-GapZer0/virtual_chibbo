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
