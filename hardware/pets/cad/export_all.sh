#!/usr/bin/env bash
# Runs every desk pet export: the launch pad, then Nova, Zib and Comet. A script that does not
# exist yet is skipped with a message. OUT is passed through to each script (default: ./out
# next to this script), so
#
#   OUT=/some/folder ./export_all.sh
#
# writes /some/folder/base, /some/folder/nova, /some/folder/zib and /some/folder/comet.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export OUT="${OUT:-$HERE/out}"

for name in base nova zib comet; do
  script="$HERE/export_$name.sh"
  if [ -f "$script" ]; then
    echo "==> $name"
    bash "$script"
  else
    echo "==> $name: $script does not exist yet, skipping"
  fi
done
