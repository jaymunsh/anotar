# anotar-ops (Mac)

서버 밖(이 Mac)에서 돌리는 운영 작업. 위키를 매일 빌드해 서버로 올리고, 서버 백업을 내려받아 검증·보관하고, 월 1회 복원 점검을 한다.

## 설정 파일 (저장소 밖)

서버 접속 정보는 `apps/anotar/.env.oracle-server` 의 변수 이름을 그대로 쓴다. 값은 저장소에 커밋하지 않는다.

```sh
# apps/anotar/.env.oracle-server (이미 있음, 변수 이름만)
ORACLE_SSH_HOST=...
ORACLE_SSH_USER=...
ORACLE_SSH_KEY=/path/to/key
```

알림 토큰은 `~/.config/anotar-ops/env` (저장소 밖):

```sh
# ~/.config/anotar-ops/env
SERVICE_TELEGRAM_BOT_TOKEN=...
SERVICE_TELEGRAM_CHAT_ID=...
```

토큰이 없으면 notify.sh 는 macOS 데스크톱 알림으로 대체한다.

## 스크립트

| 스크립트 | 하는 일 | launchd 기본 시각 |
|---|---|---|
| `wiki-daily.sh` | memory 요약 → `build.py` → `data.json` 검증 → 서버 `/srv/leneu/memory/data.json` 원자 교체 | 매일 03:30 |
| `backup-pull.sh` | 서버 최신 anotar 백업(폴더)·harukan `planner-*.sqlite` rsync → `~/Backups/` → verify, 30일 보관(최소 7개), 최신 백업 26h 초과면 실패 | 매일 05:30 |
| `restore-check.sh` | 최신 받은 anotar 백업을 mktemp 에 restore → 페이지/메모 수 출력 → 정리 | 매월 1일 06:00 |
| `notify.sh` | Telegram sendMessage, 실패 시 osascript 알림 | (다른 스크립트가 호출) |
| `common.sh` | 공통 함수(ssh/scp/rsync 래퍼, env 로드). 단독 실행 안 함 | — |

## 설치 / 제거

```sh
ops/mac/install.sh print       # 치환된 plist 미리보기
ops/mac/install.sh install     # ~/Library/LaunchAgents 복사 + launchctl bootstrap
ops/mac/install.sh uninstall   # bootout + 제거
```

## 수동 실행

```sh
ops/mac/wiki-daily.sh                 # 전체
SKIP_SUMMARY=1 ops/mac/wiki-daily.sh  # 요약 건너뛰고 빌드+업로드만
ops/mac/backup-pull.sh
ops/mac/restore-check.sh

# launchd 로 등록된 작업을 즉시 한 번 실행
launchctl kickstart -k gui/$(id -u)/store.leneu.anotar-ops.backup-pull
```

## 서버 없이 로컬 시험

`REMOTE_ROOT` 를 로컬 디렉터리로 주면 scp/ssh/rsync 대신 그 디렉터리를 원격처럼 쓴다. `DRY_RUN=1` 은 원격 명령을 실행하지 않고 로그만 남긴다.

```sh
# 가짜 "서버" 디렉터리에 backup-data.mjs create 로 진짜 백업을 만들어 두고
REMOTE_ROOT=/tmp/fake-server ops/mac/backup-pull.sh
REMOTE_ROOT=/tmp/fake-server SKIP_SUMMARY=1 ops/mac/wiki-daily.sh
```

## 로그

`~/Library/Logs/anotar-ops/*.log` (각 작업별 stdout+stderr).
