# 치뽀 dev 배포 절차

GitHub Actions의 `deploy-dev`는 `main`과 protected environment `chibbo-dev`에서만 수동 실행한다. PR, fork, static AWS access key는 배포 권한을 얻지 못한다.

1. `docs/cost/<YYYY-MM-DD>-pricing.json`에 Pricing API 또는 Calculator 원본을 저장하고, `config/cost-assumptions.dev.yaml`의 가정과 대조한다.
2. 계정에 `Chibbo-dev` Budget과 실제 50/80/100%, forecast 100% 팀 소유 알림을 만든다. runtime secret `chibbo/dev/runtime`에는 `DATABASE_URL`과 `CHIBBO_DELETION_PEPPER`만 넣는다.
3. 정확한 HTTPS origin, ACM certificate, GitHub immutable owner/repository ID, Chibbo 전용 OIDC deploy role ARN을 workflow 입력으로 제공한다.
4. workflow가 CIDR 중복, runtime secret, certificate, Budget, 비용 증거를 확인한 뒤 registry foundation을 먼저 만든다. image를 ECR에 commit SHA tag로 push한 뒤 digest를 조회해 ECS task definition에 `repository@sha256:...`으로 고정한다.
5. protected environment가 `CHIBBO_MIGRATION_TASK_ARN`과 `CHIBBO_EXPAND_MIGRATION_APPROVAL_ID`를 제공해 expand-migration change record를 검증한 뒤에만 service deploy와 HTTPS smoke check가 이어진다. migrator-only database secret과 task launcher는 별도 review gate가 남아 있으며, 그 전에는 이 workflow가 migration을 실행했다고 주장하지 않는다. contract migration은 한 rollback window 이후 별도 protected deployment에서만 실행한다.

초기 GitHub OIDC provider와 deploy role은 이미 존재하는 계정 bootstrap authority가 한 번 생성해야 한다. 이 repository는 그 bootstrap credential, Identity Center 초대, Entra B2B 초대, DNS 변경을 자동 생성하거나 저장하지 않는다.
