# 로컬 개발

이 저장소는 합성 데이터 전용이다. 실제 이력서, 실제 이메일, AWS access key, Entra secret을 넣지 않는다.

1. Node 22와 pnpm 10을 설치한다.
2. `.env.example`을 `.env.local`로 복사하고 `CHIBBO_DELETION_PEPPER`를 로컬 전용 난수로 바꾼다.
3. PostgreSQL에 `chibbo_owner`, `chibbo_migrator`, `chibbo_app` 역할을 만든 뒤 `database/migrations`을 순서대로 `chibbo_migrator`로 적용한다.
4. `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm --filter @chibbo/platform dev`를 실행한다.

현재 local storage adapter는 presigned POST 조건을 계약 수준에서 검증하는 개발용 어댑터다. 실제 S3 upload/finalize, Entra login, CloudTrail, Identity Center invitation은 AWS/Entra preflight와 실제 환경 E2E가 통과하기 전에는 완료로 간주하지 않는다.
