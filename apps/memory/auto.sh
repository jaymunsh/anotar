#!/bin/zsh
# Mac 위키 요약 자동 실행. launchd(com.leneu.memory)가 매시간 ~/Applications/LeneuMemory.app을 통해 auto로 부른다.
# 앱을 거치는 이유: repo가 ~/Documents 안이라 macOS가 백그라운드 셸의 접근을 막는다. 권한은 그 앱에만 준다.
#   auto            10시 이후이고 오늘 성공 전이면 daily.sh opencode. 실패하면 다음 시간에 다시, 3번째 실패에 알림.
#   now             시각과 상관없이 바로 실행
#   status          마지막 실행·결과·모델
#   model <이름>    맨 앞에 쓸 모델(opencode/…), "기본"이면 summarize.py 기본 순서
#   install         앱 만들기 + launchd 등록
set -uo pipefail
export PATH=/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin
CODE=${0:A:h}
STATE="$HOME/Library/Application Support/leneu-memory"
LOG=$HOME/Library/Logs/leneu-memory.log
APP=$HOME/Applications/LeneuMemory.app
PLIST=$HOME/Library/LaunchAgents/com.leneu.memory.plist
mkdir -p "$STATE" "${LOG:h}"
today=$(date +%F)
get() { cat "$STATE/$1" 2>/dev/null; }
notify() { osascript -e "display notification \"$1\" with title \"위키 요약\""; }

run() {
  mkdir "$STATE/lock" 2>/dev/null || { echo "이미 실행 중"; return 0; }
  trap 'rmdir "$STATE/lock"' EXIT
  print "=== $(date '+%F %T') $1 ${$(get model):-기본 순서}" >> $LOG
  local out rc
  out=$(MEMORY_MODEL=$(get model) "$CODE/daily.sh" opencode 2>&1); rc=$?
  print -r -- "$out" >> $LOG
  # daily.sh는 요약 실패를 삼키고 계속 가므로 출력으로 판단한다.
  if (( rc == 0 )) && [[ $out != *"일부 실패"* ]]; then
    print $today > "$STATE/last-success"
    print "$(date '+%F %H:%M') 성공" > "$STATE/last-run"
    rm -f "$STATE/fails"
  else
    local d n
    read d n <<< "$(get fails)"
    [[ $d == $today ]] || n=0
    n=$(( n + 1 ))
    print "$today $n" > "$STATE/fails"
    print "$(date '+%F %H:%M') 실패 (${n}번째)" > "$STATE/last-run"
    (( n == 3 )) && notify "오늘 3번 실패했어요. 로그를 보고 수동으로 돌려 주세요."
  fi
}

case ${1:-status} in
  auto)
    (( $(date +%H) >= 10 )) || exit 0
    [[ $(get last-success) == $today ]] && exit 0
    run auto ;;
  now) run now ;;
  model)
    if [[ ${2:-기본} == 기본* ]]; then rm -f "$STATE/model"; else print -r -- "$2" > "$STATE/model"; fi ;;
  status)
    local d n
    read d n <<< "$(get fails)"
    [[ $d == $today ]] || n=0
    print "마지막 성공: ${$(get last-success):-없음}"
    print "마지막 실행: ${$(get last-run):-없음}"
    print "오늘 실패: ${n}번"
    print "맨 앞 모델: ${$(get model):-기본 순서 (mimo → minimax → deepseek → glm)}"
    print "로그: ~/Library/Logs/leneu-memory.log" ;;
  install)
    mkdir -p "${APP:h}" "${PLIST:h}"
    osacompile -o "$APP" <<EOF || exit 1
on run
	set auto to quoted form of "${0:A}"
	if (system attribute "LENEU_MEMORY_AUTO") is "1" then
		do shell script auto & " auto"
		return
	end if
	repeat
		set info to do shell script auto & " status"
		set r to button returned of (display dialog info with title "위키 요약" buttons {"모델 바꾸기", "지금 실행", "닫기"} default button "닫기")
		if r is "닫기" then exit repeat
		if r is "지금 실행" then
			do shell script auto & " now > /dev/null 2>&1 &"
			display notification "백그라운드에서 요약을 시작했어요" with title "위키 요약"
			exit repeat
		end if
		set m to choose from list {"기본 순서", "opencode/mimo-v2.6-flash-free", "opencode/minimax-m3.1-flash-free", "opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"} with prompt "맨 앞에 쓸 모델"
		if m is not false then do shell script auto & " model " & quoted form of (item 1 of m)
	end repeat
end run
EOF
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.leneu.memory</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/applet</string></array>
  <key>EnvironmentVariables</key><dict><key>LENEU_MEMORY_AUTO</key><string>1</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
    launchctl bootout gui/$UID "$PLIST" 2>/dev/null
    launchctl bootstrap gui/$UID "$PLIST" && echo "설치: $APP, $PLIST" ;;
  *) echo "사용: auto.sh [auto|now|status|model <이름|기본>|install]" >&2; exit 64 ;;
esac
