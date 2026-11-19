#!/usr/bin/env bash
# Uploads installers and checksum files to a DRAFT GitHub release for a tag.
# Never publishes. Never overwrites an asset. The token only goes in a header.
#
# Usage: GITHUB_TOKEN=... upload.sh <tag> <folder>
# Optional: GITHUB_REPO (default astrocodelp/worker-bot-open-source)
set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$#" -eq 2 ] || die "usage: upload.sh <tag> <folder>"
tag="$1"
dir="$2"
repo="${GITHUB_REPO:-astrocodelp/worker-bot-open-source}"

[ -n "${GITHUB_TOKEN:-}" ] || die "GITHUB_TOKEN is not set"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "not a release tag: $tag"
[[ "$repo" =~ ^[0-9A-Za-z._-]+/[0-9A-Za-z._-]+$ ]] || die "bad GITHUB_REPO"
[ -d "$dir" ] || die "not a folder: $dir"
command -v curl >/dev/null || die "curl is needed"
command -v node >/dev/null || die "node is needed (to read JSON)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The token is handed to curl on stdin as a config line, so it is never in argv.
gh() {
  local method="$1" url="$2"; shift 2
  printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" |
    curl --silent --show-error --fail-with-body --proto '=https' --tlsv1.2 \
      --config - \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      -X "$method" "$@" "$url"
}

# Collect the files: installers and checksum files only.
shopt -s nullglob
files=()
for f in "$dir"/*.AppImage "$dir"/*.tar.gz "$dir"/*.exe "$dir"/*.dmg "$dir"/*.zip "$dir"/SHA256SUMS*.txt; do
  [ -f "$f" ] && files+=("$f")
done
[ "${#files[@]}" -gt 0 ] || die "nothing to upload in $dir"
for f in "${files[@]}"; do
  [[ "$(basename "$f")" =~ ^[0-9A-Za-z._-]+$ ]] || die "unsafe file name: $(basename "$f")"
done

# Find the release for this tag. Drafts are not found by the tags endpoint, so list.
found=""
for page in 1 2 3; do
  gh GET "https://api.github.com/repos/$repo/releases?per_page=100&page=$page" > "$tmp/list.json"
  hit="$(node -e '
    const fs = require("fs");
    const list = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const r = list.find((x) => x.tag_name === process.argv[2]);
    if (r) fs.writeFileSync(process.argv[3], JSON.stringify(r));
    process.stdout.write(r ? "yes" : (list.length < 100 ? "end" : "no"));
  ' "$tmp/list.json" "$tag" "$tmp/release.json")"
  [ "$hit" = "yes" ] && { found=yes; break; }
  [ "$hit" = "end" ] && break
done

if [ -z "$found" ]; then
  printf 'Creating draft release for %s\n' "$tag"
  node -e '
    process.stdout.write(JSON.stringify({
      tag_name: process.argv[1], name: process.argv[1], draft: true, prerelease: /-/.test(process.argv[1]),
      body: "Draft. Check the SHA256SUMS files before publishing.",
    }));
  ' "$tag" > "$tmp/new.json"
  gh POST "https://api.github.com/repos/$repo/releases" -H 'Content-Type: application/json' -d "@$tmp/new.json" > "$tmp/release.json"
fi

release_id="$(node -p 'const r=require(process.argv[1]); if(!r.draft) throw new Error("release is already published"); r.id' "$tmp/release.json")" ||
  die "the release for $tag is already published; refusing to touch it"
[[ "$release_id" =~ ^[0-9]+$ ]] || die "unexpected release id"

# Refuse to overwrite: check every name before the first upload, so a clash never leaves a partial set.
existing="$(node -p '(require(process.argv[1]).assets||[]).map((a)=>a.name).join("\n")' "$tmp/release.json")"
for f in "${files[@]}"; do
  name="$(basename "$f")"
  if printf '%s\n' "$existing" | grep -Fxq -- "$name"; then
    die "asset $name already exists on the draft; refusing to overwrite (delete it by hand first)"
  fi
done

done_list=()
for f in "${files[@]}"; do
  name="$(basename "$f")"
  printf 'Uploading %s\n' "$name"
  if ! gh POST "https://uploads.github.com/repos/$repo/releases/$release_id/assets?name=$name" \
      -H 'Content-Type: application/octet-stream' --data-binary "@$f" > "$tmp/asset.json"; then
    printf 'Uploaded before the failure: %s\n' "${done_list[*]:-none}" >&2
    die "upload of $name failed; the draft is incomplete, fix or delete it before publishing"
  fi
  done_list+=("$name")
done

printf '\nDone. The release is still a DRAFT: check it and publish by hand.\n'
node -p 'require(process.argv[1]).html_url' "$tmp/release.json"
