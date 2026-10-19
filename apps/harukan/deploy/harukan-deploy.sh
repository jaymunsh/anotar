#!/usr/bin/env bash
# Installed root-owned at /usr/local/sbin/harukan-deploy; called by oracle-poll.py harukan (harukan-deploy.timer)
# with "deploy <sha>" once harukan.yml passed on main. Same steps as the manual release in LAUNCH_RUNBOOK.md:
# apps/harukan of that commit → releases/<date>-<sha12>, backup, build, swap, health check; rolls back on failure.
set -euo pipefail
[[ $# == 1 && ${1:-} =~ ^deploy\ ([a-f0-9]{40})$ ]] || exit 64
commit=${BASH_REMATCH[1]}
exec 9>/run/lock/harukan-deploy.lock
flock -n 9 || exit 75

root=/srv/anotar-planner
[[ -d $root/source/.git ]] || git clone --quiet --filter=blob:none https://github.com/jaymunsh/anotar.git "$root/source"
cd "$root/source"
timeout 60 git fetch --quiet origin main
[[ $(git rev-parse FETCH_HEAD) == "$commit" ]] || exit 65

release=$(date -u +%Y%m%d)-${commit:0:12}
dir=$root/releases/$release
install -d -m 0755 "$dir"
git archive "$commit:apps/harukan" | tar -x -C "$dir"
ln -sfn "$root/.env" "$dir/.env"

previous=$(readlink -f "$root/current")
previous_release=$(sed -n 's/^PLANNER_RELEASE=//p' "$root/.env")
# An array, not a function: timeout runs a program and cannot see shell functions.
compose=(docker compose -f compose.oracle.yaml)
use() { sed -i "s/^PLANNER_RELEASE=.*/PLANNER_RELEASE=$1/" "$root/.env"; ln -sfn "$2" "$root/current"; }

# Back up from the running version before anything changes.
(cd "$previous" && timeout 120 "${compose[@]}" exec -T planner node scripts/backup.mjs)
(cd "$dir" && PLANNER_RELEASE=$release timeout 900 "${compose[@]}" build --quiet)
use "$release" "$dir"
if (cd "$dir" && timeout 180 "${compose[@]}" up -d --wait) && curl -fsS --max-time 5 http://127.0.0.1:8794/api/health >/dev/null; then
  printf '%s\n' "$commit" > "$root/deployed-commit"
  echo "Deployed harukan $commit as $release"
  # Same as anotar-deploy: drop images no container uses, but not ones built in the last day.
  docker image prune -af --filter until=24h >/dev/null || true
else
  echo "harukan $release failed; returning to $previous_release" >&2
  use "$previous_release" "$previous"
  (cd "$previous" && timeout 180 "${compose[@]}" up -d --wait)
  exit 1
fi
