#!/usr/bin/env bash
# Installed root-owned at /usr/local/sbin/anotar-deploy. No general shell access.
set -euo pipefail
[[ $# == 1 ]] || exit 64
[[ ${1:-} =~ ^deploy\ ([a-f0-9]{40})$ ]] || exit 64
release_commit=${BASH_REMATCH[1]}
exec 9>/run/lock/anotar-deploy.lock
flock -n 9 || exit 75
cd /srv/leneu/source
timeout 60 git fetch --quiet origin main
[[ $(git rev-parse FETCH_HEAD) == "$release_commit" ]] || exit 65
release_dir=/srv/leneu/releases/$release_commit
install -d -m 0700 "$release_dir"
git archive "$release_commit" | tar -x -C "$release_dir"
cd "$release_dir"
ln -sfn /srv/leneu/app/.env .env
export LENEU_IMAGE=anotar:$release_commit
compose=(docker compose --project-name app -f compose.yaml -f compose.oracle.yaml)
python3 deploy/verify-oracle-mounts.py
timeout 900 "${compose[@]}" build storage
# Online SQLite snapshot and attachments; data path comes from the existing environment.
backup_name=before-${release_commit:0:12}-$(date -u +%Y%m%dT%H%M%S)
timeout 120 docker exec app-storage-1 node scripts/backup-data.mjs create /data /backups/"$backup_name"
timeout 120 docker exec app-storage-1 node scripts/backup-data.mjs verify /backups/"$backup_name"
previous_dir=$(readlink -f /srv/leneu/current 2>/dev/null || printf /srv/leneu/app)
previous_image=$(docker inspect app-storage-1 --format '{{.Config.Image}}')
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 || {
  cd "$previous_dir"
  LENEU_IMAGE="$previous_image" docker compose --project-name app -f compose.yaml -f compose.oracle.yaml up -d --no-build --wait --wait-timeout 120
  exit 1
}
ln -sfn "$release_dir" /srv/leneu/current
printf '%s\n' "$release_commit" > /srv/leneu/deployed-commit
printf 'Deployed %s; services healthy\n' "$release_commit"
