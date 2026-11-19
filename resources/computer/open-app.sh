#!/bin/sh
# Opens a program on the virtual screen and returns once its window shows,
# so the command that opened it ends while the program stays open. A model
# that looks at the screen right after this sees the window, not an empty
# desktop: Firefox takes several seconds to start.
if [ "$#" -lt 1 ]; then
  echo "Name a program to open, such as: open-app firefox-esr" >&2
  exit 2
fi
if ! command -v "$1" >/dev/null 2>&1; then
  echo "There is no program called $1 on this computer." >&2
  exit 127
fi

# The window that has the focus now, so a new one can be told apart.
before=$(xdotool getactivewindow 2>/dev/null || true)

# A session of its own, so it outlives the command that opened it. Started
# in the background of this script, setsid does not fork again, so $! is the
# program itself.
setsid "$@" >/dev/null 2>&1 </dev/null &
pid=$!

# Up to 20 seconds for a new window to take the focus. A program that hands
# its work to one already open (a second "firefox-esr <address>") ends
# instead, and its window is the one that was open.
tries=0
while [ "$tries" -lt 80 ]; do
  now=$(xdotool getactivewindow 2>/dev/null || true)
  if [ -n "$now" ] && [ "$now" != "$before" ]; then
    # A moment for the window to draw what it shows.
    sleep 1
    name=$(xdotool getwindowname "$now" 2>/dev/null || true)
    echo "Opened $1. Its window is on the screen${name:+: $name}."
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    sleep 1
    echo "Opened $1. It used a window that was already open; take a picture of the screen to see it."
    exit 0
  fi
  tries=$((tries + 1))
  sleep 0.25
done
echo "Started $1, but no window has shown yet. Take a picture of the screen in a moment."
