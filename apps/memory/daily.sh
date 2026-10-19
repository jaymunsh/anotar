#!/bin/zsh
# 세션 가져오기 + 요약 + 주간 회고 + 빌드 + (remote 있으면) push.
# 사용: ./daily.sh [claude|codex|opencode] [모델]
#   예: ./daily.sh opencode               (무료 deepseek, summarize.py로 파일마다 한 번씩)
#       ./daily.sh codex gpt-6.1-sol
#       MEMORY_EFFORT=medium ./daily.sh codex gpt-6-luna   (codex 추론 강도)
# 인자 없으면 MEMORY_AGENT / MEMORY_MODEL 환경변수, 그것도 없으면 claude 기본 모델.
# zsh는 ${X:+-m "$X"}를 한 단어('-m 값')로 넘긴다. 옵션과 값은 따로 쓴다(빈 값은 사라짐).
set -euo pipefail
CODE="${0:A:h}"
cd "${MEMORY_DATA:-$CODE/../../data/memory}"

AGENT=${1:-${MEMORY_AGENT:-claude}}
MODEL=${2:-${MEMORY_MODEL:-}}
PROMPT="AGENTS.md의 sessions 절차를 그대로 따른다. 확인 질문 없이 끝까지 진행하고, summarized_by에는 너의 하네스와 모델을 적는다."

case $AGENT in
  claude)
    claude -p "$PROMPT" ${MODEL:+--model} $MODEL \
      --allowedTools "Bash(python3:*) Bash(git:*) Bash(ls:*) Read Write Edit Glob Grep" ;;
  codex)
    # --full-auto was removed in codex 0.16x; workspace-write is the same sandbox (push happens below, outside codex).
    codex exec -s workspace-write ${MODEL:+-m} $MODEL ${MEMORY_EFFORT:+-c} ${MEMORY_EFFORT:+model_reasoning_effort=$MEMORY_EFFORT} "$PROMPT" < /dev/null ;;
  opencode)
    # 에이전트 한 번에 전부 맡기면 무료 모델은 맥락이 넘쳐 멈춘다. summarize.py가 파일·주마다 부른다.
    python3 "$CODE/import_sessions.py"
    MEMORY_MODEL="$MODEL" python3 "$CODE/summarize.py" sessions || echo "요약 일부 실패: 다음 실행 때 다시 시도"
    MEMORY_MODEL="$MODEL" python3 "$CODE/summarize.py" weekly || echo "회고 일부 실패: 다음 실행 때 다시 시도"
    git add sessions digests runs.jsonl && git commit -qm "sessions: $(date +%F) 요약·주간 회고" || true ;;
  *)
    echo "알 수 없는 에이전트: $AGENT (claude | codex | opencode)" >&2; exit 1 ;;
esac

python3 "$CODE/build.py"
git remote | grep -q . && git push -q || true
