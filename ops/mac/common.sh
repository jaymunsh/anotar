#!/usr/bin/env bash
# anotar-ops 공통 함수. 다른 스크립트가 `source` 한다. 단독 실행하지 않는다.
#
# 서버 접속 정보는 저장소 밖 env 파일에서 읽는다 (값은 저장소에 커밋하지 않는다).
# 변수 이름은 apps/anotar/.env.oracle-server 와 같다:
#   ORACLE_SSH_HOST, ORACLE_SSH_USER, ORACLE_SSH_KEY
# 기본 env 파일 경로는 그 파일이며, ANOTAR_SSH_ENV 로 바꿀 수 있다.
#
# 로컬 시험용:
#   DRY_RUN=1       원격 명령을 실제로 실행하지 않고 echo 만 한다.
#   REMOTE_ROOT=... scp/rsync/ssh 대신 로컬 디렉터리를 원격처럼 쓴다 (서버 없이 검증).

set -euo pipefail

# 이 파일(ops/mac/common.sh)의 위치에서 저장소 경로를 유도한다.
OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$OPS_DIR/../.." && pwd)
ANOTAR_APP="$REPO_ROOT/apps/anotar"
MEMORY_APP="$REPO_ROOT/apps/memory"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# 원격 절대경로를 현재 모드에 맞게 바꾼다. REMOTE_ROOT 모드면 그 아래로, 아니면 그대로.
# remote_sh 명령 안에서 서버 경로를 쓸 때는 반드시 이 함수를 거친 값을 넣는다.
remote_path() {
  if [ -n "${REMOTE_ROOT:-}" ]; then printf '%s%s' "$REMOTE_ROOT" "$1"; else printf '%s' "$1"; fi
}

# 실패 시 알림 후 종료.
fail() {
  log "ERROR: $*"
  "$OPS_DIR/notify.sh" "anotar-ops 실패: ${TASK_NAME:-작업}" "$*" || true
  exit 1
}

# SSH env 로드. REMOTE_ROOT 모드에서는 필요 없다.
load_ssh_env() {
  [ -n "${REMOTE_ROOT:-}" ] && return 0
  local env_file="${ANOTAR_SSH_ENV:-$ANOTAR_APP/.env.oracle-server}"
  [ -f "$env_file" ] || fail "SSH 설정 파일이 없어요: $env_file"
  # shellcheck disable=SC1090
  . "$env_file"
  : "${ORACLE_SSH_HOST:?ORACLE_SSH_HOST 가 설정되어 있지 않아요}"
  : "${ORACLE_SSH_USER:?ORACLE_SSH_USER 가 설정되어 있지 않아요}"
  : "${ORACLE_SSH_KEY:?ORACLE_SSH_KEY 가 설정되어 있지 않아요}"
}

# ssh 래퍼. REMOTE_ROOT 모드면 로컬 셸로 대체한다.
remote_sh() {
  if [ -n "${REMOTE_ROOT:-}" ]; then
    if [ -n "${DRY_RUN:-}" ]; then log "DRY local sh: $*"; return 0; fi
    bash -c "$*"
    return $?
  fi
  if [ -n "${DRY_RUN:-}" ]; then log "DRY ssh: $*"; return 0; fi
  ssh -i "$ORACLE_SSH_KEY" -o StrictHostKeyChecking=accept-new \
    "${ORACLE_SSH_USER}@${ORACLE_SSH_HOST}" "$@"
}

# 로컬 파일을 원격 경로로 올린다. remote_put <local> <remote-abs-path>
remote_put() {
  local src=$1 dest=$2
  if [ -n "${REMOTE_ROOT:-}" ]; then
    local target="$REMOTE_ROOT$dest"
    if [ -n "${DRY_RUN:-}" ]; then log "DRY put: $src -> $target"; return 0; fi
    mkdir -p "$(dirname "$target")"
    cp "$src" "$target"
    return $?
  fi
  if [ -n "${DRY_RUN:-}" ]; then log "DRY scp: $src -> $dest"; return 0; fi
  scp -i "$ORACLE_SSH_KEY" -o StrictHostKeyChecking=accept-new "$src" \
    "${ORACLE_SSH_USER}@${ORACLE_SSH_HOST}:$dest"
}

# 원격 경로에서 로컬로 rsync. remote_pull <remote-abs-path> <local-dir> [extra rsync args...]
remote_pull() {
  local src=$1 dest=$2; shift 2
  if [ -n "${REMOTE_ROOT:-}" ]; then
    local from="$REMOTE_ROOT$src"
    if [ -n "${DRY_RUN:-}" ]; then log "DRY pull: $from -> $dest"; return 0; fi
    mkdir -p "$dest"
    rsync -a "$@" "$from" "$dest"
    return $?
  fi
  if [ -n "${DRY_RUN:-}" ]; then log "DRY rsync: $src -> $dest"; return 0; fi
  mkdir -p "$dest"
  rsync -a -e "ssh -i $ORACLE_SSH_KEY -o StrictHostKeyChecking=accept-new" "$@" \
    "${ORACLE_SSH_USER}@${ORACLE_SSH_HOST}:$src" "$dest"
}
