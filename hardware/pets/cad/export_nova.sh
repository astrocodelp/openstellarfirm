#!/usr/bin/env bash
# Renders Nova: every part as a view STL (world coordinates, as assembled) and as
# a print STL (alone, on z = 0), plus two pictures of the assembly.
#
#   OUT=/some/dir ./export_nova.sh     default OUT is ./out next to this script
#   JOBS=2 ./export_nova.sh            parallel renders, default: number of CPUs
#
# Writes:  $OUT/nova/view/<part>.stl   $OUT/nova/print/<part>.stl  (no print file for the view-only paint parts)
#          $OUT/nova/parts.json        a copy of parts/nova.json, the parts list the site reads
#          $OUT/nova/nova.png          front three-quarter view from slightly above
#          $OUT/nova/nova_front.png    straight from the front (compare with the drawing)
#
# The front of the figure faces -Y, so the cameras sit at negative Y.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HERE/out}"
JOBS="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)}"
SCAD="$HERE/nova.scad"
DEST="$OUT/nova"

PARTS=(
  nova_body nova_helmet nova_visor nova_collar nova_backpack
  nova_chest_panel nova_chest_cap nova_antenna_stalk nova_antenna_ball
)
# Only for the 3D viewer: the visor's painted details as thin skins in their paint colour. Never
# printed, so there is no print file; the parts list marks them viewOnly.
VIEW_ONLY=(nova_paint_ivory nova_paint_lime)

command -v openscad >/dev/null 2>&1 || { echo "openscad not found (needs OpenSCAD 2021.01 or newer)" >&2; exit 1; }

mkdir -p "$DEST/view" "$DEST/print"
for p in "${VIEW_ONLY[@]}"; do rm -f "$DEST/print/$p.stl"; done   # a view-only part has no print file: drop a stale one
LOGS="$(mktemp -d 2>/dev/null || mktemp -d -t nova)"
trap 'rm -rf "$LOGS"' EXIT
export DEST SCAD LOGS

# One STL. Fails on any ERROR, on a "not a valid 2-manifold" warning, or on an empty file.
render_stl() {
  local part="$1" layout="$2"
  local out="$DEST/$layout/$part.stl" log="$LOGS/$part.$layout.log"
  if ! openscad -o "$out" -D "part=\"$part\"" -D "layout=\"$layout\"" "$SCAD" >"$log" 2>&1; then
    echo "FAILED: $layout/$part" >&2; cat "$log" >&2; exit 1
  fi
  if grep -qiE 'manifold|^ERROR' "$log"; then
    echo "WARNING that matters in $layout/$part:" >&2; grep -iE 'manifold|ERROR|WARNING' "$log" >&2; exit 1
  fi
  if [ ! -s "$out" ] || ! grep -q facet "$out"; then
    echo "EMPTY STL: $layout/$part" >&2; exit 1
  fi
  echo "  $layout/$part.stl"
}
export -f render_stl

echo "Nova: rendering ${#PARTS[@]} parts x 2 layouts and ${#VIEW_ONLY[@]} view-only parts with $JOBS parallel jobs ..."
{
  for p in "${PARTS[@]}"; do printf '%s view\n%s print\n' "$p" "$p"; done
  for p in "${VIEW_ONLY[@]}"; do printf '%s view\n' "$p"; done
} | xargs -P "$JOBS" -n 2 bash -c 'render_stl "$@"' _

# The parts list lives in the repo (parts/nova.json); the site reads the copy next to the STLs.
cp "$HERE/parts/nova.json" "$DEST/parts.json"
echo "  parts.json"

# Pictures: the preview needs an OpenGL context. Use a virtual display when there is
# no display (a CI box or a container).
GL=()
if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then GL=(xvfb-run -a); fi

picture() {
  local file="$1" camera="$2"
  ${GL[@]+"${GL[@]}"} openscad -o "$DEST/$file" --preview --imgsize=1200,1200 \
    --colorscheme=Starnight --camera="$camera" -D 'part="assembly"' "$SCAD" >"$LOGS/$file.log" 2>&1 \
    || { echo "FAILED: $file (the preview needs a display: install xvfb, or run on a desktop)" >&2; cat "$LOGS/$file.log" >&2; exit 1; }
  echo "  $file"
}

echo "Nova: pictures ..."
#         eye x,y,z          looks at x,y,z
picture nova.png       "-165,-345,205,0,8,82"
picture nova_front.png "0,-470,92,0,8,88"

echo "Nova: done -> $DEST"
