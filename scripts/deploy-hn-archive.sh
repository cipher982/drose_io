#!/usr/bin/env bash
# Deploy a repository checkout fetched by deploy-hn-entrypoint.
#
# The caller is intentionally explicit: the first argument is the commit SHA
# that GitHub Actions received, and the second is a temporary checkout of that
# exact (current-main) commit. This script owns only the legacy david-site app
# layout; persistent data and secrets live outside the swapped repository.
set -Eeuo pipefail

readonly APP_ROOT="/home/drose/manual-apps/david-site"
readonly CURRENT="${APP_ROOT}/repo"
readonly COMPOSE="${APP_ROOT}/compose.yaml"
readonly LOCK_FILE="${APP_ROOT}/.hn-deploy.lock"

usage() {
  echo "usage: $0 <40-hex-main-sha> <checkout-dir>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
sha="$1"
source_dir="$2"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || usage
[[ -d "$source_dir" ]] || { echo "checkout does not exist: $source_dir" >&2; exit 1; }

source_head="$(/usr/bin/git -C "$source_dir" rev-parse HEAD)"
[[ "$source_head" == "$sha" ]] || {
  echo "checkout SHA mismatch: expected=$sha actual=$source_head" >&2
  exit 1
}

for required in Dockerfile package.json bun.lock server templates public content scripts; do
  [[ -e "$source_dir/$required" ]] || {
    echo "checkout is missing required path: $required" >&2
    exit 1
  }
done

exec 9>"$LOCK_FILE"
/usr/bin/flock -n 9 || { echo "another HN deploy is already running" >&2; exit 1; }

stage="$(/usr/bin/mktemp -d "${APP_ROOT}/.staging.${sha}.XXXXXX")"
backup="${APP_ROOT}/repo.previous.${sha}.${BASHPID}"
keep_backup=0

cleanup() {
  if [[ -d "$stage" ]]; then
    /usr/bin/rm -rf "$stage"
  fi
  if [[ "$keep_backup" -eq 1 && -d "$backup" ]]; then
    echo "previous checkout retained at $backup" >&2
  fi
}
trap cleanup EXIT

/usr/bin/rsync -a --delete \
  --exclude='.git' \
  --exclude='data' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules' \
  "$source_dir/" "$stage/"

if [[ -e "$CURRENT" ]]; then
  [[ -d "$CURRENT" && ! -L "$CURRENT" ]] || {
    echo "current app checkout is not a directory: $CURRENT" >&2
    exit 1
  }
  /usr/bin/mv "$CURRENT" "$backup"
fi
/usr/bin/mv "$stage" "$CURRENT"

compose() {
  /usr/bin/docker compose --project-directory "$APP_ROOT" -f "$COMPOSE" -p david-site "$@"
}

healthy=0
if compose up -d --build; then
  for _ in $(/usr/bin/seq 1 30); do
    health="$(/usr/bin/curl -fsS --max-time 5 http://127.0.0.1:3194/api/health 2>/dev/null || true)"
    if [[ "$health" == *'"status":"ok"'* ]]; then
      healthy=1
      break
    fi
    /usr/bin/sleep 2
  done
fi

if [[ "$healthy" -ne 1 ]]; then
  echo "HN deploy failed health check; rolling back" >&2
  /usr/bin/rm -rf "$CURRENT"
  if [[ -d "$backup" ]]; then
    /usr/bin/mv "$backup" "$CURRENT"
    keep_backup=0
    compose up -d --build || true
  else
    keep_backup=1
  fi
  exit 1
fi

if [[ -d "$backup" ]]; then
  /usr/bin/rm -rf "$backup"
fi
echo "HN archive deployed: $sha"
