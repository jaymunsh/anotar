#!/usr/bin/env bash
# 월 1회 복원 점검: 가장 최근에 내려받은 anotar 백업을 임시 폴더에 restore 한 뒤
# DB 를 열어 페이지/메모 수를 출력하고 정리한다.
#
# backup-data.mjs restore 는 "존재하지 않는 새 경로"만 허용하므로 mktemp 하위의
# 아직 없는 경로를 대상으로 쓴다.
set -euo pipefail
TASK_NAME="복원 점검"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BACKUP_HOME="${BACKUP_HOME:-$HOME/Backups}"
ANOTAR_LOCAL="$BACKUP_HOME/anotar"

# 가장 최근에 내려받은 백업 폴더(날짜 디렉터리 안의 automatic-*/before-*)를 찾는다.
latest=$(
  find "$ANOTAR_LOCAL" -mindepth 2 -maxdepth 2 -type d \
    \( -name 'automatic-*' -o -name 'before-*' \) 2>/dev/null \
  | while IFS= read -r p; do
      printf '%s %s\n' "$(stat -f %m "$p" 2>/dev/null || stat -c %Y "$p" 2>/dev/null)" "$p"
    done | sort -nr | head -1 | cut -d' ' -f2-
)
[ -n "$latest" ] || fail "복원 점검할 anotar 백업이 없어요($ANOTAR_LOCAL). 먼저 backup-pull 을 실행하세요."
log "복원 점검 대상: $latest"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/anotar-restore-check.XXXXXX")
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

target="$tmp/restored"   # 아직 없는 경로여야 한다
log "복원: $target"
node "$ANOTAR_APP/scripts/backup-data.mjs" restore "$latest" "$target" \
  || fail "복원(restore)에 실패했어요."

db="$target/storage.sqlite"
[ -f "$db" ] || fail "복원된 DB 가 없어요: $db"

counts=$(node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const n = (sql) => { try { return db.prepare(sql).get().c; } catch { return "n/a"; } };
const pages = n("SELECT COUNT(*) c FROM pages WHERE deleted_at IS NULL");
const captures = n("SELECT COUNT(*) c FROM captures WHERE deleted_at IS NULL");
db.close();
console.log(`pages=${pages} memos=${captures}`);
' "$db") || fail "복원 DB 조회에 실패했어요."

log "복원 점검 통과: $counts"
"$OPS_DIR/notify.sh" "복원 점검 통과" "$latest — $counts" || true
