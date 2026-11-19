#!/bin/sh
# Writes one picture of the virtual screen to standard output.
# "png" (the default) or "jpg", which is smaller.
set -e

format=png
if [ "${1:-png}" = "jpg" ]; then
  format=jpg
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
if [ "$format" = "jpg" ]; then
  scrot --overwrite --silent --quality 75 "$dir/screen.jpg"
else
  scrot --overwrite --silent "$dir/screen.png"
fi
cat "$dir/screen.$format"
