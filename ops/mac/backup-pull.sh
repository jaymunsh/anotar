#!/usr/bin/env bash
# 서버 백업을 Mac 으로 내려받아 검증·보관한다.
#
# anotar: /srv/leneu/backups 의 automatic-* 또는 before-* 중 가장 최근 폴더를
#         ~/Backups/anotar/<날짜>/ 로 rsync 후 backup-data.mjs verify.
# harukan: /srv/anotar-planner/backups 의 가장 최근 planner-*.sqlite 를
#          ~/Backups/harukan/ 로 rsync 후 sqlite3 PRAGMA integrity_check.
#
# 보관: 30일, 단 최소 7개는 남긴다(폴더/파일 모두).
# 감지: 서버 최신 anotar 백업이 26시간보다 오래됐으면 실패(자동 백업 중단 감지).
#
# REMOTE_ROOT / DRY_RUN 로 서버 없이 로컬 검증 가능.
set -euo pipefail
TASK_NAME="백업 내려받기"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ANOTAR_REMOTE_DIR="${ANOTAR_REMOTE_DIR:-/srv/leneu/backups}"
HARUKAN_REMOTE_DIR="${HARUKAN_REMOTE_DIR:-/srv/anotar-planner/backups}"
BACKUP_HOME="${BACKUP_HOME:-$HOME/Backups}"
ANOTAR_LOCAL="$BACKUP_HOME/anotar"
HARUKAN_LOCAL="$BACKUP_HOME/harukan"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
RETAIN_MIN="${RETAIN_MIN:-7}"

load_ssh_env
mkdir -p "$ANOTAR_LOCAL" "$HARUKAN_LOCAL"

# --- anotar: 최신 백업 폴더 이름과 수정 epoch 를 얻는다 ---
# 각 줄 "<epoch> <name>" 를 받아 정렬. find -maxdepth 1 로 automatic-*/before-* 만.
anotar_list_dir=$(remote_path "$ANOTAR_REMOTE_DIR")
latest_anotar=$(remote_sh "cd '$anotar_list_dir' 2>/dev/null && for d in automatic-* before-*; do [ -d \"\$d\" ] || continue; printf '%s %s\n' \"\$(stat -c %Y \"\$d\" 2>/dev/null || stat -f %m \"\$d\")\" \"\$d\"; done | sort -nr | head -1" || true)
[ -n "$latest_anotar" ] || fail "서버에서 anotar 백업 폴더를 찾지 못했어요($ANOTAR_REMOTE_DIR)."

anotar_epoch=${latest_anotar%% *}
anotar_name=${latest_anotar#* }
log "서버 최신 anotar 백업: $anotar_name (epoch $anotar_epoch)"

# 26시간보다 오래됐으면 실패 (DRY_RUN 에서는 epoch 가 비므로 건너뜀).
if [ -n "$anotar_epoch" ] && [ "$anotar_epoch" -gt 0 ] 2>/dev/null; then
  now=$(date -u +%s)
  age_h=$(( (now - anotar_epoch) / 3600 ))
  log "최신 백업 경과: ${age_h}시간"
  [ "$age_h" -le "$MAX_AGE_HOURS" ] || fail "서버 최신 백업이 ${age_h}시간 전이에요(>${MAX_AGE_HOURS}h). 자동 백업이 멈췄을 수 있어요."
fi

# 받을 위치: ~/Backups/anotar/<YYYY-MM-DD>/<백업폴더>
day=$(date +%Y-%m-%d)
dest_day="$ANOTAR_LOCAL/$day"
remote_pull "$ANOTAR_REMOTE_DIR/$anotar_name" "$dest_day" || fail "anotar 백업 rsync 실패."

pulled="$dest_day/$anotar_name"
if [ -z "${DRY_RUN:-}" ]; then
  [ -d "$pulled" ] || fail "내려받은 백업 폴더가 없어요: $pulled"
  log "anotar 백업 검증: $pulled"
  node "$ANOTAR_APP/scripts/backup-data.mjs" verify "$pulled" || fail "anotar 백업 검증(verify) 실패."
fi

# --- harukan: 최신 planner-*.sqlite ---
harukan_list_dir=$(remote_path "$HARUKAN_REMOTE_DIR")
latest_harukan=$(remote_sh "cd '$harukan_list_dir' 2>/dev/null && ls -1t planner-*.sqlite 2>/dev/null | head -1" || true)
if [ -n "$latest_harukan" ]; then
  log "서버 최신 harukan 백업: $latest_harukan"
  remote_pull "$HARUKAN_REMOTE_DIR/$latest_harukan" "$HARUKAN_LOCAL" || fail "harukan 백업 rsync 실패."
  hk_file="$HARUKAN_LOCAL/$latest_harukan"
  if [ -z "${DRY_RUN:-}" ] && [ -f "$hk_file" ]; then
    log "harukan 백업 무결성 검사"
    if command -v sqlite3 >/dev/null 2>&1; then
      result=$(sqlite3 "$hk_file" 'PRAGMA integrity_check;' || true)
      [ "$result" = "ok" ] || fail "harukan 백업 무결성 검사 실패: $result"
    else
      node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});const r=db.prepare("PRAGMA integrity_check").all();db.close();if(!(r.length===1&&r[0].integrity_check==="ok")){console.error(JSON.stringify(r));process.exit(1)}' "$hk_file" \
        || fail "harukan 백업 무결성 검사 실패."
    fi
    log "harukan 무결성 ok"
  fi
else
  log "harukan 백업이 없어요(건너뜀)."
fi

# --- 보관 정리: 30일 초과 삭제, 단 최소 7개 유지 ---
prune() {
  local dir=$1 pattern=$2
  [ -d "$dir" ] || return 0
  # 최신순 목록. 7개 이하면 아무것도 지우지 않는다.
  local items
  items=$(cd "$dir" && ls -1dt $pattern 2>/dev/null || true)
  [ -n "$items" ] || return 0
  local count; count=$(printf '%s\n' "$items" | wc -l | tr -d ' ')
  [ "$count" -le "$RETAIN_MIN" ] && { log "$dir: ${count}개, 최소 유지 수 이하 — 정리 안 함"; return 0; }
  local idx=0 cutoff; cutoff=$(( $(date +%s) - RETAIN_DAYS*86400 ))
  while IFS= read -r name; do
    idx=$((idx+1))
    [ "$idx" -le "$RETAIN_MIN" ] && continue   # 최신 7개는 무조건 보존
    local p="$dir/$name" mtime
    mtime=$(stat -f %m "$p" 2>/dev/null || stat -c %Y "$p" 2>/dev/null || echo 0)
    if [ "$mtime" -lt "$cutoff" ]; then
      log "보관 정리: 삭제 $p"
      rm -rf "$p"
    fi
  done <<< "$items"
}

prune "$ANOTAR_LOCAL" "*"
prune "$HARUKAN_LOCAL" "planner-*.sqlite"
log "백업 내려받기 완료"
