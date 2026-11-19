# Desk pets in OpenStellarFirm: the plan

A desk pet is a small figure (Nova, Zib or Comet) on a launch pad built on an
Arduino Nano ESP32. You hold its lime light, talk, and it hands what you said
to one of your assistants, then speaks or glows when the work is done or waits
for you. Astro Code built it for StellarFirm cloud and decided on 19 November
2026 to publish the firmware, the 3D print files and the protocol here, under
this repository's licence, so you can set one up with OpenStellarFirm and an
ElevenLabs voice on your own ElevenLabs key.

This page is the plan. Nothing in it works until the phases below land.

## What stays true

- No account, no server of ours, no telemetry. The pet talks to the
  OpenStellarFirm app on your computer, on your home network, and nowhere else.
  Voice goes from the app to ElevenLabs on your own key.
- Desk pets are off until you turn them on. Until then the app opens no port.
- The pet never approves anything. A step that waits for you is only told to
  the pet as "needs you", and you decide it in the app.
- The microphone records only while you hold the lime light, the light is
  solid lime whenever it records, and the MIC switch cuts the microphone's
  power. No audio is kept.
- A pet's turn is your own message to the assistant you chose, through the
  same approval rules as a typed message.

## How it works

### The app is the pet's server, on your network only

When you turn Desk pets on, the app starts an HTTPS server on one port of your
computer. It refuses any connection from an address that is not on a private
network, sends no cross-site headers, and answers with `no-store`. It answers
the paths the pet already speaks: pairing, the one-time claim, a turn, a
spoken line, the inbox, the heartbeat and the voice pack.

The server's certificate is made by the app (an ECDSA P-256 key, kept with the
app's other secrets in the system keychain; with no keychain, Desk pets cannot
be turned on). The pet does not trust it by name: it trusts the exact
certificate whose SHA-256 it learned when you paired it, so another device on
your network cannot pretend to be your computer. Making a new certificate means
pairing again.

### Pairing over the USB cable

You plug the pet into your computer and press Add a desk pet. Over the cable
(pet-usb version 2) the app tells the pet the computer's address, port and the
certificate's fingerprint, and your Wi-Fi name and password, which go only over
the cable to the pet. Then, as today, the pet says a confirm code, you type it
in the app, and the pet makes its one-time claim for its token. The app keeps
only SHA-256 digests of the setup code, the confirm code and the token. A pet
with older firmware says it needs an update.

pet-usb v2 keeps v1's framing and adds three ops: `server <address or -> <port>
<fingerprint> <name>` (the address, port, certificate SHA-256 and `osf-<label>.local`
name; no secret), `wifi <ssidHex> <passwordHex or ->` and `start <setupCode>`. The
first two only stage values on the pet; `start` begins the try, so the password and
the setup code never share a line. The page asks `hello` first; a pet that answers
version 1 is told to update and is sent nothing else. The exact byte layouts are in
`src/shared/pets/usb.ts`, and the golden lines in `usb-vectors.ts` and
`firmware/pet/include/generated/usb2_vectors.h`. The window may use only Web
Serial, only for the app's own page, and only for the Arduino Nano ESP32's USB id.

The setup network (pairing from a phone) is left out of the first version: a
phone cannot carry the fingerprint safely.

### When the computer moves or the app is closed

The app answers one mDNS name of its own (`osf-<random>.local`) and advertises
nothing else. The pet keeps the last address that worked and asks for the name
when that fails; a false answer cannot fool it, because the certificate is
pinned. While the app is closed the pet saves notes, as it already does, and
sends them oldest first when the app is back. They are deleted from the pet
only after the app took them.

Your system asks once whether the app may accept connections: on Windows tick
Private networks only; on macOS allow it, and allow Local Network access;
on Linux open the port in your firewall for your home network only.

### Voice on your own ElevenLabs key

Speech to text (Scribe) and text to speech (Flash, `pcm_22050`, the format the
firmware plays) run on your own ElevenLabs key, kept in the system keychain,
sent only to `api.elevenlabs.io` and never shown, logged or put on the page.
The pet's built-in lines (starting up, listening, done, needs you) are made on
your key when you pair, so no Astro Code audio is published. If the key is
missing or refused the pet says so in a short line and the app tells you; if
your ElevenLabs quota is used up it says that.

Spoken answers: the pet speaks the assistant's answer, leaving out numbers,
amounts, addresses and links as it does today. A **Speak answers** switch in
Settings, on by default, turns that off; then the pet says only short status
lines. Answers can contain words from your files, so turn it off in a shared
room.

### Turns and notices

Settings says which assistant your desk pets talk to (your main assistant at
first). What you said is sent to that assistant as your message, marked as
from a desk pet, through the normal approval gate. If that assistant is busy,
the pet says so. The pet hears "done", "stopped", "needs you" and a check's
update; there is no budget notice, and a done notice names the assistant's
role.

## Threats on your home network

- Other devices can reach the port, but they hold no token (256 random bits)
  and cannot pass the pin; pairing and claims are rate limited.
- Spoofed addresses or mDNS answers end in a refused connection, not a leak.
- A stolen token works only from your network, can speak as you and hear the
  filtered answers; Forget deletes it at once, and Speak answers off limits
  what it hears.
- A lost pet still holds your Wi-Fi password and its token, since its flash is
  not encrypted yet. Forget it in the app.

## Licence

`firmware/`, `hardware/` and the desk pet code in `src/` are contributed by
Astro Code L.P. under this repository's licence (Apache 2.0 with the Commons
Clause). The names Nova, Zib and Comet and their look are reserved like the
rest of the marks in NOTICE: a changed version you share needs figures of its
own. The firmware's third-party libraries are listed in
`firmware/pet/THIRD-PARTY-NOTICES.md`.

## Phases

| Phase | What                                                                                                                                                                                                          | Done when                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0    | This plan, NOTICE, the firmware's third-party notices                                                                                                                                                         | Licence text reviewed; CI green                                                                             |
| P1    | The firmware and print files copied in as they are (not working with the app yet), and the shared protocol code in `src/shared/pets/` with no new dependency                                                  | The protocol, audio and spoken-line tests pass here                                                         |
| P2    | Certificate, the server, the saved state, pairing, the mDNS answer (built, `src/main/pets/`)                                                                                                                  | Tests drive every route over TLS; a public address is refused; no route can decide an approval              |
| P3    | ElevenLabs, turns, inbox and notices (built, `src/main/pets/`: the voice client, turns, the inbox, spoken notices and the voice pack)                                                                         | A stub voice passes; a refused key says so; a waiting step reaches the pet only as "needs you"              |
| P4    | Settings: Desk pets, the USB chooser, pet-usb v2 (built: `Settings, Desk pets`, `src/renderer/src/pet-usb-driver.ts`, `src/main/serial-*.ts`)                                                                 | The Wi-Fi password reaches only the cable; an old pet is told to update                                     |
| P5    | Firmware: the computer's address and pin kept on the pet, the pin check, the mDNS fallback, the key line (built, `firmware/pet/`: `core/server_pin.*`, `net/api.cpp`, pet-usb v2 in `core/usb_setup_rules.*`) | Native tests for parsing and the pin; the simulator covers the whole server path; a real board for the rest |
| P6    | Install and firewall guide, the macOS network prompt                                                                                                                                                          | Checked by hand on macOS and Windows                                                                        |

A real board is needed for the certificate check inside the firmware, the mDNS
lookup, the settings kept on the pet, USB setup and audio. Everything else runs
in CI and in the simulator.

P5 is built and tested without a board, which the simulator does not replace: it is
not built, so "the simulator covers the whole server path" is still open. What exists
is `pio test -e native` (the wire, the values, the constant-time pin comparison, what
a certificate at each depth of a chain is given, the key line) and the three firmware
images building. What it changed on the pet: there is no server address in the build;
the pet keeps the address, port, name and fingerprint it was given over the cable (after
the claim, before the token) and holds **every** connection, the claim and the voice pack
included, to that certificate inside the TLS handshake, so the token is never written
to a computer that fails the pin; it asks mDNS for the name when the address stops
working; it takes its clock from the app's `Date` header and reaches no time server; and
a refused ElevenLabs key (401 `no_access`) and a used up quota (402 `out_of_credits`)
are told apart from a forgotten pet by the error name. The phone's setup page pairs
nothing. The list of what a real board must still show is in
`firmware/pet/README.md`, "What a real board must still test". Still open: the greeting
line `setup-join` and the spelled setup network password still describe the phone
fallback.

Decided by Astro Code on 19 November 2026: the firmware and print files live in
this repository; the launch pad and the figures are both published; the voice
lines are made on each person's own key; spoken answers are on by default with
a switch.
