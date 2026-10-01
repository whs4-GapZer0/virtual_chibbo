# 치뽀 채용지원 서비스 컨텍스트 스냅샷

작성일: 2026-10-01

## 현재 상태

- 저장소는 사실상 비어 있으며 `docs/research/chibbo-recruitment-service-research.md`만 존재한다.
- 구현, AWS 리소스 생성, 외부 계정 생성, commit/push는 아직 하지 않았다.
- 상세 구현 계획: `.omx/plans/chibbo-recruitment-service-plan.md`

## 고정 요구사항

- 실제 서비스와 실제 AWS/Entra/GitHub 연동. 지원자 데이터와 이력서는 합성 데이터만.
- 공개 공고/지원, 고객사 담당자, 치뽀 관리자 3개 경험.
- 서버가 검증한 membership에서 `company_id`를 유도하고 SQL scope + PostgreSQL RLS로 이중 강제.
- private S3, 제한된 presigned POST, quarantine→검증→accepted, UUID key, 최대 5 MiB, PDF/DOCX, SHA-256.
- ECS Fargate/ALB/RDS, 신규 VPC `10.84.0.0/16`, 기존 GapZer0 네트워크/권한 재사용 금지.
- CloudTrail, VPC Flow Logs, CloudWatch, RDS 백업/복구 시험.
- GitHub Actions OIDC. 장기 AWS access key 금지.
- 가상 직원 5명의 새 IAM Identity Center 신원/그룹/permission set. 실제 활성화에는 팀 소유 이메일과 MFA가 필요.

## 선택된 구현 방향

- pnpm TypeScript monorepo, Node 22.
- 단일 Next.js App Router standalone 컨테이너를 초기 웹+API 배포 단위로 사용.
- PostgreSQL + Drizzle/`pg`, Zod, Vitest, Playwright.
- AWS CDK TypeScript.
- 2-AZ subnet 구조, PoC는 NAT Gateway 1개. ALB public, ECS private, RDS isolated.

## 직원 매핑

- 칠은서 / `chibbo-ceo` / `Chibbo-Approval`
- 삼재윤 / `chibbo-cloud-engineer` / `Chibbo-Platform-Operator`
- 두경금 / `chibbo-release-engineer` / `Chibbo-Release-Operator`
- 정세일 / `chibbo-security-privacy` / `Chibbo-Security-Auditor`
- 청석현 / `chibbo-ops-partner` / `Chibbo-Asset-Viewer`

## 외부 blocker 후보

- 5개 팀 소유 이메일 별칭과 MFA 등록
- Entra app registration 권한/설정
- Route 53 도메인/ACM 검증
- AWS 리전 및 `10.84.0.0/16` 충돌 여부
- GitHub protected environment 설정 권한

가짜 이메일, mock production login, 기존 GRC IAM user/root 재사용으로 blocker를 숨기지 않는다.
