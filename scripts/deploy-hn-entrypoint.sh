#!/usr/bin/env bash
# Stable forced-command target installed outside the deployable app checkout.
# SSH access using the HN deploy key can do exactly one thing: deploy the
# current public main commit named by GitHub Actions.
set -Eeuo pipefail

readonly APP_ROOT="/home/drose/manual-apps/david-site"
readonly REPO_URL="https://github.com/cipher982/drose_io.git"
readonly COMMAND="${SSH_ORIGINAL_COMMAND:-}"

if [[ "$COMMAND" =~ ^deploy[[:space:]]([0-9a-f]{40})$ ]]; then
  sha="${BASH_REMATCH[1]}"
else
  echo "unsupported SSH command" >&2
  exit 2
fi

fetch_dir="$(/usr/bin/mktemp -d "${APP_ROOT}/.fetch.XXXXXX")"
trap '/usr/bin/rm -rf "$fetch_dir"' EXIT

/usr/bin/git clone --quiet --depth 1 --branch main "$REPO_URL" "$fetch_dir/repo"
actual="$(/usr/bin/git -C "$fetch_dir/repo" rev-parse HEAD)"
[[ "$actual" == "$sha" ]] || {
  echo "requested commit is no longer current on main: expected=$sha actual=$actual" >&2
  exit 1
}

exec "$fetch_dir/repo/scripts/deploy-hn-archive.sh" "$sha" "$fetch_dir/repo"
