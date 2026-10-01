# 치뽀 채용지원 서비스 비판 검토

검토일: 2026-10-01
판정: **ITERATE**

현재 계획은 실제 AWS·Entra·GitHub 연결, 신규 `10.84.0.0/16` VPC, RLS, 합성 데이터 기준을 잘 정의했다. 그러나 구현 전 아래 다섯 항목을 명시해야 한다.

1. **공유 AWS 계정의 한계** — VPC·리소스·데이터 경로만 분리되고, 계정·Service Quota·청구·CloudTrail 관리 이벤트는 공유된다는 점을 명시한다. 치뽀 trail은 resume bucket S3 data event만 선택하고, GRC 관리 이벤트 원본을 치뽀 운영자에게 열지 않는다.
2. **신원 두 종류의 분리** — 가상 직원 5명은 IAM Identity Center workforce user와 최소 permission set으로 만든다. 고객사 A/B 담당자는 별도의 Entra B2B guest 두 명이며, 팀이 수신 가능한 두 이메일과 guest 수락, `(tid,oid)` membership 연결 없이는 해당 실제 E2E를 완료 처리하지 않는다. workforce permission set에는 정확한 허용 ARN/행위표를 두고 `AdministratorAccess`, wildcard, GRC 리소스 접근을 금지한다.
3. **삭제요청 본인 확인** — 접수 성공시 256-bit secret을 한 번 보여 주고 hash만 보관한다. 공개 삭제요청은 receipt number와 secret을 함께 요구한다. 이메일 인증 흐름이 생기면 1회성 링크로 대체한다.
4. **S3 CORS와 브라우저 검증** — resume bucket은 실제 배포 origin만 CORS 허용하며 POST/preflight 필수 header와 `x-amz-version-id`만 expose한다. wildcard와 accepted prefix browser read를 금지한다. 실제 ALB origin 브라우저 E2E로 POST→VersionId finalize를 검증한다.
5. **비용·배포 게이트** — `cdk diff`만으로 비용을 주장하지 않는다. region/AZ/task/RDS/NAT/ALB/log/S3 가정을 고정하고 Pricing API 또는 Calculator 견적을 기록한다. cost allocation tag, Budget/alert, 대상 account/region/CIDR preflight 통과 뒤에만 실제 deploy를 허용한다.

`chibbo-recruitment-service-architecture-review.md`는 현재 이 경로에 존재한다. 계획의 인용은 실제 파일명과 일치해야 한다.

참고: [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc), [AWS OIDC condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)
