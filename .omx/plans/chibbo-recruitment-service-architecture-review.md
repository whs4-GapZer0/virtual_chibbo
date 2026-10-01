# 치뽀 채용지원 서비스 아키텍처 검토

검토일: 2026-10-01
검토 대상: `chibbo-recruitment-service-plan.md`, 컨텍스트 및 조사 문서
판정: **ITERATE**

## 결론

단일 Next.js 서비스, PostgreSQL RLS, 비공개 S3, Entra OIDC, IAM Identity Center, 신규 VPC, GitHub OIDC 조합은 5인·합성 데이터 PoC에 맞는다. 다만 아래 여섯 경계가 구현 계약에 빠져 있어, 보완 전에는 구현을 시작하지 않는다.

## 구현 전 차단 보완사항

1. **DB 역할과 RLS 강제**
   - `chibbo_owner`(NOLOGIN, schema/table/function owner), `chibbo_migrator`(migration 전용), `chibbo_app`(runtime 전용)을 분리한다.
   - `chibbo_app`은 table owner나 `BYPASSRLS`가 아니며, `FORCE ROW LEVEL SECURITY`, `USING`과 `WITH CHECK`, `PUBLIC` 권한 회수, company context 없는 default-deny를 적용한다.
   - 공개 지원자와 platform admin은 일반 tenant query helper를 우회하지 않고 별도 제한 경로를 사용한다.

2. **인증된 UI의 캐시 경계**
   - Next.js 버전을 lockfile에 고정한다.
   - staff/admin 화면과 API는 첫 버전에서 `no-store`/dynamic rendering을 쓴다.
   - 이후 캐시는 company, principal scope, resource ID를 모두 키에 넣고 멤버십 변경 시 무효화한다.
   - Next.js 16을 쓰면 `middleware.ts`가 아닌 `proxy.ts`를 쓰며, proxy는 최종 인가를 맡지 않는다.

3. **이력서 업로드의 replay·고아 객체 처리**
   - `upload_intents(issued → uploaded → verifying → finalized|rejected|expired)`와 `draft_upload` 상태를 도입한다.
   - presigned POST는 exact key, content-length range, upload intent metadata, 허용 content type, SSE, 짧은 만료를 조건으로 삼는다.
   - finalize에서 intent를 잠그고 S3 `VersionId`를 고정해 검증·copy한다. S3 copy/DB commit 실패에는 saga 보상과 orphan reconciler를 둔다.
   - 삭제 요청은 current/noncurrent object version과 delete marker까지 처리한다.

4. **Entra OIDC 주체 모델**
   - PoC는 치뽀 단일 Entra tenant의 single-tenant 앱 + 고객사 담당자 B2B guest를 사용한다.
   - membership은 `tid`와 `oid`를 저장하고 이메일/UPN/display name을 권한 키로 쓰지 않는다.
   - issuer, audience, tenant allowlist, state, nonce, PKCE를 검증하고, 브라우저에는 opaque session ID만 보관한다.

5. **IAM Identity Center와 GitHub OIDC 사전 검증**
   - Identity Center가 organization instance인지, permission set/account assignment가 가능한지, identity source/MFA 책임 주체가 무엇인지 먼저 읽기 검증한다.
   - account instance거나 소유 이메일이 없으면 가짜 초대로 완료 처리하지 않는다.
   - GitHub OIDC는 생성 시점 기준 immutable `sub`, repository/owner ID, `aud=sts.amazonaws.com`, environment/ref 조건을 실제 token claim으로 확인한 뒤 trust를 만든다. PR은 deploy role을 assume하지 못한다.

6. **배포·migration 경계와 운영 로그**
   - deploy role, CloudFormation execution role, ECS task role, migration task role을 분리한다.
   - migration은 `expand → service deploy → contract` 순서이며, migration 실패 시 서비스 갱신을 중단한다.
   - S3 gateway endpoint 우선, interface endpoint는 NAT 비용과 비교한다. 로그 목적지/보존기간/CloudTrail S3 data event selector를 명시하고 public upload에는 rate limit과 quota를 적용한다.

## 서비스/UI 보완

- 공개 공고 URL은 회사 범위를 포함하거나 job slug를 전역 unique로 한다.
- 이름·이메일·이력서 외 지원자 필드를 추가 수집하지 않는다.
- `consent_version` 대신 고지 확인의 의미가 분명한 `privacy_notice_version`, `notice_acknowledged_at`을 쓴다.
- receipt number는 예측 불가하며 조회·삭제 권한이 아니다.
- 상태 변경은 optimistic concurrency와 감사 이벤트를 쓴다.
- 다운로드는 attachment, 고정 안전 파일명, `nosniff`로 제공한다.

## 주요 트레이드오프

단일 Next.js 서비스와 단일 AWS 계정은 운영 면적·비용을 낮추지만, API/UI 경계와 account plane의 완전 격리를 제공하지 않는다. 이는 합성 dev PoC에서는 수용하되, package import rule·RLS·OIDC·태그·KMS·IAM role 분리로 보완한다. 고객사별 VPC/DB, 다중 NAT, WAF, malware/CDR은 외부 실제 개인정보 공개 전의 별도 출시 게이트다.

## 근거

- [PostgreSQL row security policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [AWS S3 POST policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)
- [Microsoft Entra ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [AWS IAM Identity Center instance types](https://docs.aws.amazon.com/singlesignon/latest/userguide/identity-center-instances.html)
- [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
