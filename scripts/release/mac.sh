#!/usr/bin/env bash
# Builds the macOS installers (dmg and zip, x64 and arm64) on a maintainer's Mac.
#
# Usage: scripts/release/mac.sh <tag>      (or RELEASE_REF=<tag>)
# Run it from a clean checkout of the tag. It signs and notarizes only when the
# credentials are in the environment; otherwise it builds unsigned and says so.
#
#   Signing:       CSC_LINK + CSC_KEY_PASSWORD, or CSC_NAME (Developer ID in the keychain)
#   Notarization:  APPLE_API_KEY (path to the .p8), APPLE_API_KEY_ID, APPLE_API_ISSUER
#   Upload:        GITHUB_TOKEN (optional, goes to a DRAFT release)
set -euo pipefail

# The secrets are for two steps only: the signing and notarization variables
# for electron-builder, the token for the upload. Install, lint, tests and the
# build scripts run third-party code, so the secrets leave the environment here
# and are handed over by name in a subshell. `declare +x` keeps the value in
# this shell without passing it to children.
builder_secrets=(CSC_LINK CSC_KEY_PASSWORD CSC_NAME CSC_KEYCHAIN
  CSC_INSTALLER_LINK CSC_INSTALLER_KEY_PASSWORD
  APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
  APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID)
for secret in GITHUB_TOKEN GH_TOKEN "${builder_secrets[@]}"; do
  declare +x "$secret" 2>/dev/null || true
done
unset GH_TOKEN

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "this script runs on a Mac"
tag="${1:-${RELEASE_REF:-}}"
[ -n "$tag" ] || die "usage: mac.sh <tag>"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "not a release tag: $tag"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

[ -z "$(git status --porcelain)" ] || die "the working tree is not clean; commit or stash first"
tag_commit="$(git rev-parse --verify --quiet "refs/tags/$tag^{commit}")" || die "tag $tag does not exist here (git fetch --tags)"
[ "$tag_commit" = "$(git rev-parse HEAD)" ] || die "HEAD is not at $tag; run: git checkout $tag"
[ "v$(node -p 'require("./package.json").version')" = "$tag" ] || die "tag $tag does not match package.json version"

# The explicit -u list is a second belt: a secret must never be visible here.
unset_args=()
for secret in GITHUB_TOKEN GH_TOKEN "${builder_secrets[@]}"; do unset_args+=(-u "$secret"); done
env "${unset_args[@]}" bash scripts/ci.sh

signing=0
if [ -n "${CSC_LINK:-}" ] || [ -n "${CSC_NAME:-}" ]; then
  if [ -n "${CSC_LINK:-}" ] && [ -z "${CSC_KEY_PASSWORD:-}" ]; then
    die "CSC_LINK is set without CSC_KEY_PASSWORD"
  fi
  signing=1
fi
notarize=0
if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ]; then
  [ -f "$APPLE_API_KEY" ] || die "APPLE_API_KEY must be the path of the .p8 file"
  notarize=1
elif [ -n "${APPLE_API_KEY:-}${APPLE_API_KEY_ID:-}${APPLE_API_ISSUER:-}" ]; then
  die "set all of APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or none"
fi

if [ "$signing" = 1 ] && [ "$notarize" = 1 ]; then
  printf 'macOS: SIGNED and NOTARIZED build.\n'
elif [ "$signing" = 1 ]; then
  printf 'macOS: signed but NOT notarized (no APPLE_API_* credentials); Gatekeeper will warn.\n'
else
  printf 'macOS: UNSIGNED, un-notarized build (no signing credentials); Gatekeeper will block it until opened by hand.\n'
  # Never pick up some other identity from the keychain by accident.
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  unset APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
fi

rm -rf release
# Only the signing variables reach electron-builder, never a GitHub token.
(
  export "${builder_secrets[@]}"
  pnpm exec electron-builder --mac --publish never
)

cd release
shopt -s nullglob
installers=(*.dmg *.zip)
[ "${#installers[@]}" -gt 0 ] || die "no installers were produced"
for pattern in '*.dmg' '*.zip'; do
  compgen -G "$pattern" >/dev/null || die "missing expected installer type: $pattern"
done
shasum -a 256 -- "${installers[@]}" > SHA256SUMS-mac.txt
printf '\nInstallers for %s:\n' "$tag"
for f in "${installers[@]}"; do
  printf '%12s bytes  %s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"
done
printf '\nSHA256SUMS-mac.txt:\n'
cat SHA256SUMS-mac.txt

if [ -n "${GITHUB_TOKEN:-}" ]; then
  printf '\nUploading to a draft release.\n'
  # The token goes to the upload step alone.
  (
    export GITHUB_TOKEN
    bash "$root/scripts/release/upload.sh" "$tag" "$root/release"
  )
else
  printf '\nGITHUB_TOKEN is not set: nothing uploaded. Files are in %s\n' "$root/release"
fi
