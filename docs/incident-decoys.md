# 사고 재현 decoy

2025년 ISMS-P 인증 기업 사고의 **관리 결함**을 치뽀에 재현한 것입니다. 목적은 GapZer0 GRC가 같은 결함을 실제 AWS·저장소에서 매일 실패로 잡는지 보이는 데 있습니다.

재현하는 것은 침입 자체가 아닙니다. 악성코드나 불법 장비 같은 침입은 GRC 범위 밖이고, 여기에는 넣지 않았습니다. 사고로 이어진 관리 결함만 다룹니다.

## 사고 → decoy → GapZer0 판정

| 사고 | 공식 조사에서 드러난 결함 | 치뽀 decoy | GapZer0 통제 · 원천 | 기대 판정 |
| --- | --- | --- | --- | --- |
| **롯데카드** (2025.8, 297만 명) | 2022년 6월 이후 거래가 없던 결제 서버가 계속 켜져 있었다. 이 서버는 관제와 정기 평가에서 빠져 있었고, 그런데도 경영진 보고는 "100점"이었다(금감원 제재, 2026.8). | `DecoyDormantPayGateway`: 자산 범위 태그(`gapzero:asset-scope`)는 붙어 있지만 NetBox 자산대장에는 등록하지 않은 EC2 | AST-E-01 · AWS EC2 ↔ NetBox | 실패: "자산대장(NetBox)에 등록되지 않은 인스턴스입니다" |
| **KT** (2025.8~9, 368명 소액결제) | 펨토셀 인증·제품등록 시스템을 방화벽 없이 운영했다(최종 조사, 2025.12.29). | `DecoyFemtoRegistrationSecurityGroup`: 인터넷 전체에 SSH(22)를 연 보안 그룹. **어디에도 붙어 있지 않음** | SNS-C-01 · AWS EC2 Security Groups | 실패: "인터넷 전체에 관리 포트 22-22 인바운드가 열려 있습니다" |
| **KT** | 모든 펨토셀이 같은 인증서를 썼고 유효기간이 10년이었다. 그래서 한 번 접속한 장비는 소유·회수 관리 없이 계속 망에 접속할 수 있었다. | `DecoySharedDeviceUser`: 소유자가 없는 공용 IAM 사용자. 비밀번호·액세스 키·정책이 모두 없음 | IAM-C-01 · AWS IAM Credential Report ↔ Entra | 실패: "사람 계정이 Entra 사용자와 연결되지 않았습니다" |
| **SK텔레콤** (2025.4, 2,696만 건) | 시스템 관리망 서버에 다른 서버들의 ID·비밀번호를 평문으로 저장했다. 침입자는 이를 이용해 HSS(가입자 인증) 서버로 이동했다(최종 조사, 2025.7.4). | `ops/legacy-mgmt/server-accounts.conf`: 서버 계정 비밀번호를 평문으로 적은 설정 파일. `trivy-secret.yaml`의 사내 규칙이 CRITICAL로 탐지 | APP-E-01 · GitHub Actions `app-e-01-evidence`(Trivy secret) | 실패: Trivy Critical finding |

## 안전 장치

- **롯데 EC2**
  - DB용 격리 서브넷(인터넷 경로 없음)에 둡니다.
  - 보안 그룹은 인바운드와 아웃바운드가 모두 없습니다.
  - 공인 IP, 키 페어, 인스턴스 역할, 사용자 데이터가 없습니다. IMDSv2만 쓰고 EBS는 암호화합니다.
  - 서비스는 아무것도 실행하지 않습니다.
  - 비용은 t3.nano와 8 GB gp3 기준으로 월 약 5달러입니다.
- **KT 보안 그룹**: 어떤 ENI에도 붙지 않습니다. 테스트가 인스턴스에 붙지 않았는지 확인합니다.
- **KT IAM 사용자**
  - 자격증명과 권한이 없어 로그인도 API 호출도 할 수 없습니다.
  - Bootstrap에 추가한 사용자 관리 권한은 `user/chibbo-decoy/*` 경로로만 제한했습니다.
- **SKT 파일**
  - 호스트는 `.invalid` 예약 도메인과 RFC 5737 문서용 주소를 씁니다.
  - 비밀번호는 어느 시스템에도 없는 무작위 문자열입니다.
- **삭제 경로**
  - decoy 스택은 opt-in(`-c incidentDecoys=true`)입니다. 평소의 synth와 배포 워크플로는 이 스택을 만들지 않습니다.
  - Foundation에서 export를 가져오지 않습니다. 그래서 decoy가 남아 있어도 다른 스택의 배포를 막지 않습니다.
  - 모든 리소스에 `gapzero:decoy=incident-replica` 태그와 `gapzero:decoy-scenario` 태그가 붙습니다.

## 배포와 제거

1. 이 변경을 main에 병합합니다.
2. Actions → `deploy-incident-decoys`를 실행합니다.
   - `action=deploy`
   - Bootstrap 출력의 두 역할 ARN
   - `asset_scope`: GapZer0 런타임 설정 `AWS_ASSET_SCOPE`와 같은 값. 다르면 AST-E-01이 decoy EC2를 보지 못합니다.
3. 워크플로는 assume한 GitHub 배포 역할의 STS account ID를 CDK 대상 계정으로 사용하고, 두 입력 역할 ARN도 같은 계정인지 확인합니다. 새 계정은 먼저 사람 운영자가 GitHub OIDC provider와 `ChibboBootstrapDev`·`ChibboFoundationDev`를 만들어야 합니다. 이 워크플로는 첫 OIDC 역할을 만들 수 없고, 기존 Foundation을 대신 만들지도 않습니다.
4. 그 뒤 Bootstrap을 갱신하고(decoy 경로 권한 추가), Foundation의 VPC와 격리 서브넷 ID를 읽어 `ChibboIncidentDecoyDev`를 만듭니다.
5. GapZer0가 다음 정기 수집(15분 주기)에서 SNS-C-01, AST-E-01, IAM-C-01을 다시 판정합니다. APP-E-01은 main의 `verify` 실행 결과를 읽습니다.
6. 제거할 때는 같은 워크플로를 `action=remove`로 실행합니다. 스택이 이미 없는 경우에는 성공으로 끝납니다. SKT 재현은 `ops/legacy-mgmt/server-accounts.conf`를 지우는 PR로 끝납니다.

주의할 점이 하나 있습니다. SKT decoy가 main에 있는 동안 `verify` 워크플로의 보안 게이트는 실패합니다. 이것이 의도된 결과이지만, 현재 main 브랜치 보호는 `verify`를 필수 검사로 요구하므로 이 PR도 병합할 수 없습니다. 이 사실을 숨기거나 `verify`를 무조건 성공 처리하면 안 됩니다. 병합 전에 기존 Critical 취약점과 이 의도된 decoy finding을 어떻게 승인·예외 처리하면서 새 Critical은 계속 차단할지, 또는 보안 게이트의 필수 정책을 어떻게 분리할지 별도 보안 결정을 기록해야 합니다.

## 배포 전 검증 (2026-10-25)

GapZer0 GRC `origin/main`(b6173c6)의 수집기 코드를 그대로 썼습니다. moto로 만든 가상 AWS 계정에 이 저장소가 합성한 decoy 템플릿을 CloudFormation으로 올리고, 배포 전·후·삭제 후를 판정했습니다. NetBox는 등록된 인스턴스 목록만 돌려주도록 대체했고, Entra는 사용자 1명으로 고정했습니다.

| 통제 | decoy 전 | decoy 배포 후 | 스택 삭제 후 |
| --- | --- | --- | --- |
| SNS-C-01 | 통과 | **실패** · `chibbo-dev-decoy-femto-registration` 22 공개 | 통과 |
| AST-E-01 | 통과 | **실패** · `chibbo-dev-decoy-dormant-pay-gateway` 자산대장 미등록 | 통과 |
| IAM-C-01 | 통과 | **실패** · `chibbo-dev-decoy-shared-device` 사람 연결 없음 | 통과 |

APP-E-01(SKT)은 PR #43의 `verify` 실행에서 확인했습니다. Trivy 산출물에 `ops/legacy-mgmt/server-accounts.conf`의 `plaintext-server-account-password` CRITICAL 3건(12·17·22행)이 나왔습니다.

다만 이 decoy가 없어도 APP-E-01은 이미 실패 상태입니다. `pnpm-lock.yaml`에 Critical 취약점 5건(CVE-2025-55182 등)이 있고, Semgrep finding도 33건이 있습니다. 그래서 SKT decoy는 판정을 통과에서 실패로 바꾸지 않습니다. 실패 근거에 평문 비밀번호 3건을 더할 뿐입니다. GapZer0 관측에는 Critical 건수만 남습니다.

## GapZer0가 아직 못 잡는 것 (사실대로)

| 사고 결함 | 현재 상태 | 필요한 것 |
| --- | --- | --- |
| SKT·KT 로그 보관 부족(SKT는 확인 불가 기간이 생김, KT는 1~2개월 보관) | 치뽀의 `/chibbo/dev/flow`·`/app` 로그 그룹도 **보존 기간 30일**이지만 GapZer0에는 보존 기간 판정이 없음 | IEM-C-07에 CloudWatch 보존 기간 기준(예: Prowler `cloudwatch_log_group_retention_policy_specific_days_enabled`) 추가 |
| SKT·KT 감염 발견 후 미신고 | IEM-C-12는 절차서 표의 필수 칸만 확인함 | 사고 대장의 발견 시각 대비 신고 시각 규칙(24시간) |
| 롯데카드 서버 백신 미설치 | Wazuh 수집은 등록된 agent의 상태만 봄 | EC2 목록 대비 agent 누락 대조 |
| SKT Ki 미암호화, BPFDoor 같은 침입 | 범위 밖 | 해당 없음 |
| KT·포스코이앤씨 협력사 관리 | Drive `06_자산·공급자_관리대장`의 `supplier_register` 규칙(SUP-E-03.1 재평가 1년, SUP-C-01.1 핵심 공급자 부적합)이 이미 있음 | 대장에 decoy 공급자 행 추가(아래) |

공급자 대장 decoy 행(팀 Drive 대장을 고칠 때 사용):

| 공급자 | 제공 서비스 | 처리 데이터 | 위탁·재위탁 | 계약·약관 | 핵심 공급자 | 도입 전 평가 | 평가 결과 | 최근 평가일 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [DECOY] 외주 장비 제조사 (KT 2025 재현) | 출입·인증 장비 제조·인증서 주입 | 장비 인증서·서버 주소 | 재위탁 | 보안 조항 없음 | 예 | 미실시 | 부적합 | 2024-08-01 |
| [DECOY] 안전교육 위탁사 (포스코이앤씨 2026 재현) | 협력사 직원 안전교육 사이트 운영 | 협력사 직원 이름·연락처·현장명 | 위탁 | 위탁계약 | 예 | 실시 | 부적합 | 2024-12-01 |

## 출처

- SK텔레콤: 과기정통부 최종 조사결과(2025.7.4), [뉴스토마토](https://newstomato.com/ReadNews.aspx?no=1267456)
- KT: 민관합동조사단 최종 조사결과(2025.12.29), [뉴시스](https://www.newsis.com/view/NISX20251229_0003457704); 중간 조사(2025.11.6), [뉴스토마토](https://newstomato.com/ReadNews.aspx?no=1280666)
- 롯데카드: 금감원 제재 공시, [MTN(2026.8.4)](https://news.mtn.co.kr/news-detail/2026080409061214867); 침해 경위, [바이라인(2025.9.18)](https://byline.network/2025/09/0918-4/)
- 포스코이앤씨 협력사: [바이라인(2026.1)](https://byline.network/2026/01/19-582/)
