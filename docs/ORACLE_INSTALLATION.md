# Oracle A1에 leneu 설치하기

> 2026-10-06 실제 배포: Cloudflare Tunnel을 통해 앱·공유·호스팅을 연결했다. GitHub 검증과 Oracle의 배포 조회 방식, 영구 자료 경로 및 현재 제한은 [실운영 연결](ORACLE_LIVE_DEPLOYMENT.md)을 먼저 확인한다. 아래는 최초 설치 절차 기록이다.

기준: 2026-10-04. Ubuntu Server 24.04 LTS ARM64, A1 2 OCPU / RAM 12GB, Docker Compose. 이 문서는 설치 절차다. VM 생성·SSH 확인은 완료했지만 앱 배포는 아직 하지 않았다. 실제 단계별 상태는 [Oracle 운영 기록](ORACLE_OPERATIONS.md)을 확인한다. 오프라인 기능의 단계별 구현·검증 상태는 [실행 기록](../.omo/evidence/offline-workspace/PROGRESS.md)을 확인한다.

> 2026-10-04 업데이트: 개인 비밀번호+TOTP 인증을 구현했다. 먼저 [AUTHENTICATION.md](AUTHENTICATION.md)의 계정 설정·키 보관·HTTPS 절차를 수행한다. 아래 Tailscale 절차는 기존 운영 선택지이며, Vercel 화면/Oracle API의 same-origin 프록시 배포는 아직 실행하지 않았다.

## 1. 구성과 비용 범위

개인용 서버 한 대에서 다음과 같이 실행한다.

| 용도                     | 접속                                 | 서버 내부          |
| ------------------------ | ------------------------------------ | ------------------ |
| 개인 메모·페이지·동기화  | 본인만 허용한 Tailscale HTTPS        | 127.0.0.1:8787     |
| 읽기 전용 공유·이름 댓글 | 선택 사항: 공유용 도메인 HTTPS       | 127.0.0.1:8790     |
| 독립 HTML/CSS/JS 호스팅  | `host.leneu.store` HTTPS             | 127.0.0.1:8792     |
| 원본 자료                | 호스트 영구 디렉터리                 | /srv/leneu/data    |
| 정적 사이트 원본 사본    | 호스트 영구 디렉터리                 | /srv/leneu/sites   |
| 백업                     | 원본과 다른 디렉터리, 외부 사본 추가 | /srv/leneu/backups |

개인 API는 비밀번호+TOTP 계정 인증을 지원한다. 운영 환경에서 계정·비밀키·HTTPS를 먼저 설정하고 8787은 loopback으로 유지한다. 공유 서버로 개인 API를 프록시하지 않는다. 공개 도메인이 없어도 본인 PWA 사용부터 시작할 수 있다. 문서 공유 `share.leneu.store`와 독립 호스팅 `host.leneu.store`의 설정은 [정적 호스팅 안내](STATIC_HOSTING.md)를 따른다. 사이트 파일은 기존 SQLite/첨부 백업 범위 밖이므로 별도로 보관한다.

계정 유형에 따라 A1 무료 한도를 구분한다. 현재 일반 Always Free 문서는 월 1,500 OCPU 시간·9,000 GB 시간을, PAYG 가격표는 월 첫 3,000 OCPU 시간·18,000 GB 시간을 안내한다. 이 서버의 2 OCPU / 12GB는 31일 연속 실행 시 1,488 OCPU 시간·8,928 GB 시간이다. [Oracle 공식 무료 자원 설명](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [PAYG 가격표](https://www.oracle.com/cloud/price-list/).

홈 리전의 부트·블록 디스크를 합쳐 200GB, 볼륨 백업은 합계 5개까지 무료다. 생성한 부트 디스크는 100GB·Balanced 10 VPU이며 Console의 상시 무료 표시를 확인했다. PAYG는 자동 청구 차단 기능이 있는 계정이 아니다. 할당량 정책은 지정 자원 수를 제한하고 예산은 비용 알림만 제공한다. 디스크 성능 상향·새 유료 서비스·무료 전송량 초과와 외부 AI·지도 요금은 별도로 관리한다. 홈 리전 용량 부족과 장기간 유휴 무료 인스턴스 회수 가능성도 고려한다.

## 2. 인스턴스 만들기

Oracle Console → Compute → Instances → Create instance:

1. 홈 리전, 이름 `leneu`, Ubuntu 24.04 **ARM64** 이미지.
2. Shape `VM.Standard.A1.Flex`, 2 OCPU, 12GB. Always Free 표시와 계정 전체 사용량 확인.
3. 부트 디스크 50~100GB. 기존 무료 디스크를 포함해 200GB 이내.
4. VCN·인터넷 게이트웨이·퍼블릭 IPv4가 있는 서브넷을 선택.
5. SSH 공개키 등록. 개인키는 로컬에 보관한다.
6. 보안 목록/NSG의 TCP 22는 본인 공인 IP `/32`로 제한. 8787/8790 인바운드 규칙은 만들지 않는다. 공유 도메인을 연결할 때만 80/443을 추가한다.

로컬 터미널:

```bash
chmod 600 ~/.ssh/leneu-oracle
ssh -i ~/.ssh/leneu-oracle ubuntu@SERVER_IP
```

`SERVER_IP`와 키 경로는 실제 값으로 바꾼다. 접속 후:

```bash
uname -m
free -h
df -h /
sudo apt-get update
sudo apt-get install -y ca-certificates curl git unzip rsync
```

`uname -m`은 `aarch64`여야 한다. 자동 업데이트 후 재시작이 필요하면 다시 SSH로 접속한다.

## 3. Docker Engine 설치

서버에는 Docker Desktop이 필요 없다. 다음은 새 Ubuntu 서버 기준이다. 기존 Docker가 있다면 기존 컨테이너를 확인하고 [공식 설치 문서](https://docs.docker.com/engine/install/ubuntu/)의 충돌 패키지 항목부터 검토한다. 공식 Ubuntu 패키지는 ARM64를 지원한다.

```bash
sudo install -d -m 0755 /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod 0644 /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' \
  'Types: deb' \
  'URIs: https://download.docker.com/linux/ubuntu' \
  "Suites: $VERSION_CODENAME" \
  'Components: stable' \
  "Architectures: $(dpkg --print-architecture)" \
  'Signed-By: /etc/apt/keyrings/docker.asc' | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

아래 명령은 `sudo docker`를 사용한다. 일반 사용자에게 Docker 권한을 부여하지 않아도 된다.

## 4. 앱 코드와 자료 옮기기

서버:

```bash
sudo mkdir -p /srv/leneu/app /srv/leneu/data /srv/leneu/backups
sudo chown -R ubuntu:ubuntu /srv/leneu
```

현재 앱은 아직 커밋하지 않은 파일이 많으므로 Git clone만으로 현재 버전이 복제되지 않는다. 먼저 **로컬 앱 디렉터리**에서 빌드·테스트를 확인하고, 앱 코드를 옮긴다.

```bash
cd /path/to/leneu-anything/leneu-storage
npm run build
npm test
rsync -av --exclude=node_modules --exclude=dist --exclude=data --exclude=backups \
  --exclude=.env --exclude=.git --exclude=.omo --exclude=.superpowers \
  -e 'ssh -i /path/to/leneu-oracle' ./ ubuntu@SERVER_IP:/srv/leneu/app/
```

원본 `storage.sqlite`만 실행 중 복사하지 않는다. 로컬 CLI로 일관된 백업을 만든다. 목적 경로는 **새 경로**여야 한다.

```bash
npm run backup -- create ./data ./backups/oracle-first
npm run backup -- verify ./backups/oracle-first
rsync -av -e 'ssh -i /path/to/leneu-oracle' \
  ./backups/oracle-first/ ubuntu@SERVER_IP:/srv/leneu/backups/oracle-first/
```

빈 서버라면 5단계 이미지 빌드 후 6단계 복원을 먼저 실행하고 앱을 시작한다. 새 설치에 자료가 없으면 빈 `/srv/leneu/data`로 시작해도 된다. 실제 계정 키는 복사 명령이나 로그에 넣지 않고 서버에서 별도 입력한다.

## 5. 환경 파일과 이미지 빌드

서버:

```bash
cd /srv/leneu/app
cp -n .env.example .env
chmod 600 .env
nano .env
```

필수 값:

```dotenv
LENEU_IMAGE=leneu-storage:oracle
LENEU_DATA_DIR=/srv/leneu/data
LENEU_BACKUP_DIR=/srv/leneu/backups
LENEU_PRIVATE_PORT=8787
LENEU_SHARE_PORT=8790
PUBLIC_SHARE_ORIGIN=http://127.0.0.1:8790
AI_RUNNER_KIND=disabled
```

지도·AI·OCR은 필요할 때만 각 항목에 서버용 키/URL을 입력한다. `VITE_` 접두사를 사용하지 않는다. 현재 이미지에는 Devin CLI가 포함되지 않는다. AI 실행은 지원하는 HTTP 게이트웨이 또는 별도 실행기 설치를 검증한 뒤 연결한다.

```bash
sudo docker compose -f compose.yaml build
sudo docker image inspect leneu-storage:oracle --format '{{.Architecture}}'
```

예상 아키텍처: `arm64`. **A1에서 `compose.n100.yaml`을 사용하지 않는다.** 그 파일은 amd64 전용이다. 빌드 중 일시적으로 리소스 사용량이 올라갈 수 있다.

## 6. 백업 검증·복원 후 실행

자료를 가져온 경우 컨테이너 시작 전에 검증/복원한다. 복원지는 기존 원본을 덮어쓸 수 없으므로 새 디렉터리를 사용한다.

```bash
cd /srv/leneu/app
sudo docker compose run --rm --no-deps storage \
  node scripts/backup-data.mjs verify /backups/oracle-first
sudo docker compose run --rm --no-deps storage \
  node scripts/backup-data.mjs restore /backups/oracle-first /backups/restored-first
```

`.env`에서 `LENEU_DATA_DIR=/srv/leneu/backups/restored-first`로 변경하거나, 해당 복원 디렉터리를 아직 비어 있는 `/srv/leneu/data`와 교체한 뒤 경로를 고정한다. 빈 `/data`에 복원하려 하면 이미 존재하는 경로라 거부된다. 새 복원 경로의 권한과 여유 공간도 확인한다.

```bash
sudo docker compose up -d
sudo docker compose ps
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8790/health
sudo ss -lntp
```

두 서비스가 healthy이고, 외부용 주소에 8787/8790이 바인딩되지 않았는지 확인한다. 공개 서버 `/api/health`는 404가 맞다. 문제 시 `sudo docker compose logs --tail=80 storage share`를 읽되 키·본문이 포함된 로그를 그대로 공유하지 않는다.

## 7. 개인 HTTPS와 모바일 PWA

Tailscale 공식 패키지 설치 방법은 [Linux 설치 안내](https://tailscale.com/download/linux)를 따른다. 설치 스크립트를 확인하고 실행하려면:

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/leneu-tailscale-install.sh
less /tmp/leneu-tailscale-install.sh
sudo sh /tmp/leneu-tailscale-install.sh
sudo tailscale up
sudo tailscale serve --bg http://127.0.0.1:8787
sudo tailscale serve status
```

PC와 휴대폰도 동일한 Tailscale 계정으로 연결한다. HTTPS 활성화 안내가 나타나면 관리 콘솔에서 허용한다. Serve가 출력하는 `https://...ts.net` 주소가 개인 앱 주소다. Serve는 tailnet 안에서만 접근하지만, 기본 접근 정책이 다른 구성원까지 허용할 수 있으므로 **본인 소유 기기/사용자만 서버 443에 접근하도록 정책을 제한하고 다른 사용자 접근 거부를 실제 확인**한다. [Serve 명령과 HTTPS](https://tailscale.com/docs/reference/tailscale-cli/serve).

- iPhone: Safari에서 해당 HTTPS 주소 → 공유 → 홈 화면에 추가.
- Android: Chrome에서 해당 HTTPS 주소 → 앱 설치/홈 화면에 추가.
- 오프라인 준비는 첫 접속·저장소/앱 준비가 성공한 뒤 시험한다. 비행기 모드 새 실행, 첨부 저장, 재연결 후 서버 반영을 실제 기기에서 확인한다.
- 브라우저와 설치 PWA가 같은 저장소를 공유한다고 가정하지 않는다. 같은 고정 origin을 유지한다.
- Tailscale이 꺼져 있어도 이미 준비된 오프라인 앱은 열려야 하지만 동기화는 연결 후 진행한다.

## 8. 공개 공유 도메인 (선택 사항)

`share.example.com` DNS A 레코드를 서버 IP로 연결한다. HTTPS reverse proxy는 **8790만** 연결한다. 예를 들어 호스트에 Caddy를 설치한 경우 설정은:

```caddyfile
share.example.com {
    reverse_proxy 127.0.0.1:8790
}
```

설치·인증서·서비스 설정은 [Caddy 공식 설치 안내](https://caddyserver.com/docs/install)를 따른다. Oracle NSG/보안 목록과 호스트 방화벽에 80/443을 허용한다. 개인 주소의 프록시 설정을 같은 공개 사이트에 추가하지 않는다.

`.env`의 `PUBLIC_SHARE_ORIGIN=https://share.example.com`을 변경하고 두 서비스를 재생성한다.

```bash
sudo docker compose up -d
curl -I https://share.example.com/health
curl -I https://share.example.com/api/sync/session
curl -I https://share.example.com/api/pages
```

개인 API 두 경로는 404여야 한다. 앱에서 발급한 **실제 공유 링크**로 본문·지도 이미지·허용 댓글을 확인하고, 링크 폐기 후 접근이 거부되는지 확인한다. 현재 기능은 자동 발급이 아니며 페이지에서 공유를 명시적으로 켜야 한다.

## 9. 백업·업데이트·복구

앱 설정의 자동 백업은 기본 꺼짐이다. 켠 뒤 첫 결과를 검증하고 VM 바깥에도 사본을 보관한다. 백업 위치가 같은 VM이면 VM 삭제를 견딜 수 없다.

수동 백업 (새 이름 사용):

```bash
cd /srv/leneu/app
sudo docker compose exec storage node scripts/backup-data.mjs create /data /backups/before-update-20261003
sudo docker compose exec storage node scripts/backup-data.mjs verify /backups/before-update-20261003
```

업데이트 순서: 기기 대기 작업 확인 → 백업 → 코드 복사/배포 버전 확인 → `sudo docker compose build` → `sudo docker compose up -d` → 건강/자료/공유 확인. 롤백 시 새 형식의 자료를 옛 코드가 안전하게 읽는지 먼저 확인한다. 데이터와 기기 미전송 자료를 지워서 오류를 회피하지 않는다.

복구는 앱을 정지하고 백업을 **새 경로**로 복원한 뒤 `.env`의 데이터 경로를 바꿔 재실행한다. 오프라인 동기화 구현이 활성화된 버전에서는 복원 시 epoch가 바뀌어 기존 기기의 대기 작업이 자동 재생되지 않아야 한다. 해당 버전의 [오프라인 실행 기록](../.omo/evidence/offline-workspace/PROGRESS.md)을 확인하고 기기에서 보존한 사본을 검토한다.

## 10. 설치 완료 확인

- [ ] A1 arm64·2 OCPU/12GB·계정 전체 무료 자원 범위 확인.
- [ ] 개인/공개 서비스 healthy, 영구 data/backup 경로 확인.
- [ ] 개인 주소 HTTPS, 본인 접근 허용·비인가 접근 거부.
- [ ] 인터넷에서 8787/8790 직접 접근 불가.
- [ ] 공개 주소 개인 API 404, 공유 폐기·댓글 설정 정상.
- [ ] PC/휴대폰 같은 자료, 새로고침·재부팅 후 보존.
- [ ] 설치 PWA에서 종료·비행기 모드·사진 저장·재연결 시험.
- [ ] 백업 검증 및 새 경로 복원 시험, 외부 사본 보관.

### 자주 막히는 지점

| 증상                      | 확인                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| A1 Out of capacity        | 홈 리전 가용 용량. 무료 표시 없는 유료 shape로 임의 변경하지 않는다. |
| SSH timeout               | IP, 인터넷 게이트웨이/route, TCP22 source CIDR, 호스트 방화벽.       |
| 8787 외부 접속 안 됨      | 의도된 설정. 개인 HTTPS/Tailscale 주소 사용.                         |
| PWA 설치/오프라인 안 됨   | HTTPS, service worker 준비, 같은 origin, 기기 저장소 및 구현 단계.   |
| shared comment 저장 안 됨 | 두 프로세스 모두 실행, Unix socket 볼륨, 공개 Origin, 댓글 허용.     |
| 지도 이미지 생성 실패     | 서버 `.env`, API 제공자 한도. 기존 저장 이미지와 생성 동작을 구분.   |
| 복원 경로 존재 오류       | 존재하지 않는 새 디렉터리로 복원. 기존 원본 삭제 금지.               |

실제 Oracle·휴대폰 검증 결과는 별도 기록한다. 로컬 테스트 통과만으로 원격 설치 완료라고 표시하지 않는다.
