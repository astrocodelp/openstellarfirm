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
      xvfb openbox xdotool scrot xterm x11-xserver-utils \
      firefox-esr \
      python3 python3-pip python3-venv \
      ca-certificates curl git unzip zip less nano procps file \
      fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Everything runs as this ordinary user: the container has no root process
# after it starts, and the app drops every capability as well.
RUN useradd --create-home --uid 1000 --shell /bin/bash assistant \
 && mkdir -p /home/assistant/exchange /tmp/.X11-unix \
 && chown assistant:assistant /home/assistant/exchange \
 && chmod 1777 /tmp/.X11-unix

COPY start.sh /usr/local/bin/computer-start
COPY screenshot.sh /usr/local/bin/computer-screenshot
COPY open-app.sh /usr/local/bin/open-app
RUN chmod 0755 /usr/local/bin/computer-start /usr/local/bin/computer-screenshot /usr/local/bin/open-app

ENV DISPLAY=:1 HOME=/home/assistant LANG=C.UTF-8
USER assistant
WORKDIR /home/assistant
CMD ["/usr/local/bin/computer-start"]
