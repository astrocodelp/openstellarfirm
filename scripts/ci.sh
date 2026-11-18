#!/usr/bin/env bash
# The checks GitHub Actions would have run: install, lint, typecheck, test, build.
# Works on a laptop and inside a container. Run it from anywhere.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

step() { printf '\n== %s ==\n' "$1"; }

step "install (frozen lockfile)"
pnpm install --frozen-lockfile
step "lint"
pnpm lint
step "typecheck"
pnpm typecheck
step "test"
pnpm test
step "build"
pnpm build
printf '\nAll checks passed.\n'
