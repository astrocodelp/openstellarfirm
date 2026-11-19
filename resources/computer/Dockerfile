# An assistant's own computer: a small Linux desktop that runs in Docker on
# the person's computer. OpenStellarFirm builds it on the person's click, from
# this file, and never pulls a ready-made image of ours.
#
# The base is pinned by digest, so the same file always starts from the same
# bytes. The packages come from Debian's own mirror at build time.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb openbox xdotool scrot xterm x11-xserver-utils dbus-daemon \
      firefox-esr \
      python3 python3-pip python3-venv \
      ca-certificates curl git unzip zip less nano procps file \
      fonts-dejavu-core fonts-liberation fonts-wqy-microhei fonts-unfonts-core \
 && rm -rf /var/lib/apt/lists/*

# Everything runs as this ordinary user: the container has no root process
# after it starts, and the app drops every capability as well. On Linux the
# app gives it the person's own ids, so it can use the exchange folder the
# person owns; elsewhere they stay 1000. A group the image already has (such
# as "users") is used as it is.
ARG ASSISTANT_UID=1000
ARG ASSISTANT_GID=1000
RUN (getent group "$ASSISTANT_GID" >/dev/null || groupadd --gid "$ASSISTANT_GID" assistant) \
 && useradd --create-home --no-log-init --uid "$ASSISTANT_UID" --gid "$ASSISTANT_GID" --shell /bin/bash assistant \
 && mkdir -p /home/assistant/exchange /tmp/.X11-unix \
 && chown "$ASSISTANT_UID:$ASSISTANT_GID" /home/assistant/exchange \
 && chmod 1777 /tmp/.X11-unix

# Every program's main window fills the screen, as on a phone: a window the
# size of the screen is where a click lands, and a click on the bare desktop
# beside a small window would take the keyboard away from it. Dialogs keep
# their own size.
RUN sed -i 's#^</applications>#  <application class="*" type="normal"><maximized>yes</maximized></application>\n</applications>#' /etc/xdg/openbox/rc.xml \
 && grep -q 'type="normal"><maximized>yes' /etc/xdg/openbox/rc.xml

COPY start.sh /usr/local/bin/computer-start
COPY screenshot.sh /usr/local/bin/computer-screenshot
COPY open-app.sh /usr/local/bin/open-app
COPY background.py /usr/local/bin/computer-background
# Firefox starts on a blank page, with no welcome tabs, no privacy notice tab
# and no recommendations: each of those reaches the network and puts a page
# in front of the one the assistant was asked to open.
COPY firefox-policies.json /usr/lib/firefox-esr/distribution/policies.json
RUN chmod 0755 /usr/local/bin/computer-start /usr/local/bin/computer-screenshot /usr/local/bin/open-app /usr/local/bin/computer-background \
 && chmod 0644 /usr/lib/firefox-esr/distribution/policies.json

# The session bus start.sh runs, inside the container only. Firefox finds the
# window it already has through it, so "open-app firefox-esr <address>" opens
# a tab there instead of a second Firefox that says it is already running.
ENV DISPLAY=:1 HOME=/home/assistant LANG=C.UTF-8 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/.dbus-session
USER assistant
WORKDIR /home/assistant
CMD ["/usr/local/bin/computer-start"]
