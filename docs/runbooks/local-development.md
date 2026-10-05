# 로컬 개발

이 저장소는 합성 데이터 전용이다. 실제 이력서, 실제 이메일, AWS access key, Entra secret을 넣지 않는다.

1. Node 22와 pnpm 10을 설치한다.
2. `.env.example`을 `.env.local`로 복사하고 `CHIBBO_DELETION_PEPPER`를 로컬 전용 난수로 바꾼다.
3. PostgreSQL에 `chibbo_owner`, `chibbo_migrator`, `chibbo_app` 역할을 만든 뒤 `database/migrations`을 순서대로 `chibbo_migrator`로 적용한다.
4. `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm --filter @chibbo/platform dev`를 실행한다.

현재 local storage adapter는 presigned POST 조건을 계약 수준에서 검증하는 개발용 어댑터다. 실제 S3 upload/finalize, Entra login, CloudTrail, Identity Center invitation은 AWS/Entra preflight와 실제 환경 E2E가 통과하기 전에는 완료로 간주하지 않는다.

## 합성 시드 데이터

`database/seed.synthetic.sql`은 `database/generate_seed.py`가 만든 파일이다. 고객사, 공고, 지원자를 바꾸려면 SQL이 아니라 생성기를 고친 뒤 다시 만든다.

```sh
python3 database/generate_seed.py > database/seed.synthetic.sql
```

지원자 인적 사항은 모두 지어낸 값이다. 이메일은 RFC 2606 예약 도메인(`example.com`, `example.net`, `example.org`)만, 전화번호는 배정되지 않은 `010-0000-xxxx` 대역만 쓴다. 이 규칙을 벗어나는 값을 생성기에 넣지 않는다. 시드는 `CHIBBO_SEED_SYNTHETIC=true`로 마이그레이션 작업을 실행할 때만 적용되고, 이미 있는 지원서는 덮어쓰지 않는다.
