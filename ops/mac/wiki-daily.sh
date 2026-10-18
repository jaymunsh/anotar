#!/usr/bin/env bash
# 매일 위키 갱신: 요약(apps/memory/daily.sh) -> build.py -> data.json 검증 -> 서버로 원자 업로드.
#
# 요약 단계가 실패해도 빌드와 업로드는 계속한다(기존 요약으로라도 올린다).
# 업로드가 실패하면 알림한다.
#
# 환경변수:
#   SKIP_SUMMARY=1   요약 단계를 건너뛴다(빌드+업로드만, 로컬 시험용).
#   MEMORY_DATA=...  데이터 폴더(기본 <repo>/data/memory). build.py 가 <그폴더>/site/data.json 생성.
#   MEMORY_AGENT / MEMORY_MODEL  daily.sh 에 넘길 에이전트/모델.
#   REMOTE_MEMORY_FILE  서버의 data.json 최종 경로(기본 /srv/leneu/memory/data.json).
#   DRY_RUN / REMOTE_ROOT  common.sh 의 로컬 시험 모드.
set -euo pipefail
TASK_NAME="위키 갱신"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

MEMORY_DATA="${MEMORY_DATA:-$REPO_ROOT/data/memory}"
DATA_JSON="$MEMORY_DATA/site/data.json"
REMOTE_MEMORY_FILE="${REMOTE_MEMORY_FILE:-/srv/leneu/memory/data.json}"

load_ssh_env

# 1) 요약 (실패해도 계속). daily.sh 는 push 까지 하지만 우리는 그 결과 data.json 을 직접 올린다.
if [ -n "${SKIP_SUMMARY:-}" ]; then
  log "요약 건너뜀(SKIP_SUMMARY)"
else
  log "요약 시작"
  if ! MEMORY_DATA="$MEMORY_DATA" "$MEMORY_APP/daily.sh" ${MEMORY_AGENT:+"$MEMORY_AGENT"} ${MEMORY_MODEL:+"$MEMORY_MODEL"}; then
    log "요약 단계 실패 — 기존 요약으로 빌드/업로드 계속"
    "$OPS_DIR/notify.sh" "위키 요약 경고" "요약 단계가 실패했어요. 기존 요약으로 빌드를 계속해요." || true
  fi
fi

# 2) 빌드: site/data.json 생성.
log "빌드 시작"
MEMORY_DATA="$MEMORY_DATA" python3 "$MEMORY_APP/build.py" || fail "build.py 가 실패했어요."

# 3) 검증: 존재·크기>0·JSON 파싱.
[ -f "$DATA_JSON" ] || fail "data.json 이 없어요: $DATA_JSON"
[ -s "$DATA_JSON" ] || fail "data.json 이 비어 있어요: $DATA_JSON"
python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$DATA_JSON" \
  || fail "data.json 이 올바른 JSON 이 아니에요."
bytes=$(wc -c < "$DATA_JSON" | tr -d ' ')
log "data.json 검증 통과 (${bytes} bytes)"

# 4) 업로드: .tmp 로 올린 뒤 원격에서 원자적으로 교체(mv).
tmp_remote="${REMOTE_MEMORY_FILE}.tmp"
if ! remote_put "$DATA_JSON" "$tmp_remote"; then
  fail "data.json 업로드(scp)에 실패했어요."
fi
# remote_sh 안에서는 모드에 맞게 해석된 경로를 쓴다.
r_tmp=$(remote_path "$tmp_remote")
r_final=$(remote_path "$REMOTE_MEMORY_FILE")
if ! remote_sh "mv -f '$r_tmp' '$r_final'"; then
  remote_sh "rm -f '$r_tmp'" || true
  fail "원격 교체(mv)에 실패했어요."
fi
log "업로드 완료: $REMOTE_MEMORY_FILE"
