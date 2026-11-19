#!/bin/sh
# Starts the virtual screen and a window manager, then waits on the screen.
# The size must match SCREEN_WIDTH and SCREEN_HEIGHT in src/shared/computer.ts.
set -e

# A computer that was stopped and started again keeps the old screen's lock,
# which would stop the new screen from starting.
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 /tmp/.dbus-session /tmp/.computer-ready

# A session bus for the programs on the screen, at the address the image
# sets in DBUS_SESSION_BUS_ADDRESS. It is a socket in this container's /tmp,
# reached by nothing outside it. A computer without it still works.
dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --nopidfile >/dev/null 2>&1 || true

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
# What follows is set once the window manager holds the screen open: before
# that, the screen resets when its last program leaves, and forgets it.
sleep 0.5

# The terminal in a font a person and a model can read in a picture of the
# screen, not X's small bitmap one.
printf 'XTerm*faceName: DejaVu Sans Mono\nXTerm*faceSize: 12\n' | xrdb -merge - || true

# The app waits for this before its first step on the screen, so a program
# opened right away gets the window manager and the terminal's font.
touch /tmp/.computer-ready

# The background is set once the window manager runs, which would paint over it:
# night, with the app's mark quiet in the middle, so an empty screen reads as
# a desktop that is ready rather than as a grey box.
if computer-background >/tmp/background.xbm 2>/dev/null; then
  xsetroot -bitmap /tmp/background.xbm -fg "#1f1f27" -bg "#070709" ||
    xsetroot -solid "#070709" || true
else
  xsetroot -solid "#070709" || true
fi

wait "$screen_pid"
