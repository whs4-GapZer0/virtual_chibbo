# 치뽀 채용지원 서비스 구현 계획

상태: Stage 1 아키텍처 보완 완료, 구현 대기
작성일: 2026-10-01
근거: [`docs/research/chibbo-recruitment-service-research.md`](../../docs/research/chibbo-recruitment-service-research.md), [`.omx/plans/chibbo-recruitment-service-architecture-review.md`](./chibbo-recruitment-service-architecture-review.md), [`.omx/plans/chibbo-recruitment-service-critic-review.md`](./chibbo-recruitment-service-critic-review.md)
대상 저장소: `/Users/6kiity/Documents/virtual_chibbo`

## 1. 목표와 완료 조건

치뽀컴퍼니가 실제 AWS에서 운영할 수 있는 소규모 멀티테넌트 채용지원 SaaS의 첫 버전을 만든다. 정적 화면이나 mock API가 아니라 PostgreSQL, private S3, Entra OIDC, AWS 운영 로그에 연결되는 실제 서비스다. 다만 지원자와 이력서는 모두 합성 데이터만 사용한다.

완료 상태는 아래 조건을 모두 만족할 때다.

1. 비로그인 지원자가 공개 공고를 보고 이름·이메일·이력서·개인정보 고지 동의로 지원할 수 있다.
2. 고객사 담당자가 Entra OIDC로 로그인하여 자신의 고객사 공고와 지원서만 조회하고 상태를 변경할 수 있다.
3. 치뽀 관리자가 고객사와 담당자 멤버십을 관리할 수 있다.
4. 고객사 A 주체가 고객사 B의 식별자를 직접 요청해도 조회·수정·다운로드가 모두 `404`이고, DB RLS가 애플리케이션 실수를 한 번 더 차단한다.
5. 이력서는 일회성 `upload_intent`에 묶인 짧은 만료의 제한된 presigned POST로 quarantine 경로에 업로드되고, 고정된 S3 `VersionId`의 서버 검증을 통과한 객체만 accepted 경로와 DB 레코드에 연결된다.
6. 서비스가 GapZer0과 분리된 신규 VPC `10.84.0.0/16`의 ECS Fargate/ALB/RDS/S3에 배포된다.
7. 치뽀 전용 CloudTrail은 resume bucket S3 data event만 수집하고, VPC Flow Logs와 CloudWatch 애플리케이션/감사 로그 및 기본 경보가 실제로 수집된다. 공유 계정의 관리 이벤트 원본과 GRC 이벤트는 치뽀 운영자에게 공개하지 않는다.
8. GitHub Actions는 장기 AWS 키 없이 2026년 immutable subject 형식의 실제 OIDC claim으로 제한된 배포 역할을 사용하고, 배포·CloudFormation 실행·migration·ECS runtime 역할을 분리한다.
9. 기존 GRC IAM 사용자와 root를 운영자로 재사용하지 않고, organization instance임을 확인한 IAM Identity Center에 5명의 가상 직원용 workforce 신원·그룹·최소 permission set이 별도로 존재한다. 고객사 A/B 담당자는 workforce 계정이 아닌 서로 다른 Entra B2B guest 2명이며, 총 7개의 역할 주체를 혼동하지 않는다.
10. 인증된 staff/admin 페이지·API·멤버십 조회는 첫 버전에서 전부 `no-store`이며, 멤버십 비활성화와 세션 폐기가 다음 요청부터 즉시 반영된다.

## 2. 범위

### 초기 MVP에 포함

- 공개 공고 목록과 상세
- 공개 지원서 제출 및 접수번호 표시
- 합성 PDF/DOCX 이력서 업로드, 서버측 검증, private 저장
- 고객사 담당자 로그인, 자기 회사 지원자 목록·상세·이력서 다운로드·상태 변경
- 치뽀 관리자 고객사·멤버십 관리
- 두 고객사, 공고 3개, 지원자 15명, 합성 이력서 5개의 seed
- 구조화 감사 이벤트: 로그인, 이력서 다운로드, 상태 변경, 멤버십 변경, 삭제 처리
- 지원자 삭제 요청을 접수·완료 상태로 관리하는 최소 운영 경로
- AWS 인프라, 배포 파이프라인, 로그·경보·백업
- 5명 직원의 AWS workforce identity 분리
- 고객사 A/B 각각 1명의 Entra B2B guest 담당자와 실제 초대·수락·membership E2E

### 명시적으로 보류

- 실제 개인정보 또는 실제 이력서 수집
- AI 후보자 평가, 면접 일정, 메일 발송, 결제, 인재 풀
- 지원자 계정, 지원 상태 셀프 조회, 이력서 교체
- 악성코드 검사/CDR 워커. 외부 실제 지원자 공개 전에는 필수 후속 작업이다.
- 고객사별 별도 VPC/DB, 멀티리전, 고가용 NAT, 별도 AWS 계정 분리
- CloudFront와 WAF. 합성 데이터 PoC의 ALB 공개 범위로 시작하며 외부 공개 전 추가한다.
- 개인정보 법정 보유기간의 임의 확정. 정책 값은 설정 가능하게 두고 법률·계약 검토 후 확정한다.

## 3. RALPLAN-DR

### 원칙

1. 테넌트 격리는 인증과 별개이며 API, SQL, RLS, 객체 키, 감사 로그에서 반복 강제한다.
2. 지원자 데이터는 최소 수집하고 합성 데이터로만 운영 검증한다.
3. 영구 키와 root 일상 사용을 금지하고 OIDC·Identity Center·임시 세션을 사용한다.
4. 운영 환경은 코드로 재현 가능해야 하며, 배포와 권한 변경은 추적 가능해야 한다.
5. 초기 버전은 5명 스타트업이 설명하고 운영할 수 있는 크기로 제한한다.

### 주요 결정 동인

1. 교차 고객사 개인정보 노출을 구조적으로 막을 수 있는가.
2. 실제 AWS/Entra/GitHub 연동을 사용하면서 운영 복잡도와 비용을 제한할 수 있는가.
3. 향후 GapZer0이 실제 로그·설정·증적을 수집할 수 있는 관측 가능성을 제공하는가.

### 선택지 비교

#### 선택지 A — 단일 Next.js 풀스택 서비스 + PostgreSQL + CDK (선택)

- `apps/platform` 하나가 공개 UI, 관리자 UI, API route handler를 제공한다.
- `packages/db`, `packages/contracts`, `packages/auth`, `packages/audit`로 보안 경계를 분리한다.
- 하나의 ECS 서비스/이미지로 배포해 초기 운영 면적을 줄인다.
- 모든 DB 접근을 서버 내부 모듈에 한정하고 RLS transaction helper를 강제한다.

장점: MVP 속도, 하나의 배포 단위, 타입 공유, 5명 운영에 적합.
위험: UI와 API가 같은 프로세스라 코드 경계를 느슨하게 만들 수 있음. 패키지 의존 방향, route별 인증 미들웨어, DB 접근 lint/테스트로 통제한다.

#### 선택지 B — Next.js 웹 + Fastify API 분리

- 두 애플리케이션과 두 ECS 서비스로 분리한다.
- API 경계가 명확하고 독립 확장하기 쉽다.

기각 이유: 현재 세 화면과 2개 고객사의 PoC에는 배포·로그·CORS·서비스간 인증·장애지점이 과도하다. API 소비자가 추가되거나 독립 확장이 필요해질 때 분리한다.

#### 선택지 C — 서버리스 API Gateway/Lambda + 정적 프론트엔드

- 유휴 비용과 자동 확장에 유리하다.

기각 이유: 사용자가 지정한 ECS Fargate/ALB 운영 구조와 다르고, RDS 연결 관리·업로드 검증·로컬/운영 동형성의 복잡도가 증가한다.

### 결정

pnpm 기반 TypeScript 모노레포를 사용한다. 런타임은 Node.js 22 LTS, 애플리케이션은 lockfile에 exact version으로 고정한 Next.js 16 App Router의 standalone container, DB는 PostgreSQL과 Drizzle/`pg`, 입력 계약은 Zod, 테스트는 Vitest와 Playwright, 인프라는 AWS CDK TypeScript로 구성한다. Next.js 16의 요청 전처리는 `proxy.ts`를 사용하지만 최종 인가는 각 server handler가 수행한다. 애플리케이션 인증은 치뽀 단일 Entra tenant의 OIDC+B2B guest와 opaque 서버측 세션으로 구현하고 AWS workforce identity와 명확히 분리한다.

### 결과와 후속 조건

- 초기에는 하나의 컨테이너이므로 모듈 경계 위반을 정적 검사와 회귀시험으로 막아야 한다.
- 동일 AWS 계정을 쓰는 것은 계정 격리가 아니다. 치뽀는 VPC·IAM 역할·KMS/S3/RDS·데이터 경로·리소스 태그만 분리된다. 계정 루트, AWS Organizations/Identity Center instance, Service Quota, 청구, Cost Explorer, account-level CloudTrail 관리 이벤트와 일부 서비스 제어면은 GRC와 공유된다. 치뽀 stack이 GRC 계정 리소스나 account trail을 소유·변경하지 않으며, 이 한계를 운영 문서와 데모에서 명시한다.
- 실제 사용자 초대는 5개의 팀 소유 이메일 별칭과 MFA 등록이 준비된 뒤 완료된다.
- 실제 지원자를 받기 전 malware scanning/CDR, WAF, 법률 검토, 개인정보 처리 계약이 별도 출시 게이트다.

## 4. 목표 아키텍처

```text
지원자 / 고객사 담당자
         │ HTTPS
         ▼
Route 53 DNS ── public ALB (TLS/ACM)
                       │
                       ▼
             ECS Fargate chibbo-platform
               private app subnets
                │       │        │
                │       │        └─► Entra OIDC (NAT, outbound 443)
                │       └──────────► private S3 resume bucket
                └──────────────────► RDS PostgreSQL, isolated DB subnets

CloudWatch Logs/Alarms ◄─ app, ALB, ECS, RDS
Chibbo CloudTrail (resume S3 data event only) ─► chibbo audit bucket
Account management trail (shared/GRC 포함) ─► account security owner only
VPC Flow Logs ─► chibbo CloudWatch log group
GitHub Actions OIDC ─► scoped build/deploy role ─► ECR/ECS/CDK
IAM Identity Center ─► five employee groups/permission sets ─► AWS account
```

### 네트워크 계획

- VPC: `10.84.0.0/16`, 이름 접두사 `chibbo-`, 태그 `Project=virtual-chibbo`, `Environment=<env>`, `Owner=ChibboCompany`, `DataClass=synthetic`.
- 2개 AZ에 public ALB subnet, private app subnet, isolated DB subnet을 둔다.
- PoC 비용을 위해 NAT Gateway는 1개로 시작한다. 이는 AZ 장애 시 outbound OIDC/이미지 pull에 단일 장애점이므로 운영 공개 전 2-AZ NAT 또는 egress 재설계를 판단한다.
- S3 gateway endpoint는 시간당 비용 없이 resume/audit bucket 트래픽을 private route로 보내므로 초기 배포에 포함한다. ECR(api/dkr), CloudWatch Logs, Secrets Manager interface endpoint는 AZ별 시간당 비용이 누적되고 Entra OIDC 때문에 NAT 자체를 제거할 수 없으므로 초기에는 만들지 않는다. NAT bytes와 호출량을 2주 측정한 뒤 NAT 처리비보다 endpoint 고정비가 낮을 때만 추가한다.
- SG: Internet→ALB 443, ALB→ECS app port, ECS→RDS 5432, ECS→443 egress만 명시한다. RDS public access는 항상 false다.

초기 비용 발생 자원은 ALB, NAT Gateway 1개와 처리량, ECS Fargate, RDS, CloudWatch 수집·보존, CloudTrail S3 data event, S3 저장·요청, KMS 요청이다. `cdk diff`는 리소스 변경 검토용일 뿐 비용 증거로 사용하지 않는다. 배포 대상 region, AZ 2개, ECS task 수/vCPU/메모리/월 실행시간, RDS class/storage/backup, NAT 처리 GB, ALB LCU, 로그 수집·보존 GB, S3 저장·요청·data event 수를 `config/cost-assumptions.<env>.yaml`에 고정한다. 같은 날짜의 AWS Pricing API 원본 JSON 또는 AWS Pricing Calculator 공유 견적과 계산표를 `docs/cost/`에 보존한다.

`Project=virtual-chibbo`, `Environment=<env>`, `CostCenter=Chibbo`를 cost allocation tag로 활성화하고 모든 taggable 자원에 강제한다. 실제 배포 전 `CHIBBO_MONTHLY_BUDGET_USD`와 팀 소유 알림 이메일을 필수 입력으로 받아 AWS Budget의 actual 50/80/100% 및 forecast 100% 알림을 만든다. 대상 account ID, region, CIDR 충돌, 가격 가정, tag 활성화, Budget/수신자 존재를 preflight가 통과하지 못하면 deploy workflow는 중단한다.

### 공유 AWS 계정과 CloudTrail 접근 경계

- 치뽀 VPC `10.84.0.0/16`은 네트워크·데이터 경로 분리이지 AWS account isolation이 아니다. Service Quota 소진, payer/billing, IAM Identity Center, 계정 수준 장애나 보안 사고의 영향은 GRC와 공유된다.
- 기존 account management trail은 GRC를 포함한 계정 전체 관리 이벤트를 담으므로 치뽀 CDK가 수정하지 않는다. 원본 접근은 기존 account security owner/root-of-trust에만 남기고 5개 치뽀 workforce permission set에는 해당 trail/bucket/KMS ARN을 허용하지 않는다.
- 치뽀 전용 trail은 `IncludeManagementEvents=false`이고 advanced event selector를 resume bucket의 `AWS::S3::Object` read/write data event ARN prefix 하나로 제한한다. 다른 bucket, Lambda, DynamoDB data event와 account management event는 선택하지 않는다.
- 치뽀 audit bucket은 CloudTrail service의 조건부 write와 `Chibbo-Security-Auditor`의 해당 project prefix read만 허용한다. Platform/Release/Asset 역할, GRC 역할, public principal에는 read/list/decrypt를 허용하지 않는다.
- GitHub 배포·CloudFormation 관리 이벤트가 필요하면 account security owner가 사건 단위로 redacted export를 제공한다. 이를 치뽀 trail이 독립 수집한다고 주장하지 않는다.

### GRC 인스턴스별 이벤트 소유 경계

치뽀컴퍼니의 GRC 관리 단위는 법인·서비스·시스템을 한 화면에 중복 수집하는 구성이 아니다. 모든 수집 이벤트에는 `event_scope`와 `event_source`를 붙여 **하나의 primary instance**만 지정한다. 상위·관련 인스턴스는 원문을 복제하지 않고 correlation ID와 증적 참조만 연결한다. 따라서 같은 S3 업로드가 서비스와 플랫폼 화면에 중복으로 나타나거나, 계정 전체 CloudTrail 관리 이벤트가 치뽀의 모든 인스턴스에 섞이는 일이 없다.

| GRC instance | `event_scope` | primary event source | 대표 이벤트 | 접근·격리 규칙 |
| --- | --- | --- | --- | --- |
| 치뽀컴퍼니 주식회사 | `legal-corporation` | Identity Center assignment/MFA evidence, 승인·예외 기록, account security owner의 redacted management-event export | 5명 workforce 신원·권한 변경, 경영 승인, 법인 단위 예외 승인 | 공유 계정 CloudTrail management event를 직접 수집하거나 열람하지 않는다. 필요한 법인 증적만 owner export로 import한다. |
| 치뽀 채용지원 서비스 | `recruitment-service` | application audit event, Entra sign-in/role event, privacy-request event | 공고 공개/종료, 지원서 접수, 담당자 로그인·조회, 상태 변경, 삭제 요청 | 고객사별 `company_id`가 필수이며 tenant A/B 이벤트는 서로 교차 조회할 수 없다. |
| 치뽀 채용관리 플랫폼 시스템 | `recruitment-platform` | ECS/ALB/CloudWatch, resume S3 object CloudTrail data event, RDS backup/restore, GitHub deployment | task health, 5xx, resume upload/download/delete, DB backup/restore, 이미지 배포 | `chibbo-data-trail`은 resume bucket ARN prefix의 S3 object data event만 보관한다. 이 원문은 플랫폼의 primary evidence다. |
| 치뽀 사내 HR 시스템 | `internal-hr` | Identity Center user/group lifecycle, Entra admin membership audit, offboarding checklist | 입사·직무 변경·퇴사, MFA 상태, 권한 회수, 인사 증적 열람 승인 | 애플리케이션 지원자 데이터와 분리한다. workforce 5명은 새 Identity Center 사용자로만 관리하며 장기 access key를 만들지 않는다. |
| 치뽀 자산관리 시스템 | `asset-management` | NetBox inventory/ownership baseline, AWS Resource Explorer/Config inventory, VPC Flow Logs | VPC/subnet/SG/route/asset owner 기준선, 변경 탐지, ALB→ECS·ECS→RDS 네트워크 흐름 | `10.84.0.0/16` 치뽀 VPC와 `Project=virtual-chibbo` 태그 자원만 scope에 넣는다. Flow Log는 자산·네트워크 증적이며 resume CloudTrail과 섞지 않는다. |

`packages/audit`의 이벤트 계약과 인프라 log subscription은 이 표를 allowlist로 사용한다. 새 source를 추가할 때는 source가 어느 primary instance에 속하는지, tenant·민감정보·보존 기간·열람 permission set을 함께 선언하지 않으면 CI에서 거절한다.

### 데이터·RLS 계획

핵심 테이블:

- `companies(id, name, slug, status, created_at)`
- `job_posts(id, company_id, slug, title, description, work_type, closes_at, published_at)`
- `applications(id, company_id, job_post_id, receipt_number, deletion_secret_hash, deletion_secret_pepper_version, deletion_secret_used_at, applicant_name, applicant_email, status, row_version, privacy_notice_version, notice_acknowledged_at, deletion_due_at, created_at)`
- `upload_intents(id, company_id, application_id, object_key, object_version_id, expected_media_type, expires_at, state, failure_code, created_at, updated_at)`
- `resumes(id, company_id, application_id, upload_intent_id, bucket, object_key, object_version_id, sha256, media_type, size_bytes, verification_status, created_at)`
- `memberships(id, entra_tenant_id, entra_object_id, company_id nullable, role, active, membership_version)`
- `sessions(id_hash, entra_tenant_id, entra_object_id, membership_version, idle_expires_at, absolute_expires_at, revoked_at)`
- `application_status_events(id, company_id, application_id, actor_tenant_id, actor_object_id, from_status, to_status, expected_row_version, occurred_at)`
- `privacy_requests(id, company_id, application_id, request_type, status, requested_at, completed_at)`
- `audit_events(id, company_id nullable, actor_subject nullable, action, target_type, target_id, metadata_json, occurred_at)`

DB 역할은 다음 세 개로 분리한다.

- `chibbo_owner`: `NOLOGIN`. schema/table/function/policy owner이며 runtime secret이 없다.
- `chibbo_migrator`: migration task만 사용하는 `LOGIN` 역할. `chibbo_owner`로 제한된 `SET ROLE`이 가능하고 일반 ECS task에는 secret이 주어지지 않는다.
- `chibbo_app`: runtime 전용 `LOGIN` 역할. table owner도 아니고 `BYPASSRLS`, role creation, `SET ROLE` 권한도 없다.

모든 tenant-owned 테이블은 `ENABLE ROW LEVEL SECURITY`와 `FORCE ROW LEVEL SECURITY`를 함께 적용하고, SELECT/UPDATE/DELETE의 `USING`과 INSERT/UPDATE의 `WITH CHECK`를 각각 선언한다. database/schema/table/sequence/function의 `PUBLIC` 권한을 회수하고 필요한 CRUD 또는 `EXECUTE`만 `chibbo_app`에 부여한다. 요청마다 DB transaction에서 검증된 세션 멤버십으로 `set_config('app.company_id', ..., true)`와 principal/role context를 `LOCAL`로 설정하며, context 누락·빈 값·잘못된 UUID는 default-deny다.

일반 담당자 경로는 tenant transaction helper만 사용한다. 공개 공고·지원 경로는 전역 unique slug를 믿지 않고 `/companies/{companySlug}/jobs/{jobSlug}` composite scope를 사용하며, published job 조회와 `draft_upload` 생성만 허용하는 고정 signature의 DB API 함수를 사용한다. platform admin은 일반 tenant helper나 임의 `company_id` 변경을 사용하지 않고, `(tid, oid)`가 active platform-admin membership인지 재검증하는 별도 admin DB API 함수만 사용한다. 이 함수들은 고정 `search_path`, 동적 SQL 금지, `PUBLIC EXECUTE` 회수, 최소 반환 필드를 적용한다.

지원 상태에는 staff 목록에서 제외되는 `draft_upload`가 포함되며, 유효한 이력서 finalize가 끝난 동일 업무 흐름에서만 `submitted`로 전환된다. 이후 `submitted → reviewing → accepted|rejected` 전이는 `row_version`을 조건으로 갱신해 동시 수정 충돌을 `409`로 반환한다.

접수 성공 시 CSPRNG로 256-bit 삭제 secret을 만들고 base64url 평문은 성공 화면에서 정확히 한 번만 보여 준다. DB에는 Secrets Manager의 versioned pepper를 사용한 HMAC-SHA-256 hash와 pepper version만 저장하며 평문은 로그, telemetry, audit metadata에 남기지 않는다. 공개 삭제 요청은 `receipt_number + deletion_secret`을 함께 요구하고 constant-time hash 비교, rate limit, 동일한 성공/실패 외형을 사용한다. 유효한 요청이 접수되면 `deletion_secret_used_at`을 원자적으로 기록해 재사용을 거절한다. receipt number 단독은 조회·삭제 권한이 아니다. 향후 이메일 인증이 도입되면 이 방식은 단기 1회성 링크로 대체한다.

### Entra OIDC·세션·캐시 경계

- Entra 앱은 치뽀 단일 tenant 전용이며 고객사 담당자는 해당 tenant의 B2B guest로 초대한다. 허용 tenant ID는 하나로 고정한다.
- 고객사 A 담당자와 고객사 B 담당자는 서로 다른 실제 Entra B2B guest 2명이다. 각 guest에는 팀이 수신·제어하는 별도 이메일이 필요하며 초대 수락, MFA/tenant 정책 통과, 최종 `(tid, oid)` 확인 뒤 각기 다른 `company_id` membership을 연결한다. 이 둘은 아래 5명의 AWS IAM Identity Center workforce user와 별개이며 AWS permission set을 받지 않는다.
- 권한 주체의 유일키는 `(tid, oid)`다. 이메일, UPN, display name, guest invitation email은 표시·연락 정보일 뿐 membership key나 권한 조건으로 사용하지 않는다.
- Authorization Code + PKCE를 사용하고 issuer, audience, tenant allowlist, `state`, `nonce`, code verifier를 검증한다.
- 브라우저에는 256-bit opaque session ID만 `HttpOnly; Secure; SameSite=Lax` cookie로 저장한다. DB에는 ID hash와 `(tid, oid)`, membership version을 저장하며 30분 idle/8시간 absolute expiry, 로그인·권한 상승 시 rotation, 로그아웃·membership 변경 시 해당 principal 세션 전부 revoke를 적용한다. mutation은 same-origin/CSRF token도 검증한다.
- staff/admin route, API, server action, membership/session 조회는 `Cache-Control: private, no-store`와 dynamic rendering을 강제한다. `proxy.ts`는 로그인 유무와 UX redirect만 처리하며 인가 결정을 내리지 않는다.
- 첫 버전에는 인증 데이터 cache를 두지 않는다. 이후 도입할 경우 key에 `tid`, `oid`, `company_id`, role, membership version, resource ID를 모두 포함하고 membership 변경 트랜잭션에서 즉시 무효화해야 한다. 공개 published job만 `{companySlug, jobSlug}` 키로 최대 60초 캐시할 수 있고 지원서/지원자/멤버십 데이터는 절대 섞지 않는다.

### 이력서 업로드 상태 전이

```text
init 요청
  → 서버가 company/job을 확인하고 draft_upload application + upload_intent(issued) 생성
  → 서버가 UUID exact key 발급
  → 5분 presigned POST (quarantine/<uuid>, 최대 5 MiB, exact key/type/SSE-KMS key/intent metadata)
  → 브라우저가 private S3로 직접 업로드
  → CORS로 노출한 x-amz-version-id를 finalize에 제출
  → 서버가 intent row를 잠그고 uploaded → verifying 전이
  → 서버가 지정 VersionId의 metadata/크기/실제 형식/해시 검증
  → 통과: accepted/<company>/<application>/<uuid>로 해당 VersionId만 서버측 copy
  → DB에 accepted VersionId와 resume 연결, application을 submitted로 전환
  → quarantine의 모든 version/delete marker 삭제
  → 실패: rejected 기록, 모든 관련 version 삭제, 지원 접수 미완료
```

presigned POST policy는 exact key, `content-length-range` 1 byte~5 MiB, 허용 Content-Type, `x-amz-server-side-encryption=aws:kms`, exact `x-amz-server-side-encryption-aws-kms-key-id`, upload intent ID metadata를 모두 equality/범위 조건으로 고정한다. 같은 POST를 replay해 새 version이 생기더라도 finalize는 row lock과 상태 조건으로 한 번만 성공하고 제출된 `VersionId`만 검증한다.

resume bucket CORS는 실제 배포 단일 HTTPS origin(예: `https://careers.<owned-domain>`)만 허용한다. 설정은 `AllowedMethods=[POST]`, `AllowedHeaders=[content-type, x-amz-algorithm, x-amz-credential, x-amz-date, x-amz-security-token, x-amz-server-side-encryption, x-amz-server-side-encryption-aws-kms-key-id, x-amz-meta-upload-intent-id]`, `ExposeHeaders=[x-amz-version-id]`, `MaxAgeSeconds=300`으로 고정한다. `AllowedOrigins`/headers의 `*`, `GET`, `HEAD`, accepted prefix의 browser read는 금지한다. S3는 허용 origin·POST·요청 header가 일치하는 preflight만 승인한다.

S3 copy 성공 후 DB commit 실패 시 accepted 객체를 삭제하는 saga 보상을 시도한다. 보상 실패, task crash, 만료 intent는 5분 주기 reconciler가 object metadata의 intent ID와 DB 상태를 비교해 orphan version을 삭제하거나 재처리한다. 개인정보 삭제 요청은 `ListObjectVersions`로 current/noncurrent versions와 delete marker를 모두 제거한 뒤에만 완료 상태가 된다. reconciler 횟수·실패·oldest orphan age를 metric으로 보낸다.

PDF는 파일 시그니처와 구조 최소 검사를, DOCX는 ZIP 컨테이너와 필수 OOXML 엔트리를 검사한다. 사용자 파일명은 객체 키로 사용하지 않고 표시용으로도 기본 비노출한다. 다운로드는 S3 CORS read나 공개 URL을 쓰지 않고, 권한을 확인한 application API가 S3 Range Get을 서버측 streaming한다. 응답은 `Content-Disposition: attachment`의 고정 안전 파일명과 `X-Content-Type-Options: nosniff`를 사용하며 감사 이벤트를 남긴다.

### 공개 endpoint rate limit과 quota

WAF를 보류하는 합성 PoC에서는 PostgreSQL 기반 sliding-window quota를 사용해 여러 ECS task에서도 동일하게 적용한다. IP 원문은 저장하지 않고 일별 회전 secret으로 HMAC한 값과 signed draft cookie를 사용한다. 기본값은 upload-init `10회/10분/IP-hash`, 동시 active intent `3개/draft`, application submit `5회/시간/IP-hash`, 공고별 `100건/일`이며 환경 설정으로만 조정한다. 초과는 `429`와 `Retry-After`를 반환하고 개인정보 필드·presigned form은 로그에 남기지 않는다. 외부 실제 지원자 공개 전에는 WAF managed rule/rate-based rule을 추가하는 별도 출시 게이트를 유지한다.

## 5. 파일 수준 구현 계획

### 저장소 기초

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`: workspace, 공통 명령, 잠금 파일.
- `.tool-versions` 또는 `.nvmrc`: Node 22 고정.
- `.env.example`: 이름만 제공하고 비밀값은 포함하지 않음.
- `.gitignore`, `.dockerignore`, `Dockerfile`: standalone production image와 불필요한 파일 제외.
- `README.md`: 로컬 실행, 합성 데이터 원칙, AWS/Entra 선행조건, 배포·복구 절차 링크.

### 애플리케이션

- `apps/platform/app/(public)/jobs/page.tsx`: 공개 공고 목록.
- `apps/platform/app/(public)/companies/[companySlug]/jobs/[jobSlug]/page.tsx`: 고객사 범위가 명시된 공고 상세와 지원 진입.
- `apps/platform/app/(public)/companies/[companySlug]/jobs/[jobSlug]/apply/page.tsx`: 최소 지원 폼과 업로드 진행 상태.
- `apps/platform/app/(staff)/dashboard/page.tsx`: 담당자 회사 범위 요약.
- `apps/platform/app/(staff)/applications/*`: 목록, 상세, 상태 변경, resume 다운로드.
- `apps/platform/app/(admin)/admin/companies/*`: 고객사·멤버십 관리.
- `apps/platform/app/api/public/*`: 공개 공고, upload init/finalize, 지원 제출.
- `apps/platform/app/api/staff/*`: tenant-scoped 지원서 조회/변경/다운로드.
- `apps/platform/app/api/admin/*`: platform-admin 전용 고객사·멤버십 관리.
- `apps/platform/proxy.ts`: Next.js 16의 세션 존재 확인과 화면 접근 UX 분기. 최종 인가는 각 server handler에서 재검증.
- `apps/platform/app/(staff)/layout.tsx`, `app/(admin)/layout.tsx`: dynamic rendering과 `no-store` 보안 header 고정.

### 공유 보안·도메인 패키지

- `packages/contracts/src/*`: 공개/직원 API Zod schema와 오류 코드.
- `packages/auth/src/entra.ts`: single-tenant+B2B OIDC 설정과 issuer/audience/tid/nonce/state/PKCE 검증.
- `packages/auth/src/session.ts`: opaque session ID hash, HttpOnly/Secure/SameSite cookie, rotation/revocation/expiry.
- `packages/auth/src/authorization.ts`: `(tid, oid)` membership 조회, company context, admin 판정, cache 금지.
- `packages/db/src/schema.ts`: 스키마.
- `packages/db/src/rls.ts`: tenant transaction helper, default-deny context와 admin/public 경계.
- `packages/db/migrations/*`: owner/migrator/app role, `FORCE RLS`, 양방향 policy, PUBLIC revoke를 포함한 expand/contract migration.
- `packages/domain/src/*`: 상태 전이, 접수번호, 256-bit 삭제 secret 발급·hash 검증, 삭제기한 정책.
- `packages/storage/src/resumes.ts`: exact-condition presigned POST, VersionId 고정, quarantine/finalize saga, 검증, 전 version 삭제, server-side 다운로드 stream.
- `packages/storage/src/reconciler.ts`: expired intent와 orphan S3 version 정리 및 metric.
- `packages/rate-limit/src/index.ts`: HMAC IP/draft 기반 public endpoint sliding-window quota.
- `packages/audit/src/index.ts`: 구조화 감사 이벤트와 민감정보 redaction.
- `packages/config/src/index.ts`: 환경변수 fail-fast 검증.

### 인프라

- `infra/bin/chibbo.ts`: 환경별 CDK app 진입점.
- `infra/lib/network-stack.ts`: `10.84.0.0/16`, subnets, route, endpoints, flow logs.
- `infra/lib/data-stack.ts`: RDS, KMS, Secrets Manager, resume/audit bucket.
- `infra/lib/service-stack.ts`: ECR, ECS cluster/service/task role, ALB, ACM/Route53 연결, autoscaling.
- `infra/lib/observability-stack.ts`: log groups, metric filters, alarms, dashboard, CloudTrail.
- `infra/lib/cost-controls-stack.ts`: cost allocation tags, 필수 월 Budget와 actual/forecast alerts.
- `infra/lib/deployment-identity-stack.ts`: GitHub OIDC provider, deploy role, CloudFormation execution role, migration task role과 PassRole 경계.
- `infra/lib/workforce-permissions-stack.ts`: permission set과 account assignment의 재현 가능한 정의. 사용자 생성은 별도 bootstrap 입력으로 분리.
- `scripts/bootstrap-identity-center.ts`: 5개 소유 이메일을 입력받아 사용자/그룹을 멱등 생성하고 ID를 출력; 비밀번호·토큰 저장 금지.
- `config/workforce.example.yaml`: 이름, 사용자명, 그룹, permission set만 포함하고 실제 이메일은 미포함.
- `config/workforce-permissions.yaml`: stack output ARN과 action allowlist 기반 permission matrix. `Action:"*"`, `Resource:"*"`, AWS managed `AdministratorAccess`는 schema validation에서 거절.
- `config/cost-assumptions.example.yaml`: region/AZ/ECS/RDS/NAT/ALB/log/S3 월 사용량 가정.

### CI/CD와 운영 문서

- `.github/workflows/ci.yml`: install, lint, typecheck, unit, integration, build, IaC synth/security checks.
- `.github/workflows/deploy.yml`: protected environment 승인 후 immutable GitHub OIDC claim으로 deploy role을 얻어 `expand → service deploy → smoke → contract 승인` 순서를 실행.
- `scripts/preflight-github-oidc.ts`: 실제 token의 immutable `sub`, owner/repo ID, `aud`, environment/ref를 출력값 redaction 상태로 검증.
- `scripts/preflight-identity-center.ts`: organization instance, identity source, IdentityStoreId, assignment 가능 계정과 MFA 책임 주체를 읽기 검증.
- `scripts/preflight-deploy.ts`: exact account/region/CIDR, active cost tags, Pricing evidence, Budget/수신자와 GitHub/Identity Center preflight를 gate.
- `docs/runbooks/deploy.md`, `rollback.md`, `restore-test.md`, `identity-center.md`, `entra-b2b.md`, `privacy-request.md`, `cost-estimate.md`, `shared-account-boundary.md`.
- `docs/architecture/tenant-boundary.md`, `resume-lifecycle.md`, `logging.md`, `database-roles.md`, `cache-boundary.md`.
- `docs/cost/<date>-<env>-pricing-inputs.json`, `docs/cost/<date>-<env>-estimate.md`: Pricing API/Calculator 원본과 가정·계산·승인 기록.

runbook에는 다음 복구·확인 절차를 반드시 포함한다.

- `identity-center.md`: organization instance/identity source/MFA 책임, 직원 이메일 5개 소유 확인, 역할별 허용 ARN/action, GRC/account-trail deny simulator 결과와 session revoke.
- `entra-b2b.md`: 고객사 A/B 이메일 2개 초대·수락·MFA, `(tid,oid)` 확인, membership 연결/비활성화, cross-tenant E2E.
- `privacy-request.md`: receipt+삭제 secret 확인, secret 재사용 금지, DB/S3 current·noncurrent·delete marker 제거와 감사 기록. 운영자가 secret 평문을 요청·기록하지 않는 절차.
- `resume-lifecycle.md`: exact CORS, ALB origin browser E2E, VersionId finalize, orphan reconciliation, server-side download.
- `shared-account-boundary.md`: 공유 quota/billing/management trail 한계, account security owner 연락 경로, GRC 원본 로그에 접근하지 않는 조사·redacted export 절차.
- `cost-estimate.md`/`deploy.md`: assumptions·Pricing evidence 갱신, active tags, Budget 수신 확인, exact account/region/CIDR preflight를 먼저 통과하고 그 뒤에만 `cdk diff`와 deploy를 실행하는 순서.

## 6. 실행 순서와 단계별 인수 기준

### 단계 1 — 모노레포·계약·로컬 기반

- workspace, exact Next.js 16 standalone, `proxy.ts`, 공통 패키지, Docker, CI 골격을 만든다.
- domain/API schema와 오류 형식을 먼저 고정한다.
- PostgreSQL과 S3 호환 로컬 통합 환경은 Docker Compose로 제공한다. 이는 테스트 대체물이 아니라 개발용 실행 환경이며 운영 smoke는 실제 AWS에서 별도로 수행한다.

인수 기준:

- clean checkout에서 한 명령으로 의존성 설치 후 lint/typecheck/unit/build가 성공한다.
- production image가 non-root 사용자로 기동하고 `/health/live`, `/health/ready`를 제공한다.
- lockfile 설치 후 Next.js/Node/package version이 CI와 container에서 동일하다.
- staff/admin route와 API 응답은 dynamic/no-store이고 공개 공고 외 server data cache가 없다.
- 저장소에 비밀값과 실제 개인정보가 없다.

### 단계 2 — DB, RLS, seed

- owner/migrator/app role, migration, FORCE RLS, tenant transaction helper, public/admin 제한 함수, 2개 고객사/3개 공고/15개 합성 지원자/5개 합성 이력서 seed를 구현한다.
- seed는 명시적인 synthetic 표기와 고정 fixture를 사용한다.

인수 기준:

- `chibbo_owner`는 NOLOGIN이고, ECS runtime은 `chibbo_app` secret만 읽으며 migration task만 `chibbo_migrator` secret을 읽는다.
- `chibbo_app`은 owner, `BYPASSRLS`, `SET ROLE`, DDL 권한이 없고 `PUBLIC`에는 database/schema/table/sequence/function 접근권한이 없다.
- 모든 tenant table은 `ENABLE`+`FORCE RLS`, SELECT/UPDATE/DELETE `USING`, INSERT/UPDATE `WITH CHECK`가 존재한다.
- tenant context 없는 SELECT/INSERT/UPDATE/DELETE는 0행 또는 정책 오류다.
- A context에서 B의 application/job/resume/status event를 직접 조회·수정할 수 없다.
- 공개 DB 함수는 published composite company/job만 읽고 `draft_upload`만 만들며, admin DB 함수는 active `(tid, oid)` platform-admin 외에는 거절된다.
- migration up과 빈 DB 재구축이 반복 성공한다.

### 단계 3 — 공개 지원 흐름과 이력서 수명주기

- 회사 범위 공개 공고, 지원 폼, `upload_intents`, exact presigned POST, VersionId finalize 검증, saga/reconciler, 접수 생성과 접수번호를 구현한다.
- 개인정보 고지 version과 동의 시각을 함께 저장한다.

인수 기준:

- 5 MiB 이하 합성 PDF/DOCX의 지정 VersionId만 accepted 상태가 된다.
- 초과 크기, 위장 확장자, 임의 key, 잘못된 metadata/SSE, 만료/재사용 POST·finalize는 거절되고 accepted DB row가 남지 않는다.
- 하나의 intent는 row lock/state compare로 한 번만 finalized되고, replay로 생긴 다른 S3 version은 reconciler가 제거한다.
- S3 copy/DB commit/quarantine delete 각 실패 지점에서 saga 또는 reconciler가 수렴하며 orphan oldest age가 경보 기준을 넘지 않는다.
- 개인정보 삭제 완료 후 exact object key의 current/noncurrent versions와 delete marker가 모두 0개다.
- 접수 성공 응답에서 256-bit 삭제 secret이 한 번만 보이고 DB·로그에는 평문이 없으며, receipt+secret 최초 요청만 privacy request를 만들고 재사용·오답·receipt 단독 요청은 동일 외형으로 거절된다.
- 버킷은 anonymous/public read가 불가능하며 객체 키에 이름·이메일·원본 파일명이 없다.
- resume bucket CORS에는 실제 HTTPS app origin 하나와 POST/필수 header/`x-amz-version-id` expose만 있고 wildcard·GET·HEAD가 없다.
- 성공 제출은 `draft_upload → submitted`, upload intent, resume VersionId, audit event가 같은 correlation ID로 추적된다.
- public rate limit/quota 초과는 `429`+`Retry-After`이고, 다른 ECS task에서도 공유된다.

### 단계 4 — Entra OIDC와 담당자/관리자 화면

- 실제 치뽀 Entra tenant의 single-tenant app registration과 고객사 B2B guest를 사용한다.
- 서버가 `(tid, oid)`를 membership에 매핑하고 company context를 만든다.
- 담당자와 platform admin UI/API를 구현한다.

인수 기준:

- 잘못된 issuer/audience/tid/state/nonce/PKCE와 비활성 membership은 거절되고 이메일/UPN 변경은 권한에 영향을 주지 않는다.
- 고객사 A/B는 팀이 수신 가능한 서로 다른 이메일의 B2B guest 2명이고, 각각 초대 수락·MFA/tenant policy·실제 로그인·서로 다른 `(tid,oid)`와 `company_id` membership 연결을 증명한다. 하나라도 없으면 cross-tenant 실제 E2E는 완료 처리하지 않는다.
- 브라우저 cookie에는 opaque ID만 있고 token/claim/권한정보가 없으며, idle 30분·absolute 8시간·rotation·revocation을 만족한다.
- membership 변경/비활성화는 관련 세션을 revoke해 다음 요청에 반영되고 no-store 응답에서 이전 tenant 데이터가 재사용되지 않는다.
- A 담당자의 B 리소스 GET/PATCH/download는 모두 동일한 `404`이고 존재 여부가 노출되지 않는다.
- 상태 전이는 `submitted → reviewing → accepted|rejected`만 허용되고 stale `row_version`은 `409`, 성공은 `(tid,oid)` actor/from/to/time 감사 이벤트가 남는다.
- platform admin의 멤버십 변경은 별도 감사 이벤트이며 지원서 원문을 기본 목록에서 노출하지 않는다.

### 단계 5 — AWS 인프라와 관측성

- 신규 VPC, S3 gateway endpoint, RDS, S3, ECS/ALB, CloudWatch, CloudTrail, Flow Logs를 CDK로 만든다. Entra outbound 때문에 NAT 1개는 유지하고 interface endpoint는 초기 생성하지 않는다.
- dev와 prod 이름/태그/secret을 분리한다. 첫 실배포는 synthetic 전용 dev 환경이다.

인수 기준:

- VPC CIDR가 정확히 `10.84.0.0/16`이고 GapZer0 VPC와 route/SG/리소스를 공유하지 않는다.
- ALB만 public subnet에 있고 ECS는 private, RDS는 isolated/public=false다.
- S3 Block Public Access 4항목, encryption, versioning, lifecycle가 켜져 있다.
- 로그 목적지와 보존은 다음과 같이 고정한다: ECS app `/chibbo/<env>/app` CloudWatch 30일, security/audit `/chibbo/<env>/audit` CloudWatch 90일, VPC Flow Logs CloudWatch 30일, ALB access log audit S3 90일 후 Glacier·365일 삭제, 치뽀 resume bucket object-level CloudTrail data event audit S3 365일.
- 치뽀 trail은 `IncludeManagementEvents=false`이고 selector는 resume bucket의 object-level read/write만 포함한다. 기존 account management trail과 GRC 원본 bucket/KMS에는 어떤 치뽀 workforce role도 접근하지 않는다.
- resume bucket data event, VPC Flow Logs, ALB access log, 앱 감사 로그가 각각 실제 한 건 이상 목적지와 보존 설정까지 확인된다. account management event는 account security owner가 별도 확인하며 치뽀 독립 로그로 주장하지 않는다.
- 5xx, unhealthy task, RDS storage/CPU, authentication failure 급증에 경보가 존재한다.
- rate-limit 429, rejected upload, reconciler failure/oldest orphan age에도 metric/경보가 존재한다.
- RDS 자동 백업 7일과 별도 restore test runbook이 있다.
- `cdk diff`와 별도로 account/region/AZ/task/RDS/NAT/ALB/log/S3 가정, 조회일, Pricing API 원본 또는 Calculator URL, 월 추정치와 변동요인을 보존한다.
- `Project`, `Environment`, `CostCenter` cost allocation tag가 활성화·적용되고 필수 월 Budget의 actual 50/80/100%·forecast 100% 알림과 팀 소유 수신자가 존재한다. 이 비용/preflight 증거 없이는 deploy가 시작되지 않는다.

### 단계 6 — 직원 AWS 신원과 GitHub 배포

- 먼저 `list-instances`로 organization instance/IdentityStoreId, identity source, MFA 책임 주체, account assignment 가능 여부를 검증한 뒤 직원별 새 Identity Center user/group/permission set을 구성한다.
- GitHub Actions OIDC 실제 token claim을 확인하고 repository의 immutable subject opt-in/적용 상태를 검증한 뒤 trust를 만든다. repository가 2026-07-15 이후 생성되어 immutable format을 사용하면 `repo:whs4-GapZer0@<owner_id>/virtual_chibbo@<repo_id>:environment:<env>` 형식의 exact `sub`, `aud=sts.amazonaws.com`, 별도 `environment`와 `ref=refs/heads/main` 조건을 함께 요구한다.
- deploy role, CloudFormation execution role, migration ECS task role, application ECS task role을 분리한다. PR과 fork workflow는 어떤 deploy/migration role도 assume할 수 없다.

직원 매핑:

| 직원 | username | 그룹 / permission set | 금지 경계 |
| --- | --- | --- | --- |
| 칠은서 | `chibbo-ceo` | `Chibbo-Approval` | 직접 production 변경 금지 |
| 삼재윤 | `chibbo-cloud-engineer` | `Chibbo-Platform-Operator` | IAM/permission set 변경 금지 |
| 두경금 | `chibbo-release-engineer` | `Chibbo-Release-Operator` | 장기 키·임의 role 생성 금지 |
| 정세일 | `chibbo-security-privacy` | `Chibbo-Security-Auditor` | 변경 권한 금지 |
| 청석현 | `chibbo-ops-partner` | `Chibbo-Asset-Viewer` | 운영 변경 금지 |

workforce permission set은 CDK stack output의 exact ARN을 입력으로 생성하고 AWS managed `AdministratorAccess`, `PowerUserAccess`, `Action:"*"`, `Resource:"*"`를 금지한다. AWS API가 resource-level permission을 지원하지 않는 경우 해당 API를 permission set에서 제외하고 치뽀 전용 dashboard/export로 제공한다. 각 permission set의 허용표는 다음과 같다.

| Permission set | 허용 action | 허용 resource ARN 범위 |
| --- | --- | --- |
| `Chibbo-Approval` | `cloudformation:DescribeStacks`, `ecs:DescribeServices` | CDK output에 열거된 network/data/service/observability stack ARN과 해당 환경의 service ARN만 |
| `Chibbo-Platform-Operator` | `ecs:DescribeServices`, `logs:GetLogEvents`, `logs:FilterLogEvents` | chibbo service ARN과 plan에서 출력한 exact `/chibbo/<env>/app` log group/stream ARN. task discovery와 계정 전역 metric 조회는 curated dashboard로 대체 |
| `Chibbo-Release-Operator` | `ecr:DescribeImages`, `ecr:BatchGetImage`, `cloudformation:DescribeStacks`, `cloudformation:DescribeStackEvents`, `ecs:DescribeServices` | CDK output의 해당 환경 ECR repository, 명시된 stack 목록, service ARN. 실제 변경은 GitHub protected deployment만 수행 |
| `Chibbo-Security-Auditor` | `s3:ListBucket`, `s3:GetObject`, `kms:Decrypt`, `logs:GetLogEvents`, `logs:FilterLogEvents`, `cloudtrail:GetTrailStatus` | 해당 환경 audit bucket과 `cloudtrail/chibbo/<env>/` object prefix(`ListBucket`은 동일 prefix condition), audit KMS key, `/chibbo/<env>/audit` log group/stream, chibbo data-event trail ARN |
| `Chibbo-Asset-Viewer` | `resource-explorer-2:Search`, `resource-explorer-2:GetView` | `Project=virtual-chibbo`만 노출하는 chibbo Resource Explorer view ARN |

이 표에 없는 action은 implicit deny다. 생성 전 IAM policy validation과 simulator를 실행해 대표 GRC VPC/ECS/RDS/S3/CloudTrail/KMS ARN에 대한 모든 표 action이 denied인지 확인한다. GRC ARN inventory는 읽기 전용 preflight 입력이며 치뽀 policy에 allow로 포함하지 않는다. account management trail/bucket/KMS ARN도 Security Auditor를 포함해 명시적으로 허용하지 않는다.

인수 기준:

- 기존 GRC IAM user와 root에 치뽀 운영 정책이 추가되지 않는다.
- Identity Center는 organization instance이며, account instance이거나 외부 identity source 때문에 API user 생성 책임이 다른 경우 자동 생성을 중단하고 해당 provisioning owner를 기록한다.
- 5개 사용자는 각각 고유한 팀 소유 이메일로 활성화되고 MFA 등록 후 로그인 검증된다. 이메일이 없으면 이 항목만 blocked로 명시하며 가짜 이메일로 완료 처리하지 않는다.
- native Identity Center이면 Identity Center MFA 정책, 외부 IdP이면 해당 IdP MFA 정책과 책임자를 증거로 남긴다.
- permission set session은 시간 제한이고 사용자에게 access key가 발급되지 않는다.
- 5개 workforce user는 위 permission matrix만 받고, 고객사 A/B Entra guest 2명은 AWS account assignment가 0개다. permission set JSON에 Admin/PowerUser, `Action:*`, `Resource:*`, GRC ARN allow가 0개이고 simulator의 GRC 표본 결과가 모두 explicit/implicit deny다.
- GitHub workflow에는 AWS access key secret이 없고 실제 token의 immutable owner/repo IDs, `sub`, `aud`, environment, ref가 trust와 정확히 일치한다.
- deploy role은 artifact/ECR와 CloudFormation 호출만, CloudFormation execution role은 stack resources만, migration role은 migrator secret/RDS network만, app task role은 app secret/S3 runtime path만 접근한다. deploy role의 `iam:PassRole`은 명시된 execution/task role ARN으로 제한한다.
- workflow는 `expand migration 성공 → ECS service deploy → health/smoke 성공 → 별도 승인된 contract migration` 순서다. expand 실패는 service update를 시작하지 않고, contract는 최소 한 배포 버전의 rollback window와 backward-compatibility 확인 후에만 실행된다.

### 단계 7 — 실제 환경 E2E와 운영 인계

- 실제 dev ALB/custom-domain URL에서 지원자와 두 고객사 Entra B2B guest를 사용하고, 별도로 다섯 AWS workforce 역할의 접근 경계를 검증한다.
- 배포, rollback, DB restore, 개인정보 삭제 요청 runbook을 실행 기록과 함께 검증한다.

인수 기준:

- 공개 지원→이력서 검증→담당자 검토→상태 변경 흐름이 실제 AWS에서 성공한다.
- 실제 HTTPS app origin의 브라우저가 S3 OPTIONS preflight→presigned POST→노출된 `x-amz-version-id` 읽기→finalize를 성공한다. 다른 origin, GET/HEAD CORS와 허용되지 않은 header는 실패한다.
- 접수 화면에서 한 번 표시된 삭제 secret과 receipt로 삭제 요청을 접수하고, 같은 secret 재사용은 실패하며 runbook대로 모든 DB/S3 version 삭제가 확인된다.
- 교차 tenant URL/API/object key 공격 행렬이 실제 환경에서 전부 차단된다.
- 고객사 A/B B2B guest 각각의 초대 수락, 실제 `(tid,oid)`, 서로 다른 membership과 교차 tenant 404가 확인된다. 합성 token만으로 이 항목을 완료 처리하지 않는다.
- 5개 workforce identity 각각의 허용 action은 성공하고 GRC 표본 ARN, account management trail, 다른 permission set의 action은 실패한다.
- 새 RDS 인스턴스로 PITR 복구하고 목표 RTO/RPO가 아니라 실제 측정값을 기록한다.
- 서비스/CloudTrail/Flow Log/배포 로그에서 동일 시나리오를 상관관계 ID로 추적할 수 있다.

## 7. 확장 테스트 계획

### 단위 테스트

- application 상태 전이와 불법 전이
- 접수번호 충돌/형식
- 256-bit 삭제 secret entropy/한 번 표시, HMAC pepper version, constant-time 비교, consume/replay 상태
- email normalization 및 로그 redaction
- OIDC issuer/audience/tid/state/nonce/PKCE, `(tid,oid)` role/membership mapping, 이메일 변경 무관성
- opaque session rotation, idle/absolute expiry, membership-version revoke
- tenant context 필수화와 admin boundary
- no-store/dynamic route policy와 public cache key 범위
- object key 생성이 PII를 포함하지 않음
- PDF/DOCX signature/structure, size, SHA-256 검증
- upload intent 상태기계, finalize idempotency, VersionId mismatch, saga 보상 결정
- HMAC IP/draft rate limit window와 quota 경계
- retention/deletion due 계산은 정책 설정을 사용하고 법정 기간으로 하드코딩하지 않음

### 통합 테스트

- 실제 PostgreSQL container에 owner/migrator/app role migration과 `FORCE RLS`를 적용한 A/B tenant matrix
- app role의 owner/BYPASSRLS/SET ROLE/DDL/Public 권한 부재, context 누락, 위조 `company_id`, 직접 SQL ID 접근, stale membership
- public/admin DB 함수의 signature, fixed search_path, EXECUTE grant, unpublished job/draft/admin 거부
- S3 호환 통합 환경에서 exact POST policy(key/type/size/SSE/intent metadata), expiry, replay로 생성된 복수 version, 지정 VersionId finalize, quarantine 전 version cleanup
- CORS 설정에 배포 origin+POST+exact headers+VersionId expose만 존재하고 wildcard/GET/HEAD가 없다는 template assertion
- S3 copy 성공/DB commit 실패, DB finalize 성공/quarantine delete 실패, reconciler 재실행의 멱등성과 최종 수렴
- 개인정보 삭제 시 current/noncurrent versions/delete markers 전부 제거
- receipt 단독/잘못된 secret/재사용 secret은 동일 외형으로 실패하고 올바른 receipt+secret 최초 요청만 privacy request 생성
- transaction 실패 시 application/upload_intent/resume/audit 일관성
- OIDC callback은 로컬 테스트 issuer 또는 signed fixture로 protocol validation; 실제 Entra smoke는 별도 수행
- session store에서 membership revoke 후 다음 요청 거부와 인증 응답 no-store
- CDK synth와 security assertion: public RDS/bucket/broad ingress 금지, S3 gateway endpoint 존재, interface endpoint 부재, 로그 retention, CloudTrail resume selector, 네 IAM role 분리와 제한된 PassRole

### 브라우저 E2E

- 지원자: 공고 목록→상세→동의→파일→접수 확인
- 접수 성공의 삭제 secret 한 번 표시→새 브라우저에서 receipt+secret 삭제 요청→재사용 실패
- 접근성: 키보드, label/error association, 업로드 진행/실패 announcement, 색상만으로 상태 표현하지 않음
- 담당자 A/B 로그인과 자기 회사 필터
- 동일 브라우저에서 A logout→B login, membership 비활성화, back button/reload 시 A 데이터 cache 노출 없음
- 직접 URL로 타 고객사 application 접근, 상태 변경, resume download 시 모두 404
- admin 고객사/멤버십 생성·비활성화 후 즉시 세션 권한 반영
- 동시에 두 담당자가 같은 지원서를 갱신할 때 하나만 성공하고 stale 요청은 409
- 중복 제출, POST replay, finalize 동시 재시도의 idempotency
- 배포된 ALB/custom-domain origin에서 실제 S3 preflight→POST→`x-amz-version-id` 접근→finalize 성공; 임의 origin과 GET/HEAD preflight 실패

### 보안·회귀 테스트

- IDOR/BOLA 전 endpoint 표
- SQL injection, stored/reflected XSS, CSRF, open redirect
- 원본 파일명 path traversal, polyglot/invalid DOCX, content-type spoof, oversized upload
- presigned form key 변조, 만료, 재사용, accepted object 직접 접근
- `VersionId` 바꿔치기, intent metadata 변조, noncurrent malicious version 잔존
- Entra 타 tenant token, 같은 이메일의 다른 oid, oid가 같은 것처럼 보이는 display field 변조
- session fixation, CSRF, revoked session, cache poisoning/tenant cache key collision
- 삭제 secret brute force/rate-limit, receipt enumeration, hash timing 차이, used secret replay
- 로그에 이름·이메일·삭제 secret·OIDC token·presigned form/URL이 남지 않음
- dependency/SAST/secret scan과 container image scan

### 실제 AWS/관측성 시험

- ALB access log와 app correlation ID 연결
- ECS task 재시작 중 readiness와 무중단 배포 확인
- RDS connection exhaustion/5xx 시 경보
- 비정상 로그인 및 연속 404 권한 공격의 metric/log 확인
- 치뽀 trail에 resume S3 data event는 존재하고 management event/GRC bucket event는 없으며, 치뽀 5개 workforce role로 기존 account trail/bucket/KMS 접근이 거부됨을 확인
- account management event 검증은 account security owner의 별도 증거로만 기록하고 치뽀 trail 수집으로 표기하지 않음
- GitHub actual OIDC token의 immutable `sub` owner/repo IDs, aud, environment/ref와 PR assume-role 거부 확인
- expand migration 실패 시 ECS service revision이 바뀌지 않고, contract migration이 승인/rollback window 전 실행되지 않음을 확인
- Flow Logs에서 ALB→ECS, ECS→RDS 허용 경로와 거부 이벤트 확인
- S3 public access 차단과 RDS public=false를 AWS API로 재검증
- app/audit/flow/ALB/CloudTrail 로그 목적지와 30/90/365일 보존, resume-only data selector를 AWS API로 재검증
- NAT 처리량·비용 metric과 interface endpoint 미생성, S3 gateway endpoint route를 확인
- IAM simulator에서 5개 workforce permission set의 표 action/치뽀 ARN은 역할별 예상대로이고 GRC 표본 ARN·account trail은 모두 deny, Entra guest 2명은 AWS assignment 0개임을 확인
- Pricing API/Calculator 원본의 region·조회일·단가와 assumptions 계산 재현, active cost allocation tags, Budget actual/forecast alert와 팀 수신 확인

## 8. Pre-mortem

### 실패 시나리오 1 — 고객사 A가 B의 지원서를 조회

- 원인: handler 하나가 URL의 `company_id`를 신뢰하거나 RLS context 없이 DB pool을 직접 사용.
- 조기 신호: 쿼리 함수가 tenant transaction helper 밖에서 호출됨, 테스트에서 B ID가 `403` 또는 데이터 반환.
- 예방: DB package 외 직접 SQL import 금지, 모든 tenant table RLS, A/B 전 endpoint matrix를 CI 필수 gate로 설정.
- 복구: affected endpoint 차단, audit/S3 download log로 범위 파악, membership/session revoke, 회귀시험 후 재배포.

### 실패 시나리오 2 — 악성/위장 파일이 accepted 영역에 저장

- 원인: Content-Type/확장자만 검사하거나 replay가 만든 최신 version을 잘못 검증하거나 S3/DB 부분 실패를 방치.
- 조기 신호: expired/verifying intent 증가, quarantine/accepted orphan age 증가, VersionId 불일치, verification_status 없는 resume row.
- 예방: exact POST policy, intent row lock, 지정 VersionId 검증, quarantine→검증→accepted 상태기계, saga와 reconciler, 실패 시 DB 연결 금지.
- 복구: intent별 모든 current/noncurrent version을 격리·삭제하고 관련 다운로드 URL을 중단하며 감사 로그로 접근자를 확인한다. 실제 외부 공개 전 malware/CDR gate를 추가한다.

### 실패 시나리오 3 — 기존 GRC/root 권한이 치뽀 배포에 사용

- 원인: 이메일 준비 지연이나 CI 편의를 이유로 기존 access key를 재사용.
- 조기 신호: GitHub secret에 AWS key, CloudTrail principal이 root/기존 GRC user, permission set 외 role assumption.
- 예방: OIDC trust와 Identity Center를 배포 선행조건으로 두고 장기 키 탐지 CI를 실패 처리.
- 복구: key 즉시 비활성화/회전, CloudTrail 조사, OIDC role 재배포, 기존 principal의 치뽀 정책 제거.

### 실패 시나리오 4 — 멤버십 변경 뒤 이전 tenant 화면이 cache에서 노출

- 원인: staff page나 server fetch의 기본 cache를 사용하거나 cookie 주체만 보고 membership을 재검증하지 않음.
- 조기 신호: 계정 전환/back navigation에서 이전 회사 이름·지원자 노출, 비활성화 후 기존 session이 계속 성공.
- 예방: 인증 route/API no-store+dynamic, opaque session과 membership version 확인, 변경 시 principal session 전부 revoke.
- 복구: 관련 세션 전부 폐기, cache/CDN purge, access log로 범위를 확인하고 tenant-switch 회귀시험을 필수화한다.

### 실패 시나리오 5 — migration 또는 OIDC trust가 배포 경계를 넘어섬

- 원인: deploy role이 migration/runtime secret까지 가지거나 mutable repo name claim/wildcard ref를 신뢰하고 contract migration을 즉시 실행.
- 조기 신호: PR workflow의 AssumeRole 성공, role 하나에 광범위한 PassRole, expand 실패 뒤 새 task revision 배포, rollback이 contract schema에서 실패.
- 예방: immutable owner/repo ID가 포함된 exact sub+environment/ref, 네 역할 분리, expand→deploy→smoke→승인된 contract와 한 버전 rollback window.
- 복구: trust와 role session revoke, 배포 중단, expand-compatible 이전 image로 rollback, contract 전 snapshot/PITR로 복구한다.

### 실패 시나리오 6 — 공유 계정 로그·권한에서 GRC 정보가 노출

- 원인: 치뽀 trail에 management event를 켜거나 Security Auditor에 기존 account trail/bucket/KMS 또는 broad read 권한을 부여.
- 조기 신호: 치뽀 audit 검색에서 `gapzero-*` resource event가 보임, permission policy에 Admin/PowerUser/Action·Resource wildcard 또는 account trail ARN이 포함됨.
- 예방: 치뽀 trail은 resume S3 data event만 선택하고, ARN/action allowlist와 GRC 표본 IAM simulator deny를 deploy gate로 둔다.
- 복구: offending assignment/session revoke, audit bucket/KMS policy 차단, 접근 로그로 열람 범위 확인, permission set 재프로비저닝.

### 실패 시나리오 7 — 삭제 secret 또는 S3 CORS가 공개 데이터 경계를 약화

- 원인: receipt만으로 삭제 허용, secret 평문 로그, wildcard origin/header, accepted 객체 GET CORS 허용.
- 조기 신호: receipt enumeration 성공, 같은 secret 재사용, 임의 origin preflight 성공, browser가 accepted key를 직접 읽음.
- 예방: 256-bit one-time secret HMAC hash+constant-time 비교, exact origin/POST/header/VersionId CORS, server-side download stream, 실제 ALB browser E2E.
- 복구: pepper version 회전과 미사용 secret 무효화, CORS 즉시 축소, 관련 세션/intent 폐기, S3 access/CloudTrail data event로 범위 확인.

### 실패 시나리오 8 — 공유 계정 비용이 예상보다 증가

- 원인: `cdk diff`를 비용 견적으로 오인하거나 NAT/log/data event 사용량과 Budget 수신자를 확인하지 않음.
- 조기 신호: Pricing 증거 없이 deploy 승인, inactive cost tag, Budget/알림 미수신, NAT/CloudWatch 일별 증가.
- 예방: 고정 assumptions+Pricing API/Calculator 견적, active cost allocation tags, 필수 Budget actual/forecast alert, account/region/CIDR/cost preflight.
- 복구: 신규 배포 중단, ECS desired count/log retention/data event selector 검토, 비용 태그별 원인 분석 후 승인된 새 가정으로 재개.

## 9. 위험, 의존성, 중단 기준

### 실제 외부 의존성

- 소유·수신 가능한 AWS workforce 직원용 이메일 5개와 MFA 등록 참여
- IAM Identity Center organization instance, identity source, MFA 책임 주체와 target account assignment 가능 여부
- 치뽀 단일 Entra tenant의 app registration/B2B guest 초대 권한, redirect URI와 client credential/federated credential 선택
- 고객사 A/B 담당자용으로 팀이 실제 수신 가능한 서로 다른 이메일 2개, guest 초대 수락과 MFA/tenant policy 참여
- Route 53에서 관리 가능한 서비스 도메인과 ACM 검증
- AWS 배포 계정/리전 및 기존 `10.84.0.0/16` 충돌 확인
- GitHub immutable subject opt-in/claim 확인, protected environment/branch 설정 권한과 repository/owner numeric ID
- 대상 account의 Pricing API/Calculator·Billing/Budget·cost allocation tag 확인 권한, 필수 월 예산액과 팀 소유 Budget 알림 이메일

### 구현 중단 기준

- `10.84.0.0/16`이 기존 연결망과 충돌하면 인프라 생성 전에 CIDR 결정을 다시 한다.
- 실제 이메일을 팀이 소유하지 않으면 Identity Center 사용자를 가짜 주소로 활성화하지 않고 permission set/group까지만 준비한다.
- 고객사 A/B용 수신 이메일 2개와 실제 guest 수락이 없으면 합성 token으로 cross-tenant Entra E2E를 완료 처리하지 않는다.
- organization instance가 아니거나 identity source의 provisioning 책임이 외부에 있으면 사용자/account assignment 자동화를 중단하고 계정 구조 결정을 다시 한다.
- Entra OIDC 등록 권한이 없으면 fake login을 production 경로에 넣지 않고 로컬 protocol test와 명시적 blocker로 남긴다.
- 실제 GitHub token이 immutable `sub`, owner/repo ID, environment/ref 조건을 만족하지 않으면 deploy role trust를 만들지 않는다.
- Pricing evidence, active cost allocation tags, 월 Budget/actual·forecast 수신자, exact account/region/CIDR preflight 중 하나라도 없으면 실제 AWS deploy를 시작하지 않는다.
- 교차 tenant 테스트나 RLS 검증이 실패하면 AWS 배포 단계로 넘어가지 않는다.
- upload intent replay/orphan reconciliation 또는 expand migration gate가 실패하면 service deployment를 진행하지 않는다.
- 실제 개인정보를 넣으라는 요청이 오면 합성 데이터 범위에서 중단하고 별도 개인정보·법률 출시 검토를 연다.

## 10. 구현자 핸드오프

구현은 단계별로 작은 커밋을 유지하고, 각 단계 인수 기준이 녹색일 때만 다음 단계로 진행한다. 인프라 생성 전 `cdk diff`는 변경점 검토에만 사용하고, 비용은 별도 assumptions+Pricing API/Calculator 근거로 보고한다. 외부 리소스 생성, DNS 변경, 사용자 초대, production 배포는 로컬 코드 구현과 분리해 실제 대상·비용·rollback을 확인한 뒤 수행한다.

최종 PR에는 다음 증거가 필요하다.

- 변경 파일과 migration 목록
- unit/integration/E2E/빌드 결과
- A/B tenant 공격 행렬 결과
- CDK synth/diff와 AWS API 기반 보안 설정 확인
- 고객사 A/B Entra B2B 실제 login/`(tid,oid)`/membership, 5명 Identity Center MFA와 permission simulator, GitHub OIDC deploy 증거 또는 명시적 blocker
- 실제 ALB origin의 S3 CORS POST→VersionId→finalize와 삭제 secret 1회성 E2E
- Pricing 근거·assumptions·active cost tags·Budget/수신자 preflight 증거
- 로그/경보/restore test의 실제 실행 기록

## 11. 아키텍처 검토 반영 기록

2026-10-01 [`.omx/plans/chibbo-recruitment-service-architecture-review.md`](./chibbo-recruitment-service-architecture-review.md)의 **ITERATE** 판정에 따라 구현 시작 전 차단사항 여섯 개를 모두 보완했다.

1. `chibbo_owner`/`chibbo_migrator`/`chibbo_app`, `FORCE RLS`, `USING`+`WITH CHECK`, `PUBLIC` revoke, default-deny와 제한된 public/admin DB 경계를 명시했다.
2. Next.js 16 exact pin, `proxy.ts`, staff/admin/API no-store·dynamic, membership session revoke와 향후 tenant-aware cache key 규칙을 추가했다.
3. `upload_intents`, `draft_upload`, exact POST policy, 고정 VersionId, saga/reconciler, current/noncurrent/delete marker 삭제 계약을 추가했다.
4. single-tenant Entra+B2B guest, `(tid,oid)` membership, opaque session·PKCE·회전/만료/CSRF 계약을 추가했다.
5. Identity Center organization instance/MFA/email preflight와 2026 immutable GitHub OIDC subject(owner/repo ID), environment/ref 검증을 배포 선행조건으로 올렸다.
6. deploy/CloudFormation/migration/runtime 역할, expand→deploy→contract 순서, S3 gateway endpoint/비용 선택, 목적지별 로그 보존, public rate limit/quota를 확정했다.

이에 맞춰 단계별 인수 기준, unit/integration/E2E/security/AWS 시험과 pre-mortem을 확장했다. 남은 blocker는 구현 결함이 아니라 실제 이메일·Entra·Identity Center·DNS·GitHub/AWS 권한 및 대상 환경 확인이다.

## 12. Critic 검토 반영 기록

2026-10-01 [`.omx/plans/chibbo-recruitment-service-critic-review.md`](./chibbo-recruitment-service-critic-review.md)의 **ITERATE** 판정을 다음과 같이 반영했다.

1. 신규 VPC가 계정 격리가 아님을 명시하고 quota·billing·Identity Center·management trail 공유 한계와 치뽀 resume-data-event-only trail 접근 경계를 확정했다.
2. AWS workforce 5명과 고객사 A/B Entra B2B guest 2명을 분리하고, 7개 실제 이메일/초대 의존성과 ARN/action 기반 permission matrix·GRC deny 검증을 추가했다.
3. receipt와 함께 쓰는 256-bit 1회성 삭제 secret, HMAC hash 저장, constant-time 검증과 재사용 차단을 추가했다.
4. 실제 app origin만 허용하는 POST-only S3 CORS, exact headers, `x-amz-version-id` expose, server-side download와 실제 ALB browser E2E를 추가했다.
5. `cdk diff`와 비용 견적을 분리하고 Pricing API/Calculator assumptions, cost allocation tags, Budget actual/forecast alert를 실제 deploy gate로 올렸다.

연구·아키텍처·critic artifact의 상단 링크와 실제 저장 경로가 모두 일치함을 확인했다.
