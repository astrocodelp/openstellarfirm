#!/bin/sh
# Starts the virtual screen and a window manager, then waits on the screen.
# The size must match SCREEN_WIDTH and SCREEN_HEIGHT in src/shared/computer.ts.
set -e

Xvfb :1 -screen 0 1280x800x24 -nolisten tcp &
screen_pid=$!

tries=0
until xdotool getdisplaygeometry >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 100 ]; then
    echo "The virtual screen did not start." >&2
    exit 1
  fi
  sleep 0.1
done

xsetroot -solid "#1d1d23" || true
openbox >/dev/null 2>&1 &

wait "$screen_pid"
