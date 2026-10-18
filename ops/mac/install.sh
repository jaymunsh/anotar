#!/usr/bin/env bash
# launchd 작업 설치/제거. 플레이스홀더를 실제 경로로 바꿔 ~/Library/LaunchAgents 에 복사하고
# launchctl bootstrap 으로 등록한다.
#
# 사용:
#   install.sh install     # 복사 + bootstrap
#   install.sh uninstall   # bootout + 제거
#   install.sh print       # 치환된 plist 를 화면에만 출력(설치 안 함)
set -euo pipefail
OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/anotar-ops"
GUI="gui/$(id -u)"
LABELS=(
  store.leneu.anotar-ops.wiki-daily
  store.leneu.anotar-ops.backup-pull
  store.leneu.anotar-ops.restore-check
)

render() {
  # {{OPS_DIR}}, {{HOME}} 치환. 경로에 &,| 가 없다고 가정(홈 경로 기준 안전).
  sed -e "s|{{OPS_DIR}}|$OPS_DIR|g" -e "s|{{HOME}}|$HOME|g" "$1"
}

cmd=${1:-}
case "$cmd" in
  print)
    for label in "${LABELS[@]}"; do
      echo "# ---- $label ----"
      render "$OPS_DIR/launchd/$label.plist.example"
    done
    ;;
  install)
    mkdir -p "$AGENTS_DIR" "$LOG_DIR"
    for label in "${LABELS[@]}"; do
      dest="$AGENTS_DIR/$label.plist"
      render "$OPS_DIR/launchd/$label.plist.example" > "$dest"
      echo "복사: $dest"
      launchctl bootout "$GUI/$label" 2>/dev/null || true
      launchctl bootstrap "$GUI" "$dest"
      echo "등록: $label"
    done
    echo "설치 완료. 수동 실행: launchctl kickstart -k $GUI/<label>"
    ;;
  uninstall)
    for label in "${LABELS[@]}"; do
      launchctl bootout "$GUI/$label" 2>/dev/null || true
      rm -f "$AGENTS_DIR/$label.plist"
      echo "제거: $label"
    done
    ;;
  *)
    echo "사용: install.sh install | uninstall | print" >&2
    exit 64
    ;;
esac
