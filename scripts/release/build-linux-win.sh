#!/usr/bin/env bash
# Builds the Linux (AppImage, tar.gz) and Windows (NSIS) installers for one tag.
# Meant to run INSIDE the electronuserland/builder:wine container (fly-run.sh
# starts it there). It clones the public repository at the tag, so what is built
# is what anyone can read.
#
# Environment:
#   RELEASE_REF   required  a tag such as v0.1.0
#   RELEASE_REPO  required  the GitHub repository, owner/name (fly-run.sh sets
#                           it from package.json)
#   GITHUB_TOKEN  optional  when set, the installers go to a DRAFT release
#   WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD  optional  Windows code signing
set -euo pipefail

# The secrets are for two steps only: the Windows signing variables for
# electron-builder, the token for the upload. Everything else (install, lint,
# tests, the build scripts) runs untrusted-ish third-party code, so the secrets
# are taken out of the environment here and handed over by name in a subshell.
# `declare +x` keeps the value in this shell without passing it to children.
for secret in GITHUB_TOKEN GH_TOKEN WIN_CSC_LINK WIN_CSC_KEY_PASSWORD; do
  declare +x "$secret" 2>/dev/null || true
done
unset GH_TOKEN

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

ref="${RELEASE_REF:-}"
[ -n "$ref" ] || die "RELEASE_REF is not set (a tag such as v0.1.0)"
[[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "RELEASE_REF is not a release tag"
repo="${RELEASE_REPO:-}"
[[ "$repo" =~ ^[0-9A-Za-z._-]+/[0-9A-Za-z._-]+$ ]] || die "RELEASE_REPO is not set (owner/name)"
repo_url="https://github.com/$repo.git"

command -v node >/dev/null || die "node is not installed in this image"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "Node 22 or newer is needed, this image has $(node -v)"
command -v git >/dev/null || die "git is not installed in this image"
command -v corepack >/dev/null || die "corepack is not available in this image"

work="$(mktemp -d)"
src="$work/src"
export GIT_TERMINAL_PROMPT=0

printf 'Cloning %s at %s\n' "$repo_url" "$ref"
git clone --quiet --depth 1 --branch "$ref" -- "$repo_url" "$src"
cd "$src"
# --branch also accepts a branch; a release must be a tag.
git show-ref --verify --quiet "refs/tags/$ref" || die "$ref is not a tag in the repository"

pkg_version="$(node -p 'require("./package.json").version')"
[ "v$pkg_version" = "$ref" ] || die "tag $ref does not match package.json version $pkg_version"

pm="$(node -p 'require("./package.json").packageManager')"
[[ "$pm" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "unexpected packageManager: $pm"
corepack enable
corepack prepare "$pm" --activate
pnpm --version

# Checks first (install, lint, typecheck, test, build): no installer from a red tree.
# The explicit -u list is a second belt: a secret must never be visible here.
env -u GITHUB_TOKEN -u GH_TOKEN -u WIN_CSC_LINK -u WIN_CSC_KEY_PASSWORD \
  -u CSC_LINK -u CSC_KEY_PASSWORD -u CSC_NAME bash scripts/ci.sh

if [ -n "${WIN_CSC_LINK:-}" ] && [ -n "${WIN_CSC_KEY_PASSWORD:-}" ]; then
  printf 'Windows: signing with the supplied certificate.\n'
elif [ -n "${WIN_CSC_LINK:-}${WIN_CSC_KEY_PASSWORD:-}" ]; then
  die "set both WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD, or neither"
else
  printf 'Windows: UNSIGNED build (no WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD).\n'
fi
# A macOS certificate must never be picked up for a Linux/Windows build.
unset CSC_LINK CSC_KEY_PASSWORD CSC_NAME

rm -rf release
# Only the signing variables reach electron-builder, never a GitHub token.
(
  export WIN_CSC_LINK WIN_CSC_KEY_PASSWORD
  pnpm exec electron-builder --linux --win --x64 --publish never
)

cd release
shopt -s nullglob
installers=(*.AppImage *.tar.gz *.exe)
[ "${#installers[@]}" -gt 0 ] || die "no installers were produced"
for pattern in '*.AppImage' '*.tar.gz' '*.exe'; do
  compgen -G "$pattern" >/dev/null || die "missing expected installer type: $pattern"
done

sha256sum -- "${installers[@]}" > SHA256SUMS.txt
printf '\nInstallers for %s:\n' "$ref"
for f in "${installers[@]}"; do
  printf '%12s bytes  %s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"
done
printf '\nSHA256SUMS.txt:\n'
cat SHA256SUMS.txt

if [ -n "${GITHUB_TOKEN:-}" ]; then
  printf '\nUploading to a draft release.\n'
  # The token goes to the upload step alone.
  (
    export GITHUB_TOKEN
    GITHUB_REPO="$repo" bash "$src/scripts/release/upload.sh" "$ref" "$src/release"
  )
else
  printf '\nGITHUB_TOKEN is not set: nothing uploaded. Files are in %s\n' "$src/release"
  printf 'This container is temporary, so set the token (Fly app secret) to keep the installers.\n'
fi
