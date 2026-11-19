#!/usr/bin/env bash
# Exports the launch pad (base.scad): for every part a viewer STL (world position) and a
# print STL (print orientation), plus two preview PNGs, base.png (front three-quarter from
# above) and base_back.png (from behind, to show the ports and labels). It also copies the
# parts list, parts/base.json, to $OUT/base/parts.json, where the site reads it.
#
#   ./export_base.sh                    writes to ./out/base next to this script
#   OUT=/some/folder ./export_base.sh   writes to /some/folder/base
#
# Needs OpenSCAD 2021.01 or newer. The PNGs need a display, so xvfb-run is used when it is
# installed (on a desktop without it, OpenSCAD draws them on the real display).
# Parts render in parallel; a failed render or any "not a valid 2-manifold" warning fails
# the script, since such an STL would not slice cleanly.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$(dirname "$0")/out}"
NAME=base
SCAD="$HERE/$NAME.scad"
PARTS=(base_shell base_floor base_ring_inlay)

# The Starnight colour scheme has a black background, where the pad's night colour
# (#1b1b22, the default in base.scad) cannot be told from the background. The two PNGs
# lift it to a graphite so the grille, ports and labels read; the STLs are not coloured.
PNG_PAD_COLOR="#5d5d6e"
# Cameras as eye x,y,z then look-at x,y,z (world coordinates, front faces -Y).
CAM_FRONT="165,-300,230,0,-8,15"  # front right, 33 degrees above the pad
CAM_BACK="245,265,170,10,5,16"    # behind and to the right, shows CHARGE, DATA and POWER

if ! command -v openscad >/dev/null 2>&1; then
  echo "export_base.sh: openscad was not found on PATH" >&2
  exit 1
fi
if command -v xvfb-run >/dev/null 2>&1; then
  GL=(xvfb-run -a)
else
  GL=()
fi

mkdir -p "$OUT/$NAME/view" "$OUT/$NAME/print"
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT

pids=()
labels=()
start() { # start <label> <command...>: runs in the background, its output goes to a log
  local label="$1"
  shift
  "$@" >"$LOGS/${label//\//__}.log" 2>&1 &
  pids+=("$!")
  labels+=("$label")
}

render_png() { # render_png <file> <camera>
  # crisp_preview makes OpenSCAD evaluate the shell with CGAL so the engraved labels are clean
  ${GL[@]+"${GL[@]}"} openscad -o "$1" --preview --imgsize=1200,1200 \
    --colorscheme=Starnight --camera="$2" \
    -D 'part="assembly"' -D 'crisp_preview=true' -D "pad_color=\"$PNG_PAD_COLOR\"" "$SCAD"
}

for part in "${PARTS[@]}"; do
  for layout in view print; do
    start "$layout/$part.stl" openscad -o "$OUT/$NAME/$layout/$part.stl" \
      -D "part=\"$part\"" -D "layout=\"$layout\"" "$SCAD"
  done
done
# The two PNGs run one after the other: xvfb-run picks its display number when it starts,
# and two starting at the same moment can pick the same one.
{
  render_png "$OUT/$NAME/$NAME.png" "$CAM_FRONT" &&
    render_png "$OUT/$NAME/${NAME}_back.png" "$CAM_BACK"
} >"$LOGS/png.log" 2>&1 &
pids+=("$!")
labels+=("png")

status=0
for i in "${!pids[@]}"; do
  label="${labels[$i]}"
  log="$LOGS/${label//\//__}.log"
  if wait "${pids[$i]}"; then
    secs="$(sed -n 's/^Total rendering time: *//p' "$log" | tail -1)"
    echo "ok    $label  (${secs:-done})"
  else
    echo "FAIL  $label" >&2
    cat "$log" >&2
    status=1
  fi
  if grep -E "WARNING|ERROR" "$log" >&2; then
    if grep -q "2-manifold" "$log"; then
      status=1
    fi
  fi
done

if [ "$status" -eq 0 ]; then
  # The parts list lives in the repo (parts/base.json); the site reads the copy next to the STLs.
  cp "$HERE/parts/$NAME.json" "$OUT/$NAME/parts.json"
  echo "launch pad written to $OUT/$NAME"
fi
exit "$status"
