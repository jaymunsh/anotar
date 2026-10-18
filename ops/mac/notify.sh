#!/usr/bin/env bash
# anotar-ops 알림: Telegram sendMessage, 실패하면 macOS 알림으로 대체.
#
# 설정(저장소 밖): ~/.config/anotar-ops/env 에서 아래 변수를 읽는다 (값은 저장소에 두지 않는다).
#   SERVICE_TELEGRAM_BOT_TOKEN=...
#   SERVICE_TELEGRAM_CHAT_ID=...
# 토큰이 없으면 osascript 로 데스크톱 알림을 띄운다.
#
# 사용: notify.sh "제목" "본문"
set -euo pipefail

title=${1:-anotar-ops}
body=${2:-}

config_env="${ANOTAR_OPS_ENV:-$HOME/.config/anotar-ops/env}"
# shellcheck disable=SC1090
[ -f "$config_env" ] && . "$config_env"

text="$title"$'\n'"$body"

if [ -n "${SERVICE_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${SERVICE_TELEGRAM_CHAT_ID:-}" ]; then
  # --data-urlencode 로 본문을 안전하게 전달한다. 토큰은 URL 에만 쓰고 출력하지 않는다.
  if curl -fsS --max-time 15 \
      "https://api.telegram.org/bot${SERVICE_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${SERVICE_TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" \
      --data-urlencode "disable_web_page_preview=true" \
      >/dev/null 2>&1; then
    exit 0
  fi
  echo "notify: Telegram 전송 실패, 데스크톱 알림으로 대체" >&2
fi

# 대체: macOS 알림 (osascript 가 있을 때만). 메시지에 큰따옴표가 있어도 안전하게 이스케이프.
if command -v osascript >/dev/null 2>&1; then
  esc_body=${body//\"/\\\"}
  esc_title=${title//\"/\\\"}
  osascript -e "display notification \"${esc_body}\" with title \"${esc_title}\"" >/dev/null 2>&1 || true
else
  echo "notify: ${text}" >&2
fi
