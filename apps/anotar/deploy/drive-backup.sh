#!/usr/bin/env bash
# Installed root-owned at /usr/local/sbin/leneu-drive-backup, run daily by leneu-drive-backup.timer (05:00 KST,
# after anotar's 04:00 and harukan's 04:30 backups). Copies each app's newest backup off the server:
# tar.gz → rclone crypt (contents encrypted, names readable) → Google Drive leneu-backup/<app>/daily, plus
# monthly/ on the 1st. Keeps 30 days in daily/, monthly/ forever. Pings healthchecks <app>-backup only after
# that app's upload succeeded, so a missing, stale or failed backup shows up as a missing ping.
# Config: /etc/leneu-backup/rclone.conf (remote "backup" = crypt over a drive.file token), root 0600.
set -uo pipefail
export RCLONE_CONFIG=/etc/leneu-backup/rclone.conf
day=$(TZ=Asia/Seoul date +%Y%m%d)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# app, then the backup files/dirs (relative to $base) to archive.
send() {
  local app=$1 base=$2; shift 2
  local file=$work/$app.tar.gz name=$app-$day.tar.gz
  tar -czf "$file" -C "$base" "$@" &&
    rclone copyto "$file" "backup:$app/daily/$name" &&
    { [[ ${day:6:2} != 01 ]] || rclone copyto "$file" "backup:$app/monthly/$app-${day:0:6}.tar.gz"; } &&
    rclone delete "backup:$app/daily" --min-age 30d &&
    printf 'url = "https://hc-ping.com/%s/%s-backup"\n' "$(cat /etc/leneu-oracle-alerts/hc-ping-key)" "$app" |
      curl -fsS -m 10 --retry 3 -o /dev/null -K - &&
    echo "$app: uploaded $name ($(du -h "$file" | cut -f1))"
}

# Newest backup only if it is from the last 26 hours; an old one means the app's own backup stopped.
# Type matters: automatic-backups.json sits next to the automatic-* folders.
newest() { find "$1" -maxdepth 1 -type "$3" -name "$2" -mmin -1560 -printf '%T@ %f\n' | sort -n | tail -1 | cut -d' ' -f2; }

status=0
a=$(newest /srv/leneu/backups 'automatic-*' d)
if [[ -n $a ]]; then send anotar /srv/leneu/backups "$a" || status=1
else echo "anotar: no automatic backup in the last 26 hours" >&2; status=1; fi

h=$(newest /srv/anotar-planner/backups 'planner-*.sqlite' f)
if [[ -n $h ]]; then
  # The -wal/-shm siblings belong to the same snapshot.
  send harukan /srv/anotar-planner/backups $(cd /srv/anotar-planner/backups && ls "$h" "$h-wal" "$h-shm" 2>/dev/null) || status=1
else echo "harukan: no planner backup in the last 26 hours" >&2; status=1; fi
exit $status
