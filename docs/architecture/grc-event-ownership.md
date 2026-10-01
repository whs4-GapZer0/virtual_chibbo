# 치뽀 GRC 인스턴스별 이벤트 소유 경계

각 원문 이벤트는 하나의 primary GRC instance에만 저장한다. 상위 또는 관련 인스턴스에는 원문을 복사하지 않고 correlation ID와 증적 참조만 연결한다. `packages/contracts`의 `EVENT_SOURCE_POLICY`가 CI에서 사용하는 allowlist다.

| Primary instance | scope | Sources | 원문을 넣지 않는 곳 |
| --- | --- | --- | --- |
| 치뽀컴퍼니 주식회사 | `legal-corporation` | 승인 기록, Identity Center 권한·MFA 증적 | 공유 계정 CloudTrail 관리 이벤트 |
| 치뽀 채용지원 서비스 | `recruitment-service` | application audit, Entra sign-in, 개인정보 삭제 요청 | 플랫폼 S3 CloudTrail·Flow Log |
| 치뽀 채용관리 플랫폼 시스템 | `recruitment-platform` | ECS/ALB/CloudWatch, resume S3 CloudTrail, RDS backup, GitHub deployment | 고객사별 지원자 원문을 다른 시스템에 복제 |
| 치뽀 사내 HR 시스템 | `internal-hr` | Identity Center lifecycle, Entra membership, 퇴사 점검 | 지원자 이력서·S3 object event |
| 치뽀 자산관리 시스템 | `asset-management` | NetBox, AWS inventory, VPC Flow Logs | resume S3 CloudTrail |

`chibbo-data-trail`은 resume bucket의 `AWS::S3::Object` read/write data event만 수집한다. `IncludeManagementEvents=false`이므로 계정 전체 관리 이벤트와 GRC 이벤트는 포함하지 않는다. VPC Flow Logs는 `10.84.0.0/16`과 `Project=virtual-chibbo` 태그 자원의 자산·네트워크 증적에만 쓴다.

새 source를 추가하려면 source, primary scope, tenant 데이터 여부, 보존기간, 읽기 permission set을 `EVENT_SOURCE_POLICY`에 모두 선언한다. 선언하지 않은 source는 수집하거나 구독하지 않는다.
