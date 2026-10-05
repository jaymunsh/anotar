# 로컬 개발 → Ubuntu / N100 이전

2026-10-04 인증 추가 기준. 이 안내는 준비 절차이며 실제 서버 배포·도메인 연결을 수행한 기록이 아니다.

## 실행 경계

- 개인 `storage`와 공개 `share`는 같은 데이터를 사용하지만 프로세스와 네트워크를 분리한다.
- 개인 API는 비밀번호+TOTP 인증을 구현했다. Compose는 required/Secure 쿠키가 기본이며 키/계정이 없으면 개인 API를 거절한다. [최초 설정·복구·인증 운영](AUTHENTICATION.md)을 수행하고 개인 포트는 루프백으로 유지한다. 기존 Tailscale 절차는 한 운영 선택지이며, 새 Vercel/Oracle 배치는 같은 Origin `/api/*` 프록시·HTTPS·원본 제한을 별도로 검증한다. Cloudflare 공유 Tunnel에는 `share` 포트만 연결한다.
- 공유 컨테이너는 데이터 볼륨 `:ro`, 읽기 전용 루트와 `/tmp`, 댓글 전용 socket 볼륨을 사용한다. 이름 댓글은 허용한 링크에서만 가능하고 개인 댓글·검색·AI·OCR·업로드·백업 API는 공개되지 않는다.
- 공개 `/health`는 `{ok:true}`만 반환한다. 문서·키·DB 통계는 반환하지 않는다.

## N100용 이미지

Ubuntu Server와 Docker Compose를 설치한 뒤 저장소를 복사한다. Node.js를 호스트에 따로 설치할 필요 없이 앱 이미지를 쓸 수 있다.

```bash
docker compose -f compose.yaml -f compose.n100.yaml build
docker compose -f compose.yaml -f compose.n100.yaml up -d
docker compose ps
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8790/health
```

`compose.n100.yaml`은 두 서비스를 `linux/amd64`로 지정한다. Apple Silicon에서 실행하면 에뮬레이션이다. N100 실제 CPU·SSD·네트워크 측정과 같지 않다. 기본 `compose.yaml`은 현재 호스트 아키텍처를 사용한다.

개인 서비스가 healthy가 된 뒤 공유 서비스를 시작한다. 30초마다 5초 한도로 상태를 확인하고 3회 실패하면 unhealthy다. 자동 재시작 정책은 프로세스 종료에 적용하며 unhealthy 상태만으로 재시작하지는 않는다.

## 데이터 이전과 복원

이전 전에 작성 중인 페이지·메모·프롬프트 초안을 저장한다. 브라우저 localStorage/IndexedDB 초안과 최근 선택은 서버 백업이 아니며 주소를 바꾸면 자동 이동하지 않는다.

호스트 Node 24를 사용할 수 있는 개발 환경에서:

```bash
npm run backup -- create ./data /absolute/path/backup-snapshot
npm run backup -- verify /absolute/path/backup-snapshot
npm run backup -- restore /absolute/path/backup-snapshot /absolute/path/new-data
```

기존 `data/`에 덮어 복원하지 않는다. 검증된 백업을 **새 경로**로 복원하고, 앱을 중지한 뒤 Compose의 데이터 볼륨이 그 경로를 가리키도록 설정한다. SQLite 온라인 백업은 DB와 참조 파일의 체크섬을 보관한다. 댓글·OCR 결과·Task 채택 영수증·프롬프트 수정본도 SQLite에 포함된다.

원본 폴더를 직접 복사할 경우 개인/공개 프로세스를 모두 종료하고 `data/` 전체를 함께 복사한다. 실행 중 SQLite 파일 하나만 복사하지 않는다. 자동 백업의 별도 `backups/automatic-backups.json` 설정과 실행 목록, `.env`도 별도로 옮긴다. `.env`는 공개 링크·저장소에 넣지 않는다.

## 선택적 AI 실행기

앱 컨테이너에 macOS용 Devin 바이너리나 인증 파일을 복사하지 않는다. Linux에서 설치한 CLI를 쓰거나 기존 HTTP 게이트웨이 계약에 맞는 실행기를 연결한다.

Compose는 다음 환경 변수를 개인 프로세스에만 전달한다:

- `AI_RUNNER_KIND=http`, `AI_RUNNER_URL`, `AI_RUNNER_TOKEN`
- `OCR_RUNNER_URL`, `OCR_RUNNER_TOKEN`
- `GOOGLE_MAPS_DEMO_KEY`, `PUBLIC_SHARE_ORIGIN`

실행기 URL은 신뢰된 고정 설정이다. HTTPS, 또는 **같은 프로세스 환경의 루프백 HTTP**만 허용한다. Docker의 `127.0.0.1`은 컨테이너 자체이므로 호스트 에이전트를 가리키지 않는다. 호스트/다른 컨테이너의 실행기는 인증된 HTTPS 진입점으로 연결한다. 기본 Compose AI는 꺼져 있다.

### OCR 게이트웨이 계약

명시적 이미지 요청만 전송한다. PNG·JPEG·WebP 최대 5MB, 동시 처리 1개, 전체 대기/처리 100개 한도, 작업당 60초다. API 제공자에 맞춰 게이트웨이가 아래 입력을 변환한다.

```json
{
  "schemaVersion": 1,
  "jobId": "UUID",
  "kind": "ocr",
  "image": { "mime": "image/png", "base64": "IMAGE_BYTES" },
  "policy": {
    "tools": false,
    "treatImageAsData": true,
    "maxOutputCharacters": 64000,
    "output": "text"
  }
}
```

응답: `Content-Type: application/json`, `{"text":"인식한 텍스트"}`. 응답 최대 256KiB·본문 64,000자이며 도구 실행/이미지 안의 지시문 수행을 허용하지 않는다. 토큰은 서버 환경에만 둔다. 실제 제공자 구현·인증·요금은 아직 연결하지 않았다. 실패/중단을 별도 결과로 보관하고 재요청은 새 작업이다. 결과 이력과 검색은 정확한 작업을 선택한다.

## 운영 시 확인할 것

- Tailscale 개인 접근과 공개 Tunnel의 포트 분리, 실제 도메인·TLS.
- 재부팅 후 시작, 프로세스 중단 후 복구, 디스크 공간과 실제 N100 지연/RSS.
- 다른 디스크/기기로의 백업 사본, 새 경로에 복원 후 첨부 열기.
- 지도 API의 실제 키/API/사이트 제한과 사용량. 공개/오프라인 뷰는 SDK를 호출하지 않는다.
- 이름 기반 공개 댓글을 구현했다. 이름은 본인 인증이 아니며 링크에서 댓글을 허용한 경우만 작성 가능하다. 방문자 로그인·직접 수정/삭제·외부 알림은 제공하지 않는다.
- 오프라인 ZIP은 읽기 사본이다. 편집·PWA 전체 오프라인 동기화·오프라인 Mermaid 렌더링은 제공하지 않는다. 외부 지도 링크는 온라인 연결이 필요하고 이미 전달한 ZIP은 공유 링크 폐기만으로 회수할 수 없다.

검증 기록: [.omo/evidence/predeployment/REPORT.md](../.omo/evidence/predeployment/REPORT.md).

## 개인/공유 주소와 댓글 통신

예: 개인은 `mini.<tailnet>.ts.net` 또는 Tailscale로 제한한 `app.example.com`, 공유는 `share.example.com`. 실제 DNS와 Tunnel은 운영 단계에서 연결한다. 공개 Tunnel 대상은 공유 포트 8790뿐이다. 도메인 이름만 바꾸어 개인 API를 공개하지 않는다.

`.env`의 `PUBLIC_SHARE_ORIGIN=https://share.example.com`은 Compose의 두 프로세스에 전달한다. 공유 댓글 POST의 Origin도 같은 주소로 검사한다. 로컬 테스트는 `http://127.0.0.1:8790`을 사용한다. 기본 Unix socket은 `DATA_DIR/share-comments.sock`; Compose에서는 `/run/leneu/share-comments.sock`의 `comment-ipc` 볼륨을 사용한다. 개인 프로세스가 socket을 먼저 만들며 공유 프로세스는 고정 댓글 경로만 요청한다. 백업은 main SQLite에 저장된 개인/공유 댓글을 모두 포함하며 socket 자체는 복원할 데이터가 아니다.

댓글 경계 변경 후 실제 N100 Docker/도메인/재부팅 연결은 대상 환경에서 확인한다. 기존 Docker 실행 검증을 새 socket 경계의 운영 검증으로 확대하지 않는다.

Socket은 `0600` 권한이므로 개인·공유 프로세스는 같은 OS 사용자로 실행한다. 현재 Compose는 두 컨테이너의 실행 UID가 같으며, 운영에서 UID를 변경하면 양쪽을 함께 변경한다. 댓글 속도 제한은 프로세스 메모리에 저장하고 실제 연결 peer 기준으로 검사한다. Tunnel 뒤에서는 여러 방문자가 같은 peer 제한(쓰기 분당 10회)을 공유하므로 소수 인원 사용을 넘어 확장할 때 trusted proxy 설계를 별도로 검토한다.

## 이전 실행 순서 (현재 개발본)

### 1. 환경과 파일 경로

새 서버의 저장소에서 `.env.example`을 `.env`로 복사한 뒤 실제 값을 입력한다. 기존 `.env`는 덮어쓰지 않는다. 비밀 없는 예시에는 AI/OCR가 꺼져 있다.

- `LENEU_DATA_DIR`: 개인/공개가 함께 읽는 실제 데이터 경로. 복원한 새 디렉터리로 지정할 수 있다.
- `LENEU_BACKUP_DIR`: 데이터 경로 바깥의 백업 폴더. 공개 컨테이너에는 마운트하지 않는다.
- `LENEU_PRIVATE_PORT`/`LENEU_SHARE_PORT`: 기본 8787/8790. 호스트 바인딩은 `127.0.0.1`로 유지한다.
- `LENEU_IMAGE`: 기본 `leneu-storage:local`. 두 서비스는 동일한 빌드 이미지를 사용한다.

환경 검사에서 Compose 내부의 키/토큰 원문은 출력하지 않는다:

```bash
npm run migration:check -- --compose compose.yaml compose.n100.yaml
```

호스트 Node가 없는 서버에서는 Compose 설정 검사를 개발 머신에서 하고, HTTP 확인은 아래 컨테이너 실행 뒤 `curl`로 수행한다. 이 검사만으로 실제 Tailnet 접근 권한이나 외부 공개 차단이 확인되는 것은 아니다.

### 2. 백업을 새 경로에 복원

스냅샷 폴더(그 안의 `manifest.json`, `storage.sqlite`, `blobs/` 모두)를 서버의 백업 폴더로 옮긴다. 앱 이미지에는 백업 CLI가 포함되어 있으므로 서버 호스트에 Node를 설치할 필요가 없다.

```bash
docker compose -f compose.yaml -f compose.n100.yaml build

docker run --rm \
  -v /srv/leneu/backups:/backups:ro \
  leneu-storage:local \
  node scripts/backup-data.mjs verify /backups/snapshot

docker run --rm \
  -v /srv/leneu/backups:/backups:ro \
  -v /srv/leneu:/migration \
  leneu-storage:local \
  node scripts/backup-data.mjs restore /backups/snapshot /migration/data-restored
```

위 경로와 `snapshot`은 실제로 옮긴 경로/이름으로 바꾼다. `data-restored`는 존재하지 않는 새 경로여야 한다. `.env`에 `LENEU_DATA_DIR=/srv/leneu/data-restored`, `LENEU_BACKUP_DIR=/srv/leneu/backups`를 지정한다. 기존 원본과 검증된 스냅샷은 운영 확인이 끝날 때까지 보존한다.

자동 백업의 `automatic-backups.json` 설정/실행 목록은 SQLite 스냅샷 밖에 있다. 기존 백업 경로에서 이 파일들을 함께 옮기되, 이전 호스트의 파일 경로가 저장된 기록을 신규 호스트의 실제 파일 존재 확인으로 해석하지 않는다. `/backups`에서 경로/보관 개수/다음 실행을 확인하고 새 스냅샷을 수동으로 1회 검증한다.

### 3. 시작과 개인 HTTPS

```bash
docker compose -f compose.yaml -f compose.n100.yaml up -d --wait
curl --fail http://127.0.0.1:8787/api/health
curl --fail http://127.0.0.1:8790/health
sudo tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)는 Tailnet 내부 서비스이며 `--bg` 설정은 백그라운드에 유지된다. 개인 주소는 해당 노드의 HTTPS 주소를 사용한다. Tailnet 정책은 본인 기기/계정만 허용하도록 확인한다. 개인 앱의 단일 소유자 인증을 먼저 설정한다. 공개 공유용 Tunnel에 개인 포트를 연결하지 않는다. 모바일 설치/공유 진입은 개인 HTTPS 주소에서 사용한다. 평문 `http://100.x.y.z`는 설치용 secure origin이 아니다.

### 4. 공개 도메인

[Cloudflare published application route](https://developers.cloudflare.com/tunnel/get-started/)의 서비스 주소는 **`http://127.0.0.1:8790`**으로 설정한다. 이는 호스트에서 실행하는 `cloudflared` 기준이며 다른 컨테이너에서 실행하면 루프백의 의미가 달라진다. `share.example.com`과 같은 실제 도메인에 맞춰 `.env`의 `PUBLIC_SHARE_ORIGIN=https://share.example.com`을 설정하고 두 서비스를 재생성한다.

```bash
docker compose -f compose.yaml -f compose.n100.yaml up -d --wait
```

방문자용 사이트는 공유 토큰 주소 `/s/<token>`만 사용한다. 공개 도메인에서 `/api/pages`, `/api/tasks`, `/api/backups`, `/api/shared-comments`, `/capture-worker.js`가 404인지 확인한다. 공유 링크 발급 → 이름 댓글 → 개인 받은함 → 답글 → 링크 폐기 후 404를 실제 두 주소에서 확인한다. 공개 HTML/댓글은 Origin과 연결 폐기를 즉시 반영해야 하므로 Tunnel 앞의 별도 캐시 규칙으로 `/s/*`를 강제로 캐시하지 않는다.

### 5. 운영 전 최종 확인

- 새 경로에서 메모·페이지·첨부·개인 댓글·공유 댓글·준비 할 일을 확인한다.
- 한국시간 일일 백업을 켜고 복원 가능한 사본을 다른 디스크/기기로 옮긴다. 같은 SSD의 백업은 SSD 고장에 대비하지 못한다.
- Ubuntu 재부팅 후 Docker daemon과 두 서비스/Tailscale/cloudflared 시작을 확인한다. `unless-stopped`는 명시 중지한 컨테이너를 재부팅 때 다시 켜주지 않는다.
- 다른 네트워크의 휴대폰에서 개인 접근은 Tailnet 연결 시에만 가능하고 공개 공유는 Tailnet 없이 열리는지 확인한다.
- 실제 N100의 메모리·검색 지연·첨부 저장·디스크 여유를 측정한다. 로컬 Docker 결과는 N100 수치가 아니다.

## 반복 가능한 로컬 배포 검증

```bash
npm run qa:docker-share
npm run migration:check
npm run migration:check -- --compose compose.yaml compose.n100.yaml
```

`qa:docker-share`는 실제 사용자 데이터와 별도의 임시 Compose 프로젝트를 빌드/시작한다. 임시 컨테이너·볼륨에서 읽기 전용 공개 DB, 제한된 댓글 socket, 재시작 후 답글/첨부, 운영 이미지의 백업 CLI, 체크섬 검증·새 디렉터리 복원·덮어쓰기 거부를 검사하고 해당 프로젝트만 정리한다. `migration:check`는 GET으로 연결 상태와 공개 API 차단만 읽으며 메모 원문/환경 키를 출력하지 않는다.

최신 로컬 결과와 실제 데이터 스냅샷 위치는 [마무리 기록](../.omo/evidence/migration-ready/REPORT.md)에 있다. 최종 Docker 검증은 복원 경로로 두 서비스를 재생성하고 복원된 댓글/첨부의 조회 및 새 답글 저장까지 확인했다. 로컬 실행은 linux/arm64이고 N100 linux/amd64는 대상 서버에서 실행한다.

## 오프라인 버전 이전 (2026-10-03)

[Oracle A1 ARM64 설치](ORACLE_INSTALLATION.md)와 [기기 사본 보존](OFFLINE_USAGE.md)을 함께 따른다. 개인 HTTPS origin을 안정적으로 유지한다. 기존 주소의 미전송 queue는 새 주소로 자동 이동하지 않으므로 먼저 동기화하고 ZIP을 내려받는다. backup restore는 workspaceId를 유지하고 epoch를 바꿔 오래된 작업을 중지한다. 일반 재시작은 epoch를 유지한다.

서버 additive sync schema/trigger, 브라우저 additive IDB v2 summary migration이 있다. rollback 전 서버 백업과 기기 ZIP을 확보하고 새 schema/IDB를 읽는 코드로 복구한다. IDB 삭제/버전 하향으로 오류를 피하지 않는다. 구버전 capability/protocol이 다르면 전송을 중지하거나 미지원 작업을 대기한다.

원격 확인 사항: 본인 Tailscale HTTPS, 다른 계정 거부, 개인 포트 인터넷 차단, 공유 private API404, host/container 재시작 후 identity 유지, 실제 backup verify/새 경로 restore 후 기기 queue 중지와 선택 복구. 원격 자격 증명·실기기가 없어 본 개발에서는 수행하지 않았다.
