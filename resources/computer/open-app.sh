#!/bin/sh
# Opens a program on the virtual screen and returns at once, so the command
# that opened it ends while the program stays open.
if [ "$#" -lt 1 ]; then
  echo "Name a program to open, such as: open-app firefox-esr" >&2
  exit 2
fi
if ! command -v "$1" >/dev/null 2>&1; then
  echo "There is no program called $1 on this computer." >&2
  exit 127
fi
setsid "$@" >/dev/null 2>&1 </dev/null &
echo "Opened $1."
