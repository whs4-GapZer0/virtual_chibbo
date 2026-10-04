# 치뽀 dev 배포 절차

GitHub Actions의 `deploy-dev`는 `main`과 protected environment `chibbo-dev`에서만 수동 실행한다. PR, fork, static AWS access key는 배포 권한을 얻지 못한다.

1. `docs/cost/<YYYY-MM-DD>-pricing.json`에 Pricing API 또는 Calculator 원본을 저장하고, `config/cost-assumptions.dev.yaml`의 가정과 대조한다.
2. 계정에 `Chibbo-dev` Budget과 실제 50/80/100%, forecast 100% 팀 소유 알림을 만든다. runtime secret `chibbo/dev/runtime`에는 `DATABASE_URL`과 `CHIBBO_DELETION_PEPPER`만 넣는다.
3. 정확한 HTTPS origin, ACM certificate, GitHub immutable owner/repository ID, Chibbo 전용 OIDC deploy role ARN을 workflow 입력으로 제공한다.
4. workflow가 CIDR 중복, runtime secret, certificate, Budget, 비용 증거를 확인한 뒤 registry foundation을 먼저 만든다. image를 ECR에 commit SHA tag로 push한 뒤 digest를 조회해 ECS task definition에 `repository@sha256:...`으로 고정한다.
5. protected environment가 `CHIBBO_MIGRATION_TASK_ARN`과 `CHIBBO_EXPAND_MIGRATION_APPROVAL_ID`를 제공해 expand-migration change record를 검증한 뒤에만 service deploy와 HTTPS smoke check가 이어진다. migrator-only database secret과 task launcher는 별도 review gate가 남아 있으며, 그 전에는 이 workflow가 migration을 실행했다고 주장하지 않는다. contract migration은 한 rollback window 이후 별도 protected deployment에서만 실행한다.

초기 GitHub OIDC provider와 deploy role은 이미 존재하는 계정 bootstrap authority가 한 번 생성해야 한다. 이 repository는 그 bootstrap credential, Identity Center 초대, Entra B2B 초대, DNS 변경을 자동 생성하거나 저장하지 않는다.

## 이미지 서명·검증 게이트 (GRC TVM-E-03)

`deploy-dev`는 이미지를 push한 뒤 마이그레이션 작업이나 서비스가 그 이미지를 실행하기 전에 다음을 한다.

1. push한 ARM64 이미지 digest의 SPDX SBOM을 Syft로 만든다.
2. KMS 키 `alias/chibbo/dev/image-signing`(ECC P-256, 내보낼 수 없음)으로 digest와 SBOM 증명에 cosign 서명한다. 서명은 `chibbo-platform-dev-signatures` 저장소에 둔다. 공개 투명성 로그에는 올리지 않는다.
3. 같은 키로 `cosign verify`·`verify-attestation`을 실행한다. 실패하면 배포가 멈춘다.
4. 검증 보고서(`tvm-e-03-verification`)와 SBOM·검증 출력(`tvm-e-03-sbom`)을 90일 보관한다. 매일 TVM 내보내기가 보고서를 읽어 도입·검증 기록을 만든다.

처음 켤 때는 `deploy-prowler-scanner`를 먼저 실행해 배포 역할에 서명 권한을 준다. 그다음 `deploy-dev`를 실행하면 Registry 스택이 키와 서명 저장소를 만들고 이어서 서명한다.
