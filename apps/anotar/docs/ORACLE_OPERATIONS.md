# Oracle 운영 기록

기준: 2026-10-04, 한국시간. 실제 Console·SSH에서 확인한 내용과 후속 작업을 구분한다. 설치 절차는 [설치 가이드](ORACLE_INSTALLATION.md)를 따른다.

## 현재 상태

| 항목        | 확인 결과                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 계정        | 기존 PAYG 계정 사용. 이번 작업에서 요금제 변경 없음                                                                                                    |
| 홈 리전     | Japan Central (Osaka), `ap-osaka-1`                                                                                                                    |
| 인스턴스    | `leneu`, `VM.Standard.A1.Flex`, 실행 중                                                                                                                |
| 크기        | 2 OCPU, RAM 12GB                                                                                                                                       |
| OS          | Ubuntu 24.04 Minimal ARM64, SSH `uname -m` = `aarch64`                                                                                                 |
| 부트 디스크 | 100GB, Balanced 10 VPU, Console **상시 무료** 표시 확인                                                                                                |
| OS 디스크   | `/` 96G, 생성 직후 약 95G 여유                                                                                                                         |
| 초기화      | `cloud-init status` = `done`                                                                                                                           |
| 앱          | 아직 옮기거나 실행하지 않음                                                                                                                            |
| 비용 집계   | 새 예산 화면에서 지출·예측 `해당 사항 없음`. 0원 확정으로 해석하지 않음                                                                                |
| DNS·HTTPS   | Cloudflare Free 활성화·가비아 네임서버 변경 및 Google DNS 정상 NS 응답 확인. 앱 주소·HTTPS는 아직 미연결                                               |
| Telegram    | `leneu-oracle-alerts` 그룹·`@leneu_oracle_bot` 확인. 서버 읽기 전용 실행기 설치·실제 보고 전송 수락 확인. 한국시간09/21 timer 활성·다음 실행 확인 완료 |

SSH는 기존 로컬 키 `~/.ssh/leneu-oracle-20261003`를 사용했다. 개인키·API 키·봇 토큰을 문서나 저장소에 넣지 않는다. IP·리소스 OCID는 로컬 Console에서 확인한다.

## 저장한 제한 정책

루트 컴파트먼트에 다음 두 정책을 생성하고 저장된 문장을 다시 조회했다. 실제 초과 자원을 만들어 시험하지 않았다.

Console의 **제한, 할당량 및 사용량 → Compute → 해당 AD**에서 A1 core 사용량 `2`·사용 가능 `0`, A1 memory 사용량 `12`·사용 가능 `0`을 확인했다. 실제 사용 가능한 추가 A1 자원이 남지 않은 상태다.

### `leneu-free-compute-storage`

```text
zero compute-core quotas in tenancy
zero compute-memory quotas in tenancy
zero compute quotas in tenancy
zero compute-management quotas in tenancy
zero auto-scaling quotas in tenancy
zero block-storage quotas in tenancy
set compute-core quota standard-a1-core-count to 2 in tenancy where request.ad = 'HsqI:AP-OSAKA-1-AD-1'
set compute-memory quota standard-a1-memory-count to 12 in tenancy where request.ad = 'HsqI:AP-OSAKA-1-AD-1'
set block-storage quota total-storage-gb to 200 in tenancy where request.ad = 'HsqI:AP-OSAKA-1-AD-1'
set block-storage quota backup-count to 5 in tenancy where request.region = 'ap-osaka-1'
```

AD 이름은 이 계정 전용이다. 다른 계정에 그대로 복사하지 않는다. 처음에 region·AD 조건을 `and`로 연결한 문장은 Console이 거부했다. 실제 저장한 문장은 공식 예시처럼 정확한 AD 조건 하나를 사용한다. 해당 AD 이름에 오사카 리전이 포함된다. [할당량 문법](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/quota_policy_syntax.htm), [공식 예시](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/sample_quotas.htm).

### `leneu-unused-services-disabled`

```text
zero database quotas in tenancy
zero load-balancer quotas in tenancy
zero filesystem quotas in tenancy
zero object-storage quotas in tenancy
```

앱은 VM 내부 SQLite·디스크를 사용하므로 위 관리형 서비스를 새로 만들 필요가 없다. 외부 백업을 OCI Object Storage로 옮길 경우 이 정책과 PAYG 저장 등급별 무료 범위를 먼저 검토한다. 위 네 종류의 제한을 모든 OCI 유료 서비스 차단으로 확대 해석하지 않는다.

### 예산 `leneu-zero-cost-watch`

- 루트 컴파트먼트, 매월 1일 시작, 예산 금액 `1`.
- 실제 지출이 예산의 `1%`를 초과하는 경보 규칙 생성.
- 사용자 로컬 env의 이메일을 실제 지출 경보 수신자에 저장한 뒤 닫고 다시 열어 exact match 확인했다. 이메일 주소 자체는 문서에 기록하지 않는다. 실제 과금 발생으로 경보를 유도하거나 이메일 수신을 검증하지는 않았다.
- Console은 현재 금액에 통화 기호를 표시하지 않았다. 계정 청구 통화를 확인하기 전 달러 금액으로 단정하지 않는다.
- 작동 기준은 이번 달 실제 지출이 예산1의1%, 즉 계정 청구 통화 기준0.01을 초과하는 경우다. 예상 지출 경보는 설정하지 않았다. Oracle은24시간마다 평가하므로 즉시 알림이 아니다. 예산은 결제를 막거나 서버를 자동 정지시키지 않는다. 비용 집계 지연도 존재한다. [예산 평가 규격](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/budgetsoverview.htm), [경보 기준](https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/managingalertrules.htm).

## 남아 있는 비용 경계

이 정책들은 계정 전체 청구액을 0원으로 고정하지 않는다. 디스크 VPU·성능 변경, 다른 서비스, 전송량 초과, Marketplace 이미지·외부 AI·지도 요금은 별도 통제 대상이다. 관리자에게 정책 변경 권한도 남아 있다. 자동 삭제·서버 정지는 데이터 손실과 무료 자원 회수 가능성이 있어 비용 알림의 기본 대응으로 넣지 않는다.

## Telegram 전용 알림 구성

실제 방: **leneu-oracle-alerts**, 봇: **@leneu_oracle_bot**. 로컬 `leneu-storage/.env.oracle-alerts`에 사용자 입력 토큰·이메일과 조회한 chat_id를0600·Git/Docker 제외로 저장했다. 이 파일은 앱에서 읽지 않는다. 최초 그룹 연결 테스트(message_id4)가 수락됐다. 이어서 서버에 root 소유0600 `/etc/leneu-oracle-alerts/telegram.env`를 설치하고 systemd `LoadCredential`로 전용 사용자에게 전달한다. 토큰을 argv/로그/Git에 넣지 않았다. 봇 webhook과 기존 업데이트는 변경/소비하지 않았다.

구현·검증한 항목:

1. 봇과 수신 그룹을 확인한 뒤 이 방에만 테스트 알림 1회.
2. OCI 비용·자원 읽기 전용 인증. 서버 생성·삭제 권한을 알림 실행기에 주지 않는다.
3. 한국시간 09:00·21:00 요약: 집계 대상 기간·마지막 자료 시각·누적 청구액·A1 시간/RAM 시간·디스크/백업·외부 전송량·서버 여유 공간.
4. 비용 발생·설정 이탈·집계 실패는 별도 경고. 데이터 없음/오래된 자료는 `0원`으로 대신 표시하지 않는다.
5. 중복 알림 억제·HTTP 시간 제한·재시도 상한·실패 기록을 확인한 뒤 예약을 켠다.

서버에는 독립 [`ops/oracle/`](../../ops/oracle/README.md) 실행기를 설치했다. `leneu-oracle-alerts` dynamic group은 현재 VM ID 하나만 포함하며, `leneu-oracle-alerts-readonly` 정책은 비용보고 read 및 리전/컴파트먼트/Compute/볼륨/백업 inspect만 허용한다. 저장된7개 정책 문장을 재조회했다. API키 신규 발급·자원 변경 권한은 없다.

실제 조회에서 구독리전1개·컴파트먼트1개·오사카 A1 1대2OCPU/12GB·부트+블록100GB·백업0개·서버 디스크 여유93.9GiB를 확인했다. 비용/사용량 API는 성공했지만 아직 집계 행이 없어 미집계로 표시한다. 계정 청구 통화와 실제0원은 아직 확인되지 않았다.

systemd의 실제 보고 전송 `telegram_accepted`를 확인했다. 첫 실행 중 transient usage API429가 포함되어 exit2가 기록됐고, 후속 실제 dry-run은 오류 없이 끝났다. read 요청의429/5xx는 한 번만10초 후 재시도하며 Telegram POST 자동 재시도는 하지 않는다. 최종 코드의 systemd sandbox 시험 전송도 수락됐고 exit0을 확인했다. fixture27/27, unit verify 및09/21KST calendar 통과. timer는 enabled/active이며 다음 실행2026-10-04 21:00KST를 확인했다. 설치된 코드·unit 네 파일의SHA256은 로컬과 일치한다. 실제 근거는 [`검증 기록`](../../ops/oracle/VERIFICATION.md)에 기록했다. 사용자 읽음·비용 발생 이메일·실제 재부팅 후 실행은 미검증이다.

## 도메인 구성안과 배포 순서

사용자 구매 도메인: **leneu.store**, 등록 기관: 가비아.

- `share.leneu.store`: 서비스의 읽기 전용 공유 서버 `127.0.0.1:8790`.
- `host.leneu.store`: 별도 HTML/CSS/JS 정적 서버 `127.0.0.1:8792`. 등록 시 뒤의 주소 경로는 자동 생성하며 앱 DB·개인 API와 분리한다. 배포 설정과 수동 폴더 등록은 [STATIC_HOSTING.md](STATIC_HOSTING.md)를 따른다.
- 개인 앱: 비밀번호+TOTP 인증은 구현됐다. HTTPS·계정 설정을 확인하고 본인만 허용한 Tailscale HTTPS 또는 검증한 인증 게이트웨이를 사용한다. `8787` 포트는 loopback으로 유지한다. 실제 개인 앱 배포는 아직 진행하지 않았다.

위 주소는 제안 구성이다. 기존 DNS A/MX/TXT/CAA를 확인하고 필요한 A 레코드만 추가한다. DNS 저장·전파·Caddy TLS·외부 접근 검증 전 주소 연결 완료로 표시하지 않는다. 정적 사이트 주소의 예측 가능한 경로는 비공개 보호 기능이 아니므로 공개해도 되는 HTML만 둔다.

### Cloudflare 연결 진행 기록

기존 `leneu.cloud`는 RDAP의 등록 기관이 `Gabia, Inc.`, 네임서버가 Cloudflare이며, 계정 도메인 목록에서 활성·Free 플랜을 확인했다. 사용자가 같은 구성을 승인해 `leneu.store`를 같은 계정에 별도 zone으로 추가하고 **Free / US$0** 플랜을 선택했다. 기관 이전은 하지 않았다. 기존 도메인의 DNS·플랜·계정 공통 설정은 변경하지 않았다.

- Cloudflare 자동 DNS 스캔: 발견한 레코드 0개. 이를 기존 전체 DNS 영역을 내보내 검증한 결과로 취급하지 않는다. 가비아 상세에는 DNS 호스트와 DNSSEC 데이터가 없었고, 공개 DS 조회도 레코드가 없었다.
- 사용자가 가비아 설정 창을 열고 소유자 이메일 인증을 직접 완료했다. 네임서버 입력값을 확인하고 변경 신청을 진행한 뒤 **설정 완료** 결과를 확인했다.
- 저장한 네임서버: `savanna.ns.cloudflare.com`, `sevki.ns.cloudflare.com`. 기존 가비아 네임서버 세 개는 변경 목록에서 제거했다.
- RDAP 재조회에서도 새 네임서버 두 개를 확인했다. 각 Cloudflare 서버에 직접 질의한 SOA·NS는 권한 있는 정상 응답이었다.
- Cloudflare의 **내 이름 서버를 업데이트함** 및 **지금 이름 서버 확인**을 실행했다. 최초 확인은 전파 대기였으며, 후속 Google DNS 조회에서 정상 NS 응답(Status 0)으로 새 네임서버 두 개를 확인했다. 대시보드를 새로고침한 뒤 **이제 도메인이 Cloudflare로 보호됩니다** 표시도 확인했다. 모든 재귀 DNS 캐시의 갱신을 보장하는 의미는 아니다.
- 현재 앱은 미배포이고 zone의 A/AAAA/CNAME 서비스 연결도 만들지 않았다. 개인 앱은 본인만 허용하는 Cloudflare Access·Tunnel 구성을 검증한 후 연결한다. Tunnel 자체를 개인 API 인증으로 취급하지 않는다. 공유 서버·별도 HTML 경로는 개인 API와 분리한다.

네임서버 저장 증거: `.omo/evidence/oracle-20261004/gabia-cloudflare-nameservers-saved.png`. 이 연결 작업에서 유료 플랜·유료 추가 기능·Workers/R2 구독을 신청하지 않았다.

다음 순서: SSH 접근 제한 → 앱 백업·ARM64 배포 → 개인 접속 보호 → 공개 DNS·TLS 연결 → 실제 공유 폐기/댓글·PWA 시험.

## 2026-10-05: 서비스/클라우드 주기 감시

`ops/oracle` 감시 확장으로 서버 자원(5분)과 OCI 비용/자원(30분)을 별도 timer에서 검사한다. 기존 비용 요약 09/21 KST는 유지한다. 별도 서비스 Telegram credential은 root 0600, 클라우드 방은 기존 값 그대로다. 새 `leneu-emergency-stop` 정책의 고정 인스턴스 전원/읽기 문을 저장·재조회했고 AUTO_STOP_ENABLED=true를 설치했다. 현재 자원 위반/양수 비용 증거 없음, 두 감시 서비스 첫 실행 success/0, 세 timer enabled/active.

확인된 양수 비용/설정 한도 이탈 시 고정 VM OCI STOP, CPU·메모리·디스크 문제는 경고만 한다. 미집계·알림 실패 자체는 정지 기준이 아니다. 알림/상태 파일 오류는 STOP을 막지 않는다. 실제 STOP은 모의 응답으로만 검증했으며 운영 VM을 꺼보지는 않았다. [기준·권한·검사 범위](../../ops/oracle/README.md), [확인 기록](../../.omo/evidence/oracle-watch/REPORT.md).

감시 설정 변경 전 root-only `/var/backups/leneu-monitoring-20261005T143431`에 기존 코드/config/요약 unit을 백업했다. 이 백업은 앱 SQLite/첨부 백업과 별개다. 앱은 아직 Oracle에 배포하지 않았으므로 SERVICE_HEALTH_PORTS는 비워 두었다. AI worker Telegram 알림 코드/환경 예시는 준비됐지만 실제 앱 배포 때 활성화해야 한다. GitHub origin은 현재 작업 폴더에 아직 없으며 첫 배포·Cloudflare 앱 주소 연결 후 Actions 자동 배포를 연결한다. 서버 접속 정보는 로컬 Git-ignored `.env.oracle-server`(0600)에만 두었다.
