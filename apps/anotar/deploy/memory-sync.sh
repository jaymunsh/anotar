#!/usr/bin/env bash
# Installed root-owned at /usr/local/sbin/leneu-memory-sync, run as leneu-memory by leneu-memory-sync.timer.
# Releases are root-only, so the unit first copies apps/memory/{build.py,README.md,GUIDE.md} to /var/lib/leneu-memory/code.
# Wiki (B안): pull the private memory-data repo with a read-only deploy key, build with the deployed
# release's apps/memory/build.py, and swap /srv/leneu/memory/data.json (mounted read-only into anotar).
set -euo pipefail
src=/srv/leneu/memory-src out=/srv/leneu/memory/data.json
export GIT_SSH_COMMAND="ssh -i /var/lib/leneu-memory/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/lib/leneu-memory/known_hosts"
cd "$src"
before=$(git rev-parse HEAD)
timeout 60 git pull --ff-only --quiet
code=/var/lib/leneu-memory/code
[[ -f $code/build.py ]] || { echo "build.py not copied from the current release" >&2; exit 66; }
# Nothing new and already built: done.
[[ $(git rev-parse HEAD) == "$before" && -s site/data.json && ${1:-} != --force ]] && cmp -s site/data.json "$out" && { echo "memory: unchanged $before"; exit 0; }
MEMORY_DATA=$src timeout 120 python3 "$code/build.py"
install -m 0644 "$src/site/data.json" "$out.new"
mv -f "$out.new" "$out"
echo "memory: built $(git rev-parse --short HEAD)"
