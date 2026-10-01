# 치뽀 채용지원 서비스: 비즈니스·UI·운영환경 조사

조사일: 2026-10-01
적용 범위: 치뽀컴퍼니의 합성 데이터 기반 채용 지원서 접수 SaaS. 실제 지원자 개인정보를 받기 전의 PoC/초기 운영 설계다.

## 요약

1. **공유형 멀티테넌트 서비스로 시작한다.** 고객사마다 VPC나 별도 서비스를 만드는 것은 2개 고객사의 PoC에 과하다. 대신 인증된 사용자에서 검증한 `company_id`를 API, DB, 파일 키, 캐시 키, 감사 로그까지 계속 전달하고, 모든 경로에서 소유권을 확인한다. 신뢰도: 높음.
2. **지원자 흐름은 공고 상세 → 최소 입력 → 이력서 업로드 → 접수 확인으로 제한한다.** 고객사 담당자 화면은 자기 고객사의 공고·지원자 목록·상태 처리만 허용한다. 초기 버전에 AI 평가, 면접 일정, 결제, 인재 풀은 넣지 않는다. 신뢰도: 높음.
3. **이력서는 비공개 S3에 UUID 키로 저장한다.** PDF/DOCX만 허용하고 크기·실제 형식·해시를 검증한다. 브라우저는 짧게 만료되는 단일 객체 업로드 URL만 받으며, 다운로드는 권한 확인 뒤 별도 짧은 URL을 만든다. 신뢰도: 높음.
4. **AWS 인프라는 GRC와 신규 VPC `10.84.0.0/16`으로 분리한다.** 애플리케이션은 별도 치뽀 리소스와 태그를 사용하며, DB와 이력서 버킷은 인터넷에서 직접 접근할 수 없다. 신뢰도: 높음.
5. **직원 AWS 접근은 새 IAM Identity Center 신원과 권한 세트로 만든다.** 루트 계정이나 장기 액세스 키, 기존 GRC IAM 사용자를 치뽀 운영에 재사용하지 않는다. 실제 로그인 가능한 새 신원을 만들려면 각 가상 직원에 연결할, 팀이 실제로 제어하는 이메일 주소가 필요하다. 신뢰도: 높음.

## 조사 질문과 설계 결정

| 조사 각도 | 조사 결과 | 치뽀 적용 결정 |
| --- | --- | --- |
| 채용 SaaS 업무 흐름 | 외부 ATS의 공개 Job Board API는 공고별 지원, 이름/연락처/답변/이력서 첨부라는 간결한 흐름을 제공한다. | 지원자용 공고 상세·지원서 1개, 고객사 담당자용 지원자 목록·상태 변경, 치뽀 관리자용 고객사/담당자 관리의 세 화면으로 시작한다. |
| 테넌트 경계 | 로그인만으로는 격리가 되지 않으며, 테넌트 소유권을 모든 데이터 경로에서 강제하고 교차 테넌트 회귀 시험을 해야 한다. | `company_id`는 요청 본문이나 URL에서 신뢰하지 않는다. 서버가 검증한 세션의 멤버십에서 얻고, SQL 조건 및 PostgreSQL RLS로 이중 강제한다. |
| 파일 업로드 | 확장자·Content-Type만 믿으면 안 되며, 크기·서명·저장 파일명·권한·저장 위치를 통제해야 한다. | PDF/DOCX, 5 MiB, UUID 객체 키, SHA-256, private S3, 업로드 전후 검증을 사용한다. 공개 객체·사용자 지정 경로·영구 다운로드 URL은 금지한다. |
| AWS 격리·운영 | 공유 SaaS여도 전 계층의 격리와 테넌트별 관측이 필요하다. AWS 서비스 로그·앱 감사 로그·복구 시험은 서로 대체되지 않는다. | 치뽀 전용 VPC, RDS private subnet, S3 Public Access Block, CloudTrail·VPC Flow Logs·앱 감사 로그, RDS PITR을 구성한다. |
| 인력 AWS 접근 | IAM Identity Center permission set은 역할별 최소 권한과 제한된 세션을 제공하고 계정에 IAM role로 프로비저닝된다. | 새 가상직원 5명과 그룹/permission set을 치뽀 전용으로 만들고, MFA 등록을 요구한다. 기존 IAM users는 치뽀 운영 권한에 배정하지 않는다. |

## 사용자 경험 분석

### 지원자: 공고 열람과 지원

지원자는 계정을 만들지 않는다. 공고 상세에서 업무, 근무 형태, 지원 마감, 개인정보 고지, 허용 파일 형식을 확인한 뒤 아래만 제출한다.

- 이름
- 이메일
- 이력서(PDF/DOCX, 최대 5 MiB)
- 개인정보 수집·이용 고지 확인

제출 전에는 업로드 상태와 오류를 명확히 보이고, 제출 후에는 접수 번호·공고명·삭제 요청 경로만 보여 준다. 지원 상태 조회와 이력서 교체는 초기 범위에서 제외한다. 이는 개인정보 노출 면적과 권한 복잡도를 줄인다.

### 고객사 채용 담당자: 검토와 결과 처리

담당자는 Entra OIDC 로그인 후, 소속 고객사의 공고만 보게 된다. 첫 화면은 상태별 건수와 최근 지원 목록, 다음 화면은 지원자 상세·이력서 다운로드·`검토 중/합격/불합격` 전환이다.

- 공고 필터와 상태 필터를 먼저 둔다.
- 후보자 이름·이메일은 목록에서 최소한으로 노출한다.
- 이력서 다운로드는 서버 권한 확인 후에만 시작한다.
- 상태 변경은 누가·언제·이전값·새 값을 남긴다.
- 다른 고객사 `application_id`를 직접 요청해도 404로 응답한다.

### 치뽀 관리자: 고객사와 담당자 관리

관리자는 새 고객사, 담당자 멤버십, 역할을 관리한다. 고객사에 임의로 가입한 담당자는 없으며, 고객사 담당자 추가/삭제는 관리자 감사 이벤트가 된다. 이 화면에서는 지원서 원문을 기본으로 노출하지 않는다.

## 도메인 모델과 권한 모델

```text
Company (고객사/tenant)
 ├─ JobPost
 │   └─ Application ─ Resume object (S3)
 └─ Membership (Entra subject ↔ company ↔ role)

Chibbo platform admin ─ 모든 Company 관리
Company hiring manager ─ 자신이 속한 Company의 JobPost/Application만 관리
Applicant ─ 비로그인 상태에서 공개 JobPost에 지원만 가능
```

초기 핵심 데이터는 `companies`, `job_posts`, `applications`, `resumes`다. `memberships`는 Entra subject와 `company_id`·역할의 서버측 매핑으로 별도 보관한다. 모든 지원자/이력서 조회에는 현재 주체의 `company_id`가 요구된다.

### 권한 회귀시험 필수 행렬

| 주체 | 공고 열람 | 지원서 생성 | 자기 고객사 지원서 열람/상태 변경 | 타 고객사 지원서 열람/상태 변경 | 고객사·멤버 관리 |
| --- | --- | --- | --- | --- | --- |
| 비로그인 지원자 | 공개 공고만 | 허용 | 불가 | 불가 | 불가 |
| 고객사 A 담당자 | A 공고 | 불가 | 허용 | 반드시 404 | 불가 |
| 고객사 B 담당자 | B 공고 | 불가 | 허용 | 반드시 404 | 불가 |
| 치뽀 관리자 | 전체 | 불가 | 업무상 필요 경로만 | 업무상 필요 경로만 | 허용 |

## AWS 운영환경 결정

### 네트워크와 컴퓨팅

```text
Internet
  └─ CloudFront/ALB (public subnets)
       └─ ECS Fargate: chibbo-web-api (private app subnets)
            ├─ RDS PostgreSQL (private DB subnets, public access disabled)
            ├─ S3: resume bucket (public access blocked)
            ├─ CloudWatch Logs / alarms
            └─ Entra OIDC (outbound HTTPS)

CloudTrail + VPC Flow Logs ─► separate audit log bucket / CloudWatch
GitHub Actions OIDC ─► deployment role only
```

- VPC: `10.84.0.0/16` (기존 GRC 기본 VPC `172.31.0.0/16`와 분리)
- public: ALB만; app 및 DB는 private subnet
- DB: PostgreSQL, 암호화, 자동 백업 7일, public access 비활성화
- 파일: `chibbo-resumes-*` private bucket, Block Public Access, bucket owner enforced, 버전 관리와 lifecycle
- 로그: 애플리케이션 감사 이벤트는 CloudWatch, AWS control plane은 CloudTrail, 네트워크 메타데이터는 VPC Flow Logs
- 데이터: 합성 데이터만. 별도 `chibbo-sandbox`에서만 위험 설정·권한 우회 시나리오를 재현한다.

### AWS 직원 신원

| 가상 직원 | Identity Center 사용자명 | 그룹/권한 세트 | 운영 제약 |
| --- | --- | --- | --- |
| 칠은서 | `chibbo-ceo` | `Chibbo-Approval` | 위험·예외 승인, 리소스 직접 변경 불가 |
| 삼재윤 | `chibbo-cloud-engineer` | `Chibbo-Platform-Operator` | 앱·DB·로그 운영, IAM/권한 세트 변경 불가 |
| 두경금 | `chibbo-release-engineer` | `Chibbo-Release-Operator` | 승인된 배포 실행, 장기 AWS 키 없음 |
| 정세일 | `chibbo-security-privacy` | `Chibbo-Security-Auditor` | 읽기 감사·검토, 변경 권한 없음 |
| 청석현 | `chibbo-ops-partner` | `Chibbo-Asset-Viewer` | 자산·비용·태그 열람, 운영 변경 불가 |

Identity Center는 새 사용자의 실제 접근에 소유 가능한 이메일 주소 및 MFA 등록이 필요하다. 따라서 이메일이 없는 상태에서는 permission set과 그룹을 먼저 만들 수 있지만, 로그인 가능한 최종 계정 발급·초대는 팀이 제어하는 별칭이 준비된 뒤에 한다. 기존 GRC IAM user 또는 root 계정에 치뽀 권한을 덧붙이는 것은 금지한다.

## 반증 검토

| 주장 | 정확성 렌즈 | 출처 신뢰 렌즈 | 재현성 렌즈 | 결론 |
| --- | --- | --- | --- | --- |
| `company_id` 컬럼만 두면 테넌트 분리가 된다. | OWASP는 서버가 검증한 주체와 enforceable boundary를 요구한다. | AWS SaaS Lens도 인증·인가와 격리가 같지 않다고 명시한다. | 고객사 A/B로 교차 ID 요청을 자동 시험할 수 있다. | **폐기** |
| 이력서 버킷을 private로만 두면 업로드 보안이 끝난다. | OWASP는 allowlist, 크기, 실제 형식, 파일명, 저장 위치를 함께 요구한다. | AWS는 presigned URL이 발급 주체의 권한을 사용한다고 설명한다. | 확장자 위장·초과 크기·재사용 URL 시험이 가능하다. | **폐기** |
| 2개 고객사면 고객사마다 VPC/DB를 만들어야 한다. | AWS는 격리를 전체 스택의 강제 경계로 보며 공유 자원에서도 가능하다고 설명한다. | AWS SaaS Lens는 다양한 pool/silo 모델을 공식적으로 제시한다. | RLS+소유권 회귀시험으로 shared DB를 검증할 수 있다. | **과도하므로 폐기** |
| 루트 또는 기존 GRC IAM user에 새 권한만 추가하면 된다. | AWS는 최소 권한과 IAM Identity Center permission set을 권장한다. | Identity Center 문서는 계정 접근 시 IAM role이 생성됨을 명시한다. | 새 identity/group/permission set 목록과 CloudTrail에서 분리를 확인할 수 있다. | **폐기** |

## 구현에 반영할 비기능 기준

- `company_id`는 클라이언트 입력이 아니라 검증된 주체에서 유도한다.
- API의 404/403 응답은 타 테넌트 리소스의 존재 여부를 공개하지 않는다.
- 업로드는 PDF/DOCX allowlist, 5 MiB 제한, 매직바이트/MIME 검증, UUID 저장 키, SHA-256을 적용한다.
- presigned URL은 특정 키·단일 목적·짧은 만료로 생성하며 버킷 전체 공개를 대체하지 않는다.
- 파일 다운로드, 지원 상태 변경, 멤버십 변경, 삭제 처리에는 구조화 감사 이벤트를 남긴다.
- DB restore는 원본을 덮어쓰지 않는 새 인스턴스에서 하고, RTO/RPO 결과를 기록한다.
- 운영 신원은 IAM Identity Center + MFA, 애플리케이션 고객사 담당자는 Entra OIDC로 분리한다.

## 출처

- [AWS SaaS Lens — isolation mindset](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/isolation-mindset.html)
- [AWS SaaS Lens — general design principles](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/general-design-principles.html)
- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [OWASP Authorization Regression Testing Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Regression_Testing_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [AWS S3 presigned URL upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [AWS S3 access control and Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/user-guide/access-control-overview.html)
- [AWS IAM Identity Center permission sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsets.html)
- [AWS IAM Identity Center account assignments and MFA](https://docs.aws.amazon.com/singlesignon/latest/userguide/assignusers.html)
- [AWS RDS automated backups and point-in-time recovery](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [AWS incident-response logging baseline](https://docs.aws.amazon.com/whitepapers/latest/aws-security-incident-response-guide/aws-security-incident-response-guide.pdf)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)

## 한계와 보류 결정

- 실제 개인정보를 받는 상용 서비스의 법정 보유 기간, 수탁 계약, 국외 이전 여부는 고객 계약과 법률 검토가 필요하다. PoC에서는 기간을 임의로 법적 기준처럼 선언하지 않는다.
- 바이러스 검사/CDR은 실제 파일 업로드 공개 전 필수에 가깝지만, PoC의 합성 PDF/DOCX 5개에 대한 첫 구현은 검증·비공개 저장·다운로드 권한을 우선하고 스캔 워커를 후속 배포한다.
- Entra 애플리케이션 등록, 실제 회사 이메일 별칭, AWS Identity Center 초대 발송은 외부 테넌트 설정이므로 인프라 적용 단계에서 별도 검증한다.
