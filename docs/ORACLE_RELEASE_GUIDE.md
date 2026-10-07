# Oracle 서버에 변경 반영하기

2026-10-07 기준. 이 문서는 **이미 운영 중인 anotar를 업데이트하는 절차**다. 최초 VM·Docker 설치는 [ORACLE_INSTALLATION.md](ORACLE_INSTALLATION.md), 현재 주소·구성은 [ORACLE_LIVE_DEPLOYMENT.md](ORACLE_LIVE_DEPLOYMENT.md)를 참고한다.

## 1. 전체 흐름

```text
로컬 변경과 검증
  → 앱 소스만 별도 공개 저장소 체크아웃에 복사
  → 반영할 diff 확인 + 깨끗한 의존성 설치·빌드·테스트
  → jaymunsh/anotar의 main에 커밋·push
  → GitHub Actions의 Verify Oracle release 성공
  → Oracle의 anotar-deploy.timer가 성공한 main SHA 조회
  → 영구 마운트 검사 → ARM64 이미지 빌드
  → 운영 DB·첨부의 온라인 백업 생성·검증
  → 세 컨테이너 교체·health 확인
  → current 링크·deployed-commit 갱신
  → 외부 HTTPS·인증 경계·정적 파일 확인
```

로컬 빌드 성공, GitHub push 성공, GitHub 검증 성공, Oracle 배포 성공은 각각 다른 단계다. 마지막 서버 커밋과 실제 실행 이미지까지 일치해야 반영 완료다.

## 2. 소스와 자료의 위치

| 위치 | 역할 | 배포 시 처리 |
| --- | --- | --- |
| 로컬 `leneu-storage/` | 개발 소스 | 소스·공개 문서만 복사 |
| GitHub `jaymunsh/anotar` | 앱만 담은 공개 저장소 | 검증한 `main` 배포 |
| `/srv/leneu/source` | 서버 소스 체크아웃 | 고정 저장소 `main` 조회 |
| `/srv/leneu/releases/<SHA>` | 커밋별 릴리스 | 커밋 archive를 풀어 생성 |
| `/srv/leneu/current` | 정상 릴리스 링크 | health 통과 후 교체 |
| `/srv/leneu/deployed-commit` | 실제 반영 SHA | health 통과 후 갱신 |
| `/srv/leneu/app/.env` | 운영 설정·비밀정보 | 기존 파일을 릴리스에서 링크 |
| `/srv/leneu/data-live` | SQLite·첨부·인증·공유 원본 | 기존 bind 경로 유지 |
| `/srv/leneu/backups` | 운영 백업 | 교체 전 새 백업·검증 |
| `/srv/leneu/sites` | 독립 사이트 원본·registry | 기존 bind 경로 유지 |

페이지는 SQLite의 블록 JSON이다. 코드를 배포한다고 로컬에서 작성한 페이지가 운영 DB로 옮겨지지는 않는다. 아래 **문서 내용 반영**을 별도 수행해야 한다. 로컬 개발 사본 전체를 운영 DB 위에 덮어쓰지 않는다.

## 3. 로컬에서 릴리스 준비

### 범위 확인

현재 작업 공간의 상위 Git 저장소에는 다른 프로젝트가 함께 있을 수 있다. 이 저장소 전체를 공개 앱 저장소에 push하지 않는다. 앱 전용 `jaymunsh/anotar` 체크아웃에서 반영한다.

공개 소스에서 다음을 제외한다.

- `.env`, `.env.*` 등 운영/로컬 인증 정보. 값 없는 `.env.example`만 포함한다.
- `data/`, `backups/`, `data-backups/`, `.local-workspace/`, `hosted-sites/`.
- `node_modules/`, `dist/`, `.npm-cache/`, SQLite/WAL·개인키·로그.
- `.omo/`, 디자인 검토 스크린샷·브라우저 인증 상태·개인 자료.

기존 공개 체크아웃이 깨끗한지 확인하고 최신 `origin/main`을 가져온다. 새 반영은 최신 SHA 위에 올린다. 강제 push를 사용하지 않는다.

### 검증

앱 전용 체크아웃에서 실행한다.

```sh
npm ci
npm run build
npm test
```

- `npm ci`: lockfile대로 깨끗한 의존성 설치.
- `npm run build`: TypeScript 검사, 개인/공유 정적 빌드, 오프라인 manifest 생성.
- `npm test`: 임시 자료를 사용하는 서버·공통 기능 테스트.
- 변경한 기능의 브라우저 QA: 새/기존 페이지 저장, 원본 보존, 모바일·밝은/어두운 화면 등 실제 영향 범위를 확인한다.

검증은 실제 사용자 DB나 실제 AI 제공자 호출로 대체하지 않는다. 변경 파일·새 파일·삭제 파일을 확인한 뒤 앱 체크아웃에만 커밋한다.

## 4. GitHub 검증과 자동 배포

[`.github/workflows/oracle.yml`](../.github/workflows/oracle.yml)은 `main` push 또는 명시 workflow 실행에서 Node 24로 `npm ci` → `npm run build` → `npm test`를 실행한다.

```sh
git push origin main
gh run list --repo jaymunsh/anotar --workflow oracle.yml --limit 5
gh run view RUN_ID --repo jaymunsh/anotar
```

반영하려는 **정확한 SHA**의 workflow가 성공했는지 확인한다. 다른 커밋의 성공 결과를 이번 반영 근거로 쓰지 않는다.

Oracle의 `anotar-deploy.timer`는 약 2분 간격으로 실행한다. [`deploy/oracle-poll.py`](../deploy/oracle-poll.py)는 고정 공개 저장소의 `main`, 지정 workflow, `push/workflow_dispatch`, 성공 상태, 원본 저장소와 SHA 형식을 확인한다. GitHub용 비밀키나 GitHub 실행기에서 들어오는 SSH 연결은 사용하지 않는다.

최신 `main`과 조회된 성공 SHA가 다르면 배포 스크립트가 교체를 거절하고 다음 확인을 기다린다. 배포 잠금이 이미 잡힌 경우에도 겹쳐 실행하지 않는다. 동일 커밋 실패는 최대 세 번, 5분·15분·60분의 재시도 간격을 사용한다. 실패 시 운영자가 원인을 확인한다.

## 5. Oracle에서 실제로 실행하는 일

서버에 설치된 root 소유 `/usr/local/sbin/anotar-deploy`는 [`deploy/oracle-deploy.sh`](../deploy/oracle-deploy.sh)를 따른다.

1. 배포 잠금 획득.
2. 고정 저장소 `main`을 가져오고 요청 SHA와 비교.
3. `/srv/leneu/releases/<SHA>`에 소스 archive 생성, 기존 운영 `.env` 링크.
4. [`verify-oracle-mounts.py`](../deploy/verify-oracle-mounts.py)로 새 Compose와 현재 컨테이너의 영구 bind 경로·읽기 전용 여부 확인. 환경 출력은 비밀정보를 포함하므로 그대로 로그에 남기지 않는다.
5. [`Dockerfile.oracle`](../Dockerfile.oracle)로 서버 ARM64에서 `anotar:<SHA>` 이미지 빌드. 빌드 제한 900초.
6. 기존 storage 컨테이너에서 `backup-data.mjs create`로 **SQLite 온라인 스냅샷·참조 첨부** 백업. 이름은 `before-<SHA 앞 12자>-<UTC 시각>`. 생성·검증 각각 제한 120초.
7. `docker compose --project-name app -f compose.yaml -f compose.oracle.yaml up -d --no-build --wait --wait-timeout 120` 실행.
8. 실패하면 이전 릴리스와 이전 이미지로 Compose 교체를 되돌림.
9. 성공하면 `current`와 `deployed-commit` 갱신.

일반 배포는 DB 복원이나 workspace epoch 변경을 하지 않는다. 코드 롤백은 백업 복원과 다르며, 이미 수행된 DB 이관을 자동으로 역변환하지 않는다. 옛 코드로 되돌릴 때 새 DB 형식과의 호환을 확인한다.

## 6. 반영 완료 확인

기존 소유자 SSH 접속에서 다음을 확인한다. 접속 주소·개인키는 로컬 `.env.oracle-server` 또는 본인 SSH 설정에 있고 공개 문서에 값을 기록하지 않는다.

```sh
sudo cat /srv/leneu/deployed-commit
sudo readlink -f /srv/leneu/current
sudo docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
systemctl is-active anotar-deploy.timer anotar-tunnel.service
sudo systemctl show anotar-deploy.service -p Result -p ExecMainStatus
sudo journalctl -u anotar-deploy.service --since '30 minutes ago' --no-pager
```

세 서비스는 `app-storage-1`, `app-share-1`, `app-sites-1`이다. 모두 이번 SHA의 이미지이고 `healthy`여야 한다. 서버 내부 health 주소는 개인 `127.0.0.1:8787/api/health`, 공유 `127.0.0.1:8790/health`, 호스팅 `127.0.0.1:8792/health`다.

외부 확인:

| 요청 | 기대값 |
| --- | --- |
| `https://leneu.store/` | 앱 HTML 200 |
| 미로그인 `https://leneu.store/api/pages` | 401 |
| `https://share.leneu.store/health` | 200 |
| `https://share.leneu.store/api/pages` | 404 |
| `https://host.leneu.store/health` | 200 |
| `https://host.leneu.store/mathematics/` | 기존 샘플 200 |

앱 HTML이 참조하는 JS/CSS도 실제 200과 올바른 content-type인지 확인한다. 운영 offline manifest의 `appVersion`과 제공되는 정적 파일이 이번 빌드인지 확인한다. 사용자 비밀번호·OTP 입력과 실기기 화면 확인은 별도이며 미로그인 HTTP 검사로 대체하지 않는다.

## 7. 로컬에서 작성한 문서 내용 반영

코드 배포와 별도로, 명시적으로 선택한 문서만 반영한다. [`scripts/page-transfer.mjs`](../scripts/page-transfer.mjs)가 원본 기준 버전·본문 지문을 검사한다.

```sh
node scripts/page-transfer.mjs export BASELINE_DIR LOCAL_DATA_DIR PAGE_ID NEW_CHANGE_JSON
node scripts/page-transfer.mjs check TARGET_DATA_DIR NEW_CHANGE_JSON
node scripts/page-transfer.mjs import TARGET_DATA_DIR NEW_CHANGE_JSON
```

- `BASELINE_DIR`: 개발 사본을 만들 때 보관한 운영 기준 DB. 현재 로컬 편집 DB를 기준 DB로 쓰지 않는다.
- 새 문서는 `base: null`; 기존 문서는 기준 버전과 내용 지문을 보존한다.
- 같은 문서가 운영에서 먼저 수정됐으면 자동 덮어쓰지 않고 충돌로 중지한다.
- 휴지통 자료를 자동 복원하지 않는다. 상위 페이지와 첨부가 운영에 존재하는지도 검사한다.
- 코드 배포 백업과 별도로 문서 반영 직전 운영 백업을 보관한다.
- 상위부터 생성하고 하위 링크·계층을 확인한다. 이미 동일한 내용이면 재반영하지 않는다.
- 문서 반영에는 운영에 없는 새 첨부 바이트 업로드나 로컬 휴지통 전체 동기화가 포함되지 않는다.
- 페이지 원문·첨부·변경 JSON은 공개 GitHub·일반 로그에 올리지 않는다.

## 8. 기존 문서와 이번 기록

- [실운영 구성](ORACLE_LIVE_DEPLOYMENT.md): 주소·Cloudflare 경로·현재 서비스/AI 상태.
- [최초 설치](ORACLE_INSTALLATION.md): VM·Docker·인증의 최초 준비 기록.
- [Oracle 운영 기록](ORACLE_OPERATIONS.md): 날짜별 설정·감시·비용 경계 이력. 과거 “미배포” 표시는 당시 기록이다.
- [인증 안내](AUTHENTICATION.md), [백업 안내](../CURRENT_IMPLEMENTATION.md#자동-백업): 각 기능 운영 계약.
- 이번 배포의 SHA·GitHub 실행 번호·백업·health·문서 반영 여부는 별도 날짜별 검증 기록으로 남긴다. 토큰·계정 비밀정보·개인 본문은 포함하지 않는다.
