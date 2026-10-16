#!/bin/zsh
# 세션 가져오기 + 요약 + 빌드 + (remote 있으면) push.
# 사용: ./daily.sh [claude|codex|opencode] [모델]
#   예: ./daily.sh codex gpt-6.1-sol      ./daily.sh opencode omlx-local/qwen3.6-optiq
# 인자 없으면 MEMORY_AGENT / MEMORY_MODEL 환경변수, 그것도 없으면 claude 기본 모델.
set -euo pipefail
CODE="${0:A:h}"
cd "${MEMORY_DATA:-$HOME/Documents/Service/memory-data}"

AGENT=${1:-${MEMORY_AGENT:-claude}}
MODEL=${2:-${MEMORY_MODEL:-}}
PROMPT="AGENTS.md의 sessions 절차를 그대로 따른다. 확인 질문 없이 끝까지 진행하고, summarized_by에는 너의 하네스와 모델을 적는다."

case $AGENT in
  claude)
    claude -p "$PROMPT" ${MODEL:+--model "$MODEL"} \
      --allowedTools "Bash(python3:*) Bash(git:*) Bash(ls:*) Read Write Edit Glob Grep" ;;
  codex)
    codex exec --full-auto ${MODEL:+-m "$MODEL"} "$PROMPT" ;;
  opencode)
    opencode run ${MODEL:+-m "$MODEL"} "$PROMPT" ;;
  *)
    echo "알 수 없는 에이전트: $AGENT (claude | codex | opencode)" >&2; exit 1 ;;
esac

python3 "$CODE/build.py"
git remote | grep -q . && git push -q || true
