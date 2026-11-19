#!/bin/sh
# Starts the virtual screen and a window manager, then waits on the screen.
# The size must match SCREEN_WIDTH and SCREEN_HEIGHT in src/shared/computer.ts.
set -e

# A computer that was stopped and started again keeps the old screen's lock,
# which would stop the new screen from starting.
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

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

openbox >/dev/null 2>&1 &
# The background is set once the window manager runs, which would paint over it:
# night, with the app's mark quiet in the middle, so an empty screen reads as
# a desktop that is ready rather than as a grey box.
sleep 0.5
if computer-background >/tmp/background.xbm 2>/dev/null; then
  xsetroot -bitmap /tmp/background.xbm -fg "#1f1f27" -bg "#070709" ||
    xsetroot -solid "#070709" || true
else
  xsetroot -solid "#070709" || true
fi

wait "$screen_pid"
