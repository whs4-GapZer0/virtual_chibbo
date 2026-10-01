# AWS 배포 전 preflight

배포 workflow는 아래 항목이 모두 확인되기 전 실행하지 않는다.

- 새 CIDR `10.84.0.0/16`이 기존 연결망과 겹치지 않는다.
- Pricing API 또는 Calculator 원본과 `config/cost-assumptions.dev.yaml` 계산표를 `docs/cost/`에 저장했다.
- Cost allocation tag가 활성화되어 있고, 실제 월 예산과 팀 소유 알림 이메일로 50/80/100% actual 및 100% forecast AWS Budget을 만들 수 있다.
- Route 53 도메인 및 ACM certificate ARN, 실제 HTTPS origin이 준비됐다.
- IAM Identity Center의 identity source/MFA 책임과 신규 5개 팀 소유 이메일을 확인했다. 기존 GRC 사용자/root/access key를 재사용하지 않는다.
- Entra 단일 tenant app registration, customer A/B guest 초대 수락, 실제 `(tid, oid)` membership을 확인했다.
- GitHub OIDC의 immutable owner/repository ID, exact `aud`, protected environment/ref claim을 실제 토큰으로 확인했다.

## IAM Identity Center workforce preflight

`node scripts/identity-center-preflight.mjs`는 읽기 전용으로 Identity Center instance ARN과 identity store ID만 출력한다. 다음이 모두 확인된 뒤에만 workforce stack에 실제 값을 넣는다.

- 기존 GapZer0 사용자가 아닌 치뽀 전용 다섯 명의 팀 소유 이메일 alias와 MFA 책임자
- 각 직원별 전용 Identity Center group ID와 `config/workforce.example.yaml`의 permission set 매핑
- 실제 AWS account ID와 Identity Center instance ARN
- 해당 permission set으로 GapZer0 sample ARN 접근이 `Deny`임을 IAM simulator로 확인

이 runbook과 CDK는 초대, 사용자 생성, MFA 등록을 자동 실행하지 않는다. identity source가 외부 IdP이면 사용자 생성은 해당 IdP 소유자만 수행한다.

CloudTrail은 resume S3 object data event만 별도 trail로 수집한다. 계정 management trail·GRC bucket·KMS에 권한을 부여하거나 변경하지 않는다.
