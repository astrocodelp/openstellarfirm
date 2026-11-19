#!/usr/bin/env bash
# Starts one short-lived Fly Machine through the Machines REST API (no flyctl).
#
#   fly-run.sh <tag>              build the Linux and Windows installers for a tag
#   fly-run.sh --checks <ref>     run scripts/ci.sh at a commit or branch
#
# Environment: FLY_API_TOKEN and FLY_APP (both required), FLY_REGION (default
# ams). FLY_APP is the Fly app that holds this project's release secrets and
# nothing else (see docs/RELEASING.md); there is no default, so a build never
# lands in an app that holds other projects' secrets. The token only goes in a
# header, read from stdin. Secrets such as GITHUB_TOKEN are Fly app secrets:
# every Machine of the app gets them as environment, so nothing secret is in
# the request below. The repository comes from package.json.
set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
api="https://api.machines.dev/v1"
app="${FLY_APP:-}"
region="${FLY_REGION:-ams}"

# The images, pinned by digest so a build runs on exactly what was checked.
# Looked up on 2026-11-19 from Docker Hub:
#   electronuserland/builder:wine  and  node:22-bookworm
# To move to a newer image, read its digest with
#   docker buildx imagetools inspect electronuserland/builder:wine
#   docker buildx imagetools inspect node:22-bookworm
# and change it here and in docs/RELEASING.md, with the date.
release_image="electronuserland/builder@sha256:f3a8d451994c881d0972e7b1846ee4d4fdc15eb41fc6b1f350b38cbf99ca90fe"
checks_image="node@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb"

[ -n "${FLY_API_TOKEN:-}" ] || die "FLY_API_TOKEN is not set"
[ -n "$app" ] || die "FLY_APP is not set: name the Fly app that holds this project's release secrets, and only them"
[[ "$app" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || die "bad FLY_APP"
[[ "$region" =~ ^[a-z]{3}$ ]] || die "bad FLY_REGION"
command -v curl >/dev/null || die "curl is needed"
command -v node >/dev/null || die "node is needed (to read package.json)"
repo="$(node "$root/scripts/release/repo.mjs")" || die "could not read the repository from package.json"
[[ "$repo" =~ ^[0-9A-Za-z._-]+/[0-9A-Za-z._-]+$ ]] || die "bad repository in package.json"

fly() {
  local method="$1" url="$2"; shift 2
  printf 'header = "Authorization: Bearer %s"\n' "$FLY_API_TOKEN" |
    curl --silent --show-error --proto '=https' --tlsv1.2 --config - \
      -H 'Content-Type: application/json' -X "$method" "$@" "$url"
}

usage() { die "usage: fly-run.sh <tag> | fly-run.sh --checks <git ref>"; }

mode=release
if [ "${1:-}" = "--checks" ]; then
  mode=checks
  [ "$#" -eq 2 ] || usage
  ref="$2"
  [[ "$ref" =~ ^[0-9A-Za-z._/-]{1,100}$ ]] || die "bad git ref"
  case "$ref" in *..*|-*|/*) die "bad git ref" ;; esac
else
  [ "$#" -eq 1 ] || usage
  ref="$1"
  [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "not a release tag such as v0.1.0"
fi

# Every value is validated above, so the here-docs below cannot be broken out of.
if [ "$mode" = release ]; then
  image="$release_image"
  cpus=4
  memory=8192
  env_line="\"RELEASE_REF\": \"$ref\", \"RELEASE_REPO\": \"$repo\""
  skip_secrets=false
  # The script is fetched from the repository at that exact tag, then run.
  cmd='set -euo pipefail; curl --proto =https --tlsv1.2 -fsSL "https://raw.githubusercontent.com/'"$repo"'/${RELEASE_REF}/scripts/release/build-linux-win.sh" -o /tmp/build-linux-win.sh; exec bash /tmp/build-linux-win.sh'
else
  image="$checks_image"
  cpus=2
  memory=4096
  env_line="\"CHECK_REF\": \"$ref\""
  # Checks never need a secret, so the Machine is started without the app's.
  skip_secrets=true
  # A checked ref can be anyone's pull request, so its code must not see the
  # app's secrets: it runs as the unprivileged `node` user with an empty
  # environment. Releases are built only from the maintainers' own tags.
  cmd='set -euo pipefail; corepack enable; install -d -o node -g node /tmp/src; cd /tmp/src; exec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/home/node CI=1 CHECK_REF="$CHECK_REF" setpriv --reuid=node --regid=node --init-groups bash -c '"'"'set -euo pipefail; git init -q; git fetch -q --depth 1 https://github.com/'"$repo"'.git "$CHECK_REF"; git checkout -q FETCH_HEAD; exec bash scripts/ci.sh'"'"
fi

body="$(mktemp)"
resp="$(mktemp)"
trap 'rm -f "$body" "$resp"' EXIT

# cmd contains no double quote that is not escaped here; check it before using it.
case "$cmd" in *'\'*) die "internal: command contains a backslash" ;; esac
cmd_json="${cmd//\"/\\\"}"

cat > "$body" <<JSON
{
  "region": "$region",
  "skip_secrets": $skip_secrets,
  "config": {
    "image": "$image",
    "env": { $env_line },
    "guest": { "cpu_kind": "performance", "cpus": $cpus, "memory_mb": $memory },
    "auto_destroy": true,
    "restart": { "policy": "no" },
    "init": { "exec": ["/bin/bash", "-c", "$cmd_json"] }
  }
}
JSON

printf 'Starting a %s Machine in %s (%s) for %s\n' "$mode" "$app" "$region" "$ref"
status="$(fly POST "$api/apps/$app/machines" -d "@$body" -o "$resp" -w '%{http_code}')"
if [ "$status" != 200 ] && [ "$status" != 201 ]; then
  printf 'Fly answered HTTP %s:\n' "$status" >&2
  cat "$resp" >&2; printf '\n' >&2
  exit 1
fi

id="$(grep -o '"id" *: *"[0-9a-f]\{14\}"' "$resp" | head -n 1 | grep -o '[0-9a-f]\{14\}' || true)"
[ -n "$id" ] || die "could not read the Machine id from Fly's answer"
printf 'Machine %s started. Waiting for it to finish.\n' "$id"

limit=$(( $(date +%s) + 7200 ))
last=""
while :; do
  [ "$(date +%s)" -lt "$limit" ] || die "still running after 2 hours; Machine $id is left running, check it on Fly"
  sleep 20
  code="$(fly GET "$api/apps/$app/machines/$id" -o "$resp" -w '%{http_code}')" || code=000
  if [ "$code" = 404 ]; then
    state=destroyed
  elif [ "$code" = 200 ]; then
    state="$(grep -o '"state" *: *"[a-z]*"' "$resp" | head -n 1 | sed 's/.*"\([a-z]*\)"$/\1/')"
  else
    continue
  fi
  [ "$state" = "$last" ] || printf '  state: %s\n' "$state"
  last="$state"
  case "$state" in stopped|destroyed|failed) break ;; esac
done

# While the Machine still exists, its exit code is in its last events.
exit_code="$(grep -o '"exit_code" *: *-\{0,1\}[0-9]*' "$resp" | head -n 1 | grep -o -- '-\{0,1\}[0-9]*$' || true)"

printf '\nThe Machine has stopped.\n'
printf 'Read its logs with: flyctl logs --app %s --machine %s\n' "$app" "$id"
printf 'or in the dashboard: https://fly.io/apps/%s/monitoring\n' "$app"
if [ -n "$exit_code" ]; then
  printf 'Exit code: %s\n' "$exit_code"
  [ "$exit_code" = 0 ] || exit 1
else
  printf 'The exit code was not visible (the Machine is already gone). Read the logs to see whether it passed.\n'
fi
