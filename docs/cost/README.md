# 치뽀 dev 비용 증거

이 디렉터리는 실제 배포 직전에 Pricing API 또는 AWS Pricing Calculator 원본과 산정 시각을 저장하는 자리다. `deploy-dev`는 이 디렉터리에 날짜가 포함된 `.json` 원본이 없으면 중단한다.

`config/cost-assumptions.dev.yaml`의 NAT Gateway, ALB, Fargate, RDS, CloudWatch, Flow Logs, CloudTrail/S3 가정을 함께 검토한다. 이 파일은 견적 증거가 아니며, `REQUIRED_AT_DEPLOY` 값과 실제 팀 소유 Budget 알림 수신자가 채워진 원본만 protected deployment 승인 근거가 된다.
