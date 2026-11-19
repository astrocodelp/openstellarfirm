# OpenStellarFirm desk pet: firmware

> **Written for the OpenStellarFirm app, not yet run against it on a board.** The
> app's side (the server on your computer, pairing, voice, Settings, the USB page)
> is built, and since phase P5 of [docs/desk-pets-plan.md](../../docs/desk-pets-plan.md)
> the firmware talks to it: it keeps the computer's address and certificate pin, holds
> every connection to that pin, finds the computer again by its mDNS name, and says
> what the app tells it about your ElevenLabs key. Everything that needs no board is
> tested here (`pio test -e native`, and the three firmware images build). **What
> only a real Arduino Nano ESP32 can show is listed under
> [What a real board must still test](#what-a-real-board-must-still-test).** The
> simulator the plan mentions is not built.

The program that runs on the desk pet's Arduino Nano ESP32: **Nova**, **Zib** and
**Comet** on their launch pad. It starts listening when the owner holds the lime
light, goes on while they talk, sends what was said to the OpenStellarFirm app on the
owner's own computer when they stop,
plays the answer, glows and speaks when work is ready or waits for the owner's
Approve, and keeps notes while there is no Wi-Fi. (The name "desk pet" is
provisional; every line the pet speaks is in `src/shared/pets/lines.ts`, so a
new name is one place.) What the pet is, how it talks to OpenStellarFirm and the rules the code must
keep are in [docs/desk-pets-plan.md](../../docs/desk-pets-plan.md). The hardware, the
pin map and the bring-up checklist are in
[hardware/pets/README.md](../../hardware/pets/README.md).

This folder has no `package.json`, so `pnpm build` and `pnpm test` never need
PlatformIO. The only thing it takes from the rest of the repository is
`include/generated/protocol.h`, which `src/shared/pets/` writes (`pnpm pets:header`,
[scripts/pets-header.mjs](../../scripts/pets-header.mjs)), with the test vectors
`adpcm_vectors.h` and `usb_vectors.h`. A test fails when a committed header differs
from what the generator writes. Never edit those files by hand.

## Environments

| Environment        | What                                                                                                                                                        | Command                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `nano_esp32`       | The pet.                                                                                                                                                    | `pio run -e nano_esp32`                 |
| `bringup`          | The hardware test firmware of the bring-up checklist.                                                                                                       | `pio run -e bringup`                    |
| `devboard`         | The pet on a bare board, with the laptop as its microphone, speaker and button ([Development board](#development-board)). **Never a pet to pair for real.** | `pio run -e devboard`                   |
| `devboard_first`   | The same, first flash of a board.                                                                                                                           | `pio run -e devboard_first -t upload`   |
| `nano_esp32_first` | The pet, uploaded through the chip's own bootloader. For the first flash of each board ([Flashing](#first-flash-of-a-board)).                               | `pio run -e nano_esp32_first -t upload` |
| `bringup_first`    | The same for the bring-up firmware.                                                                                                                         | `pio run -e bringup_first -t upload`    |
| `native`           | Unit tests of the pure modules in `src/core/`, on the computer.                                                                                             | `pio test -e native`                    |

You need [PlatformIO](https://platformio.org/) 6.1.18 (CI uses that version). The
device environments use the pioarduino platform release 53.03.13, which is
Arduino-ESP32 core 3.1.3 on ESP-IDF 5.3, pinned in `platformio.ini`; the first
build downloads it and its toolchain (a few hundred MB). The code uses only APIs
of that core and of ESP-IDF 5.x.

### Flashing

**Render the boot pack first.** The pet's setup network is WPA2 and its password
is told only by the pet's voice, one `char-*` clip per character, from the boot
pack compiled into the firmware (`include/generated/boot_pack.h`, see
[Voice packs](#voice-packs)); over USB the confirm code is told the same way.
Without that file the image builds, but every character is the same short tone, so
nobody can learn the password, the phone cannot join, nobody can hear the confirm
code and **the unit can never be paired**. The `setup-join` line was reworded for USB
setup (23 October 2026), so a pack rendered before then needs rendering again. Make
the boot pack (made on your own ElevenLabs key, a later phase; see
[tools/voice-pack/README.md](tools/voice-pack/README.md)) before flashing a unit
that will be paired. The build prints a warning when the file is missing.

#### First flash of a board

The pet has its own flash map (`partitions_pet.csv`: a `littlefs` partition where
the Arduino Nano ESP32's table has `ffat`). The board's usual upload, DFU, writes
only the app. It never writes the bootloader or the partition table, so it cannot
lay that map down. **The first flash of each board therefore uses the `*_first`
environment**, which uploads with `esptool` through the chip's own bootloader and
writes the bootloader, the partition table and the app.

1. Plug the Nano's own USB-C (the DATA port on the pad) into the computer.
2. Put a jumper wire between B1 and GND, press RST, then take the wire out. The
   RGB LED stays purple or yellow: the chip is waiting in its own bootloader.
3. Upload:

   ```sh
   cd firmware/pet
   pio run -e nano_esp32_first -t upload     # or bringup_first on a new board
   ```

   The first try sometimes ends with "Input/output error", a known issue of this
   board. Run the command again.
4. Press RST to start it, then `pio device monitor` (115200 baud).

On a new board, flash the bring-up firmware first (`bringup_first`, see
[Bring-up](#bring-up)) and the pet after it. Do it before the pad is closed, as the
bring-up checklist does, while B1 is still easy to reach. Both environments share
the flash map, so once a board has had one `*_first` flash the other can go over DFU
(see the next section for what the pet image changes about that).

#### Later updates

With the same flash map, update over DFU, but start from the board's own bootloader:
**the pet image has no DFU interface of its own** (`platformio.ini` turns the board's
in-app DFU off for `nano_esp32`, so the running pet cannot be rewritten over the cable
by a program or a web page, see [Bring-up over USB](#bring-up-over-usb)). Double-press
the Nano's RST button to put it in its bootloader (the green LED pulses), then:

```sh
cd firmware/pet
pio run -e nano_esp32 -t upload
pio device monitor            # 115200 baud
```

If PlatformIO still cannot find the board, double-press RST again and run the upload
again. The bring-up firmware keeps the in-app DFU (it is a test image that never holds
a pairing), so it can be replaced without the double press. A change to
`partitions_pet.csv` needs a `*_first` flash again. The serial log prints only
while a terminal is attached, and it never prints a token, a Wi-Fi name or
password, a setup or confirm code, or anything the owner said.

#### Never erase the whole flash

Never run `esptool.py erase_flash`. It also wipes the factory slot (`0xF70000`),
which holds Arduino's recovery sketch that a double press of RST starts. If it
was wiped, put it back:

```sh
esptool.py --chip esp32s3 --port PORT --baud 921600 write_flash 0xF70000 nora_recovery.ino.bin
```

`PORT` is the board's serial port. `nora_recovery.ino.bin` ships with the
Arduino-ESP32 core, under `variants/arduino_nano_nora/extra/nora_recovery/` (with
PlatformIO, in `~/.platformio/packages/framework-arduinoespressif32/`). Put the
board in the chip's own bootloader first, as in the first flash, and press RST
afterwards.

### Bring-up

Before the pad is closed, run the checklist in
[hardware/pets/README.md](../../hardware/pets/README.md#bring-up-checklist) with
the `bringup` firmware. A new board is flashed first with `bringup_first`, through
the chip's own bootloader (the steps under
[First flash of a board](#first-flash-of-a-board): B1 to GND, press RST, take the
wire out):

```sh
pio run -e bringup_first -t upload
pio device monitor
```

Later runs of the bring-up firmware on the same board can use DFU
(`pio run -e bringup -t upload`) while the bring-up firmware is what runs; once the
pet firmware is on the board, double-press RST first (the pet image has no in-app
DFU).

It prints, every second, the battery voltage, the charger and USB state, the skin
ID in millivolts and the figure it means, the MIC switch and the button. At start
it lights each LED in turn (lime, sky, nebula, rose) and plays a 1 kHz tone for one
second. Hold the lime light: the log says so, LED 0 turns lime, and the microphone
records for as long as you hold it (3 seconds at most), then plays it back (it
prints the peak level, so a dead microphone is plain to see). That is the bring-up
firmware only: the pet itself goes on listening after you let go (see Listening
below). Rule 4 holds in the bring-up firmware too: the microphone never starts by
itself, at power-up or from the serial port, and not with the MIC switch off. Slide MIC off: the log says so
and LED 0 turns a dim rose. Over the serial port, `t` plays the tone and `l` runs
the lights again (`r` only reminds you to hold the lime light). It uses the same
drivers as the pet, so a bring-up that works means the pet's drivers work.

### Bring-up over USB

Run this after the bring-up checklist, with the **pet** firmware (`nano_esp32`) on the
board, the boot pack rendered (the confirm code is only spoken) and the OpenStellarFirm app
on the computer the pet is plugged into, with Desk pets turned on in Settings (the
app's own window uses Web Serial). Nothing about the USB path has run on a unit yet, so
write down what you see.

1. **Enumeration.** The pad's DATA port shows up as USB `2341:0070`; the CHARGE port, or
   a charge-only cable, shows nothing
   ([the hardware checklist](../../hardware/pets/README.md#bring-up-checklist)).
2. **Hello.** In Settings, Desk pets press Add a desk pet, then Set up over USB and
   Connect to my pet. The app's chooser lists the pet (and nothing else); the page says
   which figure answered and that it is not set up yet. The pet's `hello` says version 2
   (`@pet1 hello 2 ...`): a page that is told version 1 would send the pet nothing. The pet is not frozen: its lights and
   its button keep working while the port is open.
3. **A page that does not read.** Open the port in a serial monitor and pause it, or open
   it from any program that never reads, for a minute. The pet must keep working (lights,
   a tap, its Wi-Fi), because nothing it writes waits for the computer.
4. **Scan.** The page lists the 2.4 GHz networks the pet can see, strongest first, and
   takes a hidden name typed in.
5. **A wrong Wi-Fi password.** Start with a wrong one. The page says the pet could not join
   (`wifi_failed`) and you can try again without unplugging. The pet forgot the address
   and fingerprint it was given for that try (a pet that failed keeps no computer).
6. **The right password.** The page shows Joining, then Asking OpenStellarFirm to pair, then
   Listen to your pet. The pet says its confirm code (a tap of the lime light says it
   again); type it in the card and approve. The pet claims its token, says it is set up,
   and the page closes the port. Unplug and plug the pet back in: it still knows the
   computer (see [What a real board must still test](#what-a-real-board-must-still-test)).
7. **A paired pet refuses.** Plug the paired pet in and connect again: the page says it
   is already set up and does nothing else. In a serial monitor type `@pet1 scan` (and
   the same for `server`, `wifi`, `start`, `join`; the values do not matter, they are not
   read) and `@pet1 cancel`: each answers `@pet1 refused paired`, and `@pet1 hello` answers
   `@pet1 hello 2 ... paired ...`. On an unpaired pet `@pet1 start K7QXM2PA9T` before the
   page has sent `server` and `wifi` answers `@pet1 refused not_ready`.
8. **The cable is pulled.** Pull it in the middle of a try: the page says to plug it back
   in and releases the port.
9. **No download mode from the cable.** Open the port at 1200 baud (for example
   `stty -F /dev/ttyACM0 1200` on Linux), or run `esptool.py --chip esp32s3 --port PORT
   chip_id`, which only reads and does the DTR and RTS dance: the pet must not restart
   into the ROM's download mode, and esptool must fail to connect. Then check that the
   board's own way still works: a double press of RST and `pio run -e nano_esp32 -t
   upload`, and the B1 to GND jumper for a first flash. Also with the pet running:
   `dfu-util -l` must list no DFU device for `2341:0070` (the pet has no in-app DFU
   interface), and `dfu-util -d 2341:0070 -D any.bin` must find nothing to write to. The
   serial port must still enumerate as `2341:0070` (`lsusb`).
10. **Nothing leaks onto the port.** With a serial monitor on the USB port while you
    set up, only `[pet] ...` lines and `@pet1 ...` lines appear: no ESP-IDF line (`E (`
    and a number) and no panic dump, and no Wi-Fi name, password or code in any line.
11. **Stop and start again.** Run a try over the cable up to Listen to your pet and press
    Stop on the page: the try ends and the pet says nothing more. Connect again: the card
    makes a new setup code by itself and the second try pairs without a refusal, with
    nothing left over from the first (the page sends `server`, `wifi` and `start` again).
12. **The phone's page pairs nothing.** Join the pet's own setup network from a phone
    (the pet spells its password after a power-on, when it is not set up) and open
    `http://192.168.4.1/`: the page says the pet cannot be set up from a phone and has no
    form. A `POST /join` from a script answers 403 and the pet shows no state change on the
    cable.

### Development board

`devboard` runs the pet's own firmware (`main.cpp`, the state machine, Wi-Fi,
pairing, turns, saved notes, the inbox) on a bare Arduino Nano ESP32 with nothing
wired to it. The laptop stands in for the rest, over the USB cable
(`src/devboard/bridge.h` has the wire):

- the microphone: the board sends `mic on` when the owner holds the light and LED 0 is
  lime, the page records the laptop's microphone at 16 kHz and sends it until
  `mic off`. The I2S receiver still runs, with nothing on its pins, only to keep the
  time;
- the speaker: a copy of what the pet plays, at half the rate, played by the page;
- the talk button and the MIC switch: the page's light and checkbox (a wire from D10
  to GND works too);
- LED 0: drawn on the page and on the board's own RGB LED;
- the clips: the board names each clip it plays and the page says its words, since a
  board with no boot pack plays every character as the same tone;
- the battery and the figure: fixed (full, on USB power; Nova unless
  `-DPET_DEVBOARD_KIND=PET_KIND_ALIEN` or `PET_KIND_CAT`).

It breaks two rules of the pet on purpose: audio crosses the cable, and so do the
clip ids, which during setup spell the setup passphrase and the confirm code. So it
pairs as the hardware `nano-esp32-devboard`, and **it must never be flashed onto a
pet that will be paired for real**. It is set up and pinned like a pet (the laptop that
holds the cable is also the one that runs the app), so it needs the same app and the same
`server`, `wifi` and `start` lines as a pet.

1. First flash, with the B1 to GND jumper as above:
   `pio run -e devboard_first -t upload`. Later uploads: double-press RST, then
   `pio run -e devboard -t upload` (the image keeps the board's DFU, like bring-up,
   but the port never reboots on request).
2. Open the laptop page for the board (the simulator's Board mode, which is not in
   this repository yet; see the plan) in Chrome or Edge and connect the board.
3. In the app's Add a desk pet, choose the Wi-Fi, its password and a setup code and start.
   Listen for the confirm code (the laptop page spells it, since a bare board has no
   boot pack) and type it in OpenStellarFirm.
4. Hold the light, talk, let go; the answer plays on the laptop.

Uploads after the first go through the board's in-app DFU (`pio run -e devboard -t
upload`), with no button. A board that only ever had DFU uploads keeps its own flash
map, which has no `littlefs` partition: everything works except what needs flash
(saved notes, voice packs), and a recording that ends offline says the memory is
full. Flash `devboard_first` once, with the jumper, to fix it.

The page's log takes the development commands listed in `src/devboard/bridge.h`
(`stats`, `where`, `offline-pet`, `forget`, `restart`); `offline-pet` makes the
board a paired pet with no network (and a made-up computer on record, a reserved address
and a pin nothing matches), so a recording can be tried with no server.

**Checked on a bare Nano ESP32 (11 November 2026),** over the bridge: boot, the setup
light and the setup line with the passphrase spelled, a Wi-Fi scan, the talk button,
the speaker copy (an 880 Hz stand-in tone decoded at 883 Hz on the laptop), and on an
offline pet the hold that opens the microphone, the laptop's audio taken in real time,
speech found and the recording ended after 5 seconds of silence. Two bugs of the pet
itself were found there and fixed:

- **No I2S at all.** On this core a small `MALLOC_CAP_DEFAULT` allocation lands in
  PSRAM, and the I2S driver's DMA interrupt (built IRAM safe) refuses a context
  there, so every speaker and microphone start failed with `ESP_ERR_INVALID_ARG`.
  The channels are now made once, in `setup()`, inside `withPsramHeld`
  (`src/hw/internal_alloc.h`); the microphone's channel is enabled only between
  `start()` and `stop()`.
- **The microphone never stopped.** `Mic::stop()` waited for the lock that the audio
  task took straight back after each read, so the main loop froze with the
  microphone on outside Listening. `stop()` now drops the flag first.

Not checked yet: pairing and a turn against a server, and the page itself in Chrome
(the same lines were driven by a script).

### Which computer a pet talks to

There is no server address in the build and no flag to set one: `PET_API_BASE` is gone. The
pet talks to the one computer it was set up with, and only that computer.

1. **The cable tells it.** In Settings, Desk pets, Add a desk pet, the app sends the pet
   `server <address or -> <port> <fingerprint> <name>` over the USB cable: this computer's
   private address (or `-` when it has none to give), the port of the app's server, the
   SHA-256 of the app's certificate (64 lowercase hex digits, the pin) and the computer's
   mDNS name (`osf-<8 hex>.local`). With `wifi` and `start` it is the whole setup. The pet
   holds these in RAM until `start` makes a try of them; a cancel, a pulled cable or the
   end of the power forgets them.
2. **A pairing try pins it.** The pet joins the Wi-Fi, connects to `https://<address>:<port>`
   and holds the connection to the pin (below), asks to pair, speaks its confirm code and
   claims its token. Only after the claim does the pet keep the computer (address, port,
   fingerprint, name) in its NVS (`srvaddr`, `srvport`, `srvpin`, `srvname`), written
   before the token so a pet is never left with a token and no pin. A try that fails
   leaves the pet with no computer.
3. **A paired pet with no computer is forgotten at boot.** A token with no pin could not
   connect to anything and never will.
4. **Every connection is held to the pin.** The pet trusts no certificate authority for the
   app. See [The pin](#the-pin).
5. **When the address stops working** (the router gave the computer another one, or another
   device took the old one) the pet asks mDNS for the computer's name, with the ESP-IDF
   resolver (`mdns_query_a`, started for the question and stopped after it: the pet
   advertises nothing). The address that answers is tried with the same pin, and the one
   that works is kept in NVS. An answer from another device is only a connection the pin
   refuses. The first try of a call to a stale address waits at most 8 seconds
   (`kConnectTimeoutMs`) before the name is asked. With `-` as the address the pet goes
   straight to the name. IPv6 addresses work but link-local ones (`fe80::`, which need a
   zone) are never given by the app.
6. **There is no time server.** The pet reaches no host but the computer: the setup
   used to ask `pool.ntp.org` for the time, which TLS did not need once the pin replaced
   the certificate authorities (a pinned certificate is accepted whatever its dates, so a
   pet with the clock at 1970 connects), and which only the time of a saved note used.
   The pet now takes its clock from the `Date` header of the app's answers
   (`parseHttpDate`, `shouldSetClock` in `core/api_rules.h`): any answer over the pinned
   connection sets it when it was never set or is more than 5 seconds off. A pet that
   has not heard from the app yet leaves `X-Pet-Recorded-At` out, as before.

## The pin

`net/api.cpp` sets each call's `crt_bundle_attach` to `attachPin`, and `skip_cert_common_name_check`
on, so the certificate's names are not what is trusted (the app's certificate is
self-signed, for an address that changes). During the TLS handshake mbedtls hands every
certificate of the chain the computer showed to `verifyPin`, the top one first and the
computer's own (depth 0) last, with the connection in `MBEDTLS_SSL_VERIFY_REQUIRED`:

- at depth 0, `pinAction` (`core/server_pin.h`) compares the SHA-256 of the certificate's
  DER bytes with the stored fingerprint in constant time (`pinEqual`). A match clears the
  flags mbedtls raised (an unknown authority, a date that does not fit the pet's clock, a
  name that does not match) and the handshake goes on. Anything else, and every
  certificate when the pet holds no pin, sets the flag and returns
  `MBEDTLS_ERR_X509_CERT_VERIFY_FAILED`: the handshake ends with a fatal alert;
- at depth 1 and up it has no opinion, and clears the flags so the one decision is the
  computer's own certificate.

`esp_http_client` writes the request, with its `Authorization: Bearer` header, only after the
handshake has finished, so **the device token is never written to a computer that failed the
pin**, on any call: pair, claim, heartbeat, turn, say, inbox and the voice pack download
(which carries no token but is pinned the same way). The ESP-IDF certificate bundle's own
attach function is called first only because `MBEDTLS_SSL_VERIFY_REQUIRED` needs a CA chain to
be set at all (mbedtls answers "No CA Chain is set" otherwise); its callback, the one that
looks a certificate up among the public authorities, is replaced by `verifyPin`, so the
bundle never decides anything for the app. The pin is one global (a spinlock guards its 32
bytes, since the network task and the inbox task can connect together) set by
`Api::begin` (the stored record), `Api::useServer` (a pairing try) and cleared by
`Api::dropServer`.

Where it could leak if it were done wrong, and what keeps it from doing that:

| Mistake                                                                                                      | What prevents it here                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checking the certificate after `esp_http_client_open` (it has already sent the headers, the token with them) | The check is the handshake's own verify callback, not code that runs after it.                                                                                                                                                          |
| `MBEDTLS_SSL_VERIFY_OPTIONAL` or `NONE`: the handshake goes on whatever the callback says                    | `attachPin` sets `REQUIRED` itself after the bundle's attach. A host check (below) showed that a callback error is fatal in `OPTIONAL` too, but an `OPTIONAL` flag left set would not be.                                               |
| A callback that accepts when it has no pin                                                                   | `pinAction` rejects at depth 0 with no pin; `Api::perform` also makes no call with no record.                                                                                                                                           |
| Trusting a later certificate in the chain and ignoring the first                                             | Only depth 0 decides; the test walks chains with the pinned certificate as an issuer of a forged leaf.                                                                                                                                  |
| Comparing in time that shows where two digests first differ                                                  | `pinEqual` ORs all 32 bytes.                                                                                                                                                                                                            |
| Retrying with the token on another address after a connection that did connect                               | `Api::perform` tries the name only when the first attempt did not connect; a connection that was made is the computer's answer or none.                                                                                                 |
| A redirect that carries the token elsewhere                                                                  | `disable_auto_redirect`, and any 3xx is an error that is never read.                                                                                                                                                                    |
| A plain `http` call                                                                                          | The address is built by `serverBaseUrl` (always `https://`, always an IPv4 or IPv6 literal and a port), is checked with `isHttpsBase`, and the transport is `HTTP_TRANSPORT_OVER_SSL`. `test_server_pin` reads the source for the rest. |

A host test (not in this repository: it needs the computer's OpenSSL and mbedtls 2.28) ran
a real in-memory TLS handshake between an mbedtls server with a self-signed P-256
certificate and a client set up the way `attachPin` sets it, with `verifyPin`'s logic:
the pinned certificate was accepted (also expired, also not yet valid, with and without a
hostname), another device's certificate, a pin naming another certificate and no pin were
refused, and a client with `REQUIRED` and no CA chain at all was refused with "No CA Chain
is set". The device uses mbedtls 3.6.2, whose verify callback behaves the same; **the
check inside the real firmware has not run on a board.**

## How it is put together

The state machine and every decision are in **`src/core/`**: plain C++17 with no
Arduino include, unit tested with Unity (`test/`). `pet_app.h` is the state
machine. The hardware modules are small and call into it:

```
src/core/      PURE   pet_app, note_queue, adpcm, wav, light_frames, gestures,
                      vad, recording_plan, recording_writer,
                      api_rules, backoff, heartbeat, voice_pack, text_rules,
                      usb_setup_rules, server_pin, line_queue,
                      notice_clips, audio_dsp, battery, skin_id, base64url, uuid_format
src/audio/     mic.*      I2S microphone, 16 kHz, ADPCM as it records, one or two PSRAM
                          slots of about 0.97 MB, the voice detector listening to it
               speaker.*  I2S amplifier, 22.05 kHz, jitter buffer, volume, amp enable
src/net/       api.*          HTTPS client (esp_http_client), the pin check, the mDNS fallback,
                              the computer's clock; JSON with ArduinoJson 7
               wifi_setup.*   joining Wi-Fi; the pet's own network and its page (which pairs nothing)
               setup_page.h   the page (one string, no external assets)
               usb_setup.*    setup over the USB cable (pet-usb v2), served by the network task
               net_worker.*   the network task and the inbox task
src/store/     secrets.*        NVS: Wi-Fi, device secret and token, the computer's record, settings, counters
               note_store_fs.*  saved notes on LittleFS
               voicepack.*      the voice pack on flash and the boot pack, the clip player
src/ui/        lights.*   the WS2812B chain, 50 Hz
               button.*   the talk button
src/hw/        power.*    battery, charger, USB power, the MIC switch, deep sleep
               skin.*     which figure stands on the pad
               log.*      PET_LOG and the one queue everything written to the USB serial port goes through
src/main.cpp   wires it all together (env nano_esp32)
src/bringup/   the bring-up firmware (env bringup)
```

### Tasks and events

| Task                 | Core | Does                                                                                                                                                                                                                                                |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main loop (`loop()`) | 1    | The only owner of `PetApp`. Reads the button, the power pins and the MIC switch; takes messages from the other tasks; every 100 ms sends what the voice detector heard (while the microphone runs) and a tick; applies the state machine's actions. |
| audio                | 1    | Records (`Mic::pump`: read, filter, feed the voice detector, encode into the slot) or plays (`ClipPlayer::pump`, `Speaker::pump`). Never both.                                                                                                      |
| lights               | 1    | Draws `light_frames` at 50 Hz.                                                                                                                                                                                                                      |
| network              | 0    | Wi-Fi supervision, setup (the setup page and the USB cable) and pairing, turn uploads, the sync of saved notes, notices read aloud, the heartbeat, the voice pack download. One command at a time.                                                  |
| inbox                | 0    | The 20 second long poll for notices, a task of its own so a turn never waits behind it.                                                                                                                                                             |

Everything the other tasks learn comes back as a `Msg` on one queue: an `Event`
for the state machine, `SlotDone` (a task is finished with a recording), or
`PlayDone` (a stream finished playing, so the state machine hears `ReplyEnded` or
`NoticeShown`). Button gestures, a 100 ms tick (with the `Voice` event that carries
what the voice detector heard), the battery and MIC switch readings become events in
the main loop. `PetApp::handle()` returns `Actions`;
`applyActions()` in `main.cpp` carries them out in a fixed order (forget, stop
playback, stop and start recording, send or save, setup, sync, ask the inbox,
heartbeat, speak).

A recording lives in one of two PSRAM slots, each the whole upload for the longest
recording: the 60-byte WAV header and at most 1888 blocks of IMA-ADPCM, 966,716
bytes, which fits the upload cap (`PET_UPLOAD_MAX_BYTES`, 1 MiB) with about 80 KB to
spare (`core/recording_plan.h`, checked by a `static_assert`). Two minutes of PCM16
would be 3.84 MB, four times as much, and two slots of it would take nearly all of the
8 MB of PSRAM, so the microphone encodes ADPCM as the samples arrive, block by block,
straight into the slot (`core/recording_writer.h`), and the slot is uploaded or saved
as it stands. Two slots (about 1.9 MB) are made when the PSRAM has room for both and
1 MiB besides for everything else, which the 8 MB part has many times over; with less
it makes one, and a new
recording then waits for the last to be sent or saved (the pet says "didn't catch" if
the owner starts too soon). A slot is reused only when the main loop's count of users is
zero: it adds one for each upload or save it hands to the network task and takes one
away on `SlotDone`. A slot with no buffer (a unit with no PSRAM, or one that got only
one of the two) is never picked. A failed upload is saved as a note from the same slot
with the same turn id. A recording is stored up to exactly 120 seconds, so the server
never answers "too long" for a capped one. A unit with no PSRAM at all has one
internal buffer that holds about twelve seconds; when it is full the microphone tells
the state machine (`Voice` with `bufferFull`) and the recording ends and is sent.

Two things keep the tasks from stepping on each other when the owner talks over the
pet:

- **The pack file.** The audio task reads the voice pack only through
  `VoicePackStore::readClip`, under the lock the network task takes to close and
  replace the file (a new voice, a forgotten pet), so a file is never read while it
  is being closed.
- **Late answers.** Stopping the pet calls `Speaker::abort()`, which also counts up
  the speaker's epoch. The main loop copies `Speaker::epoch()` into the `SendTurn`
  and `FetchSay` commands; the network task opens the answer's stream (and plays its
  stand-in line) with it, and the speaker refuses a stream of an older epoch. An
  answer that was still on its way when the owner stopped the pet is dropped unheard.
  For the same reason the state machine takes `ReplyEnded` only while it is speaking
  a reply.

### Where the rules of docs/desk-pets-plan.md are kept

| Rule                                                                                                                                                                                                                                                       | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The pet holds only its device token.                                                                                                                                                                                                                    | `store/secrets.cpp` keeps the token and, only from a pair request until its claim ends, the pet's own secret: `setPaired()` removes the secret when the claim works, every failing way out of `claimToken` removes it, and `setup()` clears any that a restart left. `net/api.cpp` sends the token only as `Authorization: Bearer`, only to the one computer whose certificate it was pinned to, after the handshake. The computer's record (address, port, name and pin) is not a secret and is kept beside it.                                                                                                              |
| 2. Pairing needs the setup code, the typed confirm code and a one-time claim.                                                                                                                                                                              | `net/net_worker.cpp` (`pairWith`, `claimToken`): the token is stored only after the claim answers 200; the device secret is new for each try. A `start` over USB runs `pairWith`; the cable carries the setup code in, never the confirm code out. `pairWith` refuses a submission with no computer to pin.                                                                                                                                                                                                                                                                                                                   |
| 3. The pet never approves; spoken lines carry no step text or digits.                                                                                                                                                                                      | `core/pet_app.h` has no approve event or action. Lines are clips from the pack; the only characters spoken are the ones the pet spells during setup, the setup network's password and the confirm code, one `char-*` clip per character (`core/voice_pack.h`, `core/setup_access.h`).                                                                                                                                                                                                                                                                                                                                         |
| 4. The mic records only after the owner holds the lime light, never by itself; it stops on 5 seconds of silence, at 2 minutes or when they press the light again; LED 0 is solid lime whenever it records; the MIC switch cuts its power.                  | `core/pet_app.cpp` (only a `ButtonDown`, the hold, starts a recording; the release does nothing; the limits end it; tested for every state and event, and by a model of the limits), `core/vad.cpp` (the silence), `audio/mic.cpp` (receiver on only between `start()` and `stop()`, lime light first, MIC switch checked), `ui/lights.cpp` (the Listening frame follows the microphone itself), and a watchdog in `main.cpp`.                                                                                                                                                                                                |
| 5. Every turn is the owner's own message.                                                                                                                                                                                                                  | Server side. The pet sends the recording and nothing else about it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6. No audio is kept on OpenStellarFirm; saved notes are deleted from the pet only after a 200 or 208.                                                                                                                                                      | `core/api_rules.cpp` (`isTurnReceived`, `syncOutcomeFor`, tested for every status), `core/note_queue.cpp` (`confirm` is the only delete; `markRefused` only writes a mark).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7. HTTPS only, no redirect with the token; the setup network is WPA2 with a spoken password; the USB cable never carries the confirm code, the token, the device secret or an id, a paired pet answers only hello, and the chip's download mode stays off. | `net/api.cpp`: every URL is `serverBaseUrl` (an https address and a port, checked with `isHttpsBase`), every connection is held to the pin inside the handshake (`attachPin`, [The pin](#the-pin)), redirects off in the client, any 3xx is an error and is never read. `WifiSetup::handleJoin` refuses a phone's setup, which carries no pin. `core/usb_setup_rules.*` (a paired pet answers only `hello` before any value is read; reply builders that take only fixed words; tested against `usb_vectors.h`) and `net/usb_setup.*`; `Serial.enableReboot(false)` in `main.cpp`; `hw/log.*` is the only writer to the port. |

### Listening

The gestures (rule 4, the listening rule):

| Gesture                               | What the pet does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hold the lime light (more than 0.4 s) | Starts listening: LED 0 turns solid lime and the microphone starts. Letting go does not stop it.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Tap while listening (or hold again)   | Stops and sends at once, as a live turn, or as a note when offline.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Tap while not listening               | Plays the waiting notice; with nothing waiting a tap does nothing. The intended behaviour is "the waiting notice or repeats the last answer": **repeating the last answer is not built yet** (see "Not built yet"). A tap also stops a reply or a notice that is playing.                                                                                                                                                                                                                          |
| Double tap                            | "What's happening": at rest, plays the notice that waits (even in quiet hours or with "say notices aloud" off, since the owner asked), else asks the inbox at once and gives one short lime blink of the antenna or dome, with no sound; a notice that comes back within 10 seconds plays the same way. Offline it cannot ask and only blinks. A busy pet (listening, sending, speaking, playing a notice, syncing) ignores it. It no longer dismisses the attention lights (see "Not built yet"). |
| Hold for 10 seconds at power-on       | Forgets the Wi-Fi and the pairing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Listening ends on whichever comes first, decided by `PetApp` from what the main loop
tells it:

| What                                                                         | Limit                                                                               | Result                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Silence after the owner talked                                               | 5 seconds (`PET_SILENCE_END_SECONDS`), measured by the voice detector in audio time | sent                                                                        |
| The owner presses the light again                                            | a tap, or a second hold                                                             | sent at once                                                                |
| The longest recording                                                        | 120 seconds (`PET_RECORD_MAX_SECONDS`, `kRecordCapMs`)                              | sent                                                                        |
| The slot is full                                                             | when `Voice.bufferFull` says so (only a unit with little memory)                    | sent                                                                        |
| Nothing louder than the room in the first 5 seconds                          | `kNoSpeechMs`                                                                       | thrown away, the pet says "didn't catch"; nothing is sent, saved or charged |
| The MIC switch goes off, a fault, a forgetting, a reset, the battery cut-off | at once                                                                             | thrown away                                                                 |

The microphone never starts by itself: only `ButtonDown` (the hold) begins a recording,
and a test walks every event in every state to prove it. LED 0 is solid lime whenever
it records, with no setting, and a watchdog in `loop()` stops the microphone if the
state machine is ever not listening while it runs.

**The voice detector** (`core/vad.h`) takes the filtered samples in any chunking, judges
20 ms frames by their RMS and keeps a noise floor that it follows only while silent
(down quickly, up slowly). A frame is loud above `max(noise * 3, 30)`; a loud frame and
the six after it (the hangover) are speech; three loud frames in a row start the speech,
so a knock on the desk does not. It reports `speechStarted` (latched) and `silenceMs`
(since the last speech frame). Its thresholds are constants that need tuning on
hardware. It runs on the audio task beside the encoder; the first 100 ms of a recording
(the microphone's start-up pop) are thrown away before either sees them.

A recording that is only dead air (its loudest sample under 64) or shorter than 0.3 s is
not sent or kept: the pet says "didn't catch" (this also catches a tap before anything
was said).

### Saved notes

Offline, a finished recording is kept as `/notes/NNNNNNNN.wav` (the IMA-ADPCM WAV
exactly as it is uploaded) and `/notes/NNNNNNNN.json` (`{"turn":...,"recordedAt":...}`),
at most 50, never leaving less than 64 KB free. A note is as long as the recording,
which can be two minutes, 966,716 bytes: the flash (about 9.4 MB, shared with the
voice pack, whose download is capped at 3 MiB) holds six or more of those, nine without
a pack, or many short ones. When a note and the
reserve do not fit the pet says "My memory is full" (`AddResult::NoSpace`), as it
does at 50 notes; the reserve is unchanged. A note waits to be written until the
microphone has stopped, because a flash erase stalls the chip, and it may wait up to
the length of a recording. The record is written last, so a
power cut leaves a `.wav` with no record, which is deleted at the next start. When
Wi-Fi returns the notes go oldest first, each as a turn with its own id and
`X-Pet-Offline: 1`. A recording whose loudest sample stays under `kMinRecordingPeak`
(64, dead air), or that is shorter than 0.3 s, is neither kept nor sent: the pet says
"Sorry, I didn't catch that" instead, online or offline.

A note is deleted after **a 200 or a 208 and after nothing else** (rule 6). A 200
for a note is JSON, `{"status":"sent"}`, `{"status":"draft"}` or `{"status":"empty"}`
(nothing was heard in it; OpenStellarFirm took the turn id for good), and the pet does not
read the body: any 200 is a confirmation. A 208 says OpenStellarFirm has that turn id
already, which is what a note answers when it was a live turn the pet gave up on while
the server went on. Every other answer leaves the note where it is:

| Answer                                                            | What the sync does                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200, 208                                                          | Deletes the note and sends the next.                                                                                                                                                                                                                                                                                                                                                                                 |
| 400, 413, 415, 422                                                | The note's own content is refused (a damaged file, too long, not a recording, nothing heard on an older server). It stays, marked refused in its record (`"refused":422`), so it is not sent, and transcribed, again on every start. It does not hold up the notes behind it and does not count as waiting (not in the heartbeat's queue size, not for the sync). It still holds one of the 50 places and its flash. |
| 401 `forgotten`                                                   | The pet is no longer known: it clears its token and goes back to setup (the notes of that pairing are wiped, never sent to the next one).                                                                                                                                                                                                                                                                            |
| 401 `no_access`, 402, 404 `off`, 409 `paused`, 429, any other 4xx | Not about the note: the pass stops and tries again later. 429 is also what a repeat of a turn id says while its first try is still starting (208 comes once the run started), so a note the pet gave up on live is retried, never deleted early.                                                                                                                                                                     |
| 5xx, 408                                                          | Unreachable: the pass stops, OpenStellarFirm counts as unreachable until a heartbeat probe is answered, and the notes stay.                                                                                                                                                                                                                                                                                          |
| No answer, a timeout, a dropped connection                        | The pass stops and the pet goes offline; the heartbeat probe finds the way back and the pass starts again.                                                                                                                                                                                                                                                                                                           |

A stop for any reason but "no answer" waits before the next pass, each miss twice as
long as the last (1, 2, 4, 8, 16 minutes, then 30), since a refused attempt has
uploaded a whole note first, so a note OpenStellarFirm cannot take is never sent over and
over. A pet that is paused in Settings does not upload at all until a heartbeat says
it is not.
Forgetting the pet is the one other way a note goes, on purpose; so is a start with no
pairing, which wipes the notes of a pairing that was forgotten (a reset that could
not finish) before they could reach another account.

### What the pet does with each answer to a turn

`core/api_rules.cpp` (`turnVerdictFor`, `lineFromAnswer`, `clipForSilentReply`) decides,
and `net/net_worker.cpp` (`doTurn`) carries it out. The tests walk every status and
error the server's turn route can send.

| Answer                                                        | What the pet does                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200, audio                                                    | Plays it as it arrives (raw PCM16 little-endian, 22.05 kHz). `X-Pet-State` lights the pet: `working` the team light, `needs-approve` the nebula light, `refused` a rose flash. `X-Pet-Chat` and `X-Pet-Run` say which work it is about.         |
| 200, empty body                                               | The run started and the speech failed after that. The pet plays the clip of its own pack for the state: `working` -> "working", `needs-approve` -> "needs-approve", `refused` -> "refused", `answered` -> "message" (the words are in the app). |
| 208                                                           | OpenStellarFirm has this turn already. Nothing to play.                                                                                                                                                                                         |
| 401 `forgotten`                                               | Clears the token, says "disconnected", goes back to setup. Only this answer does.                                                                                                                                                               |
| 401 `no_access`, 402, 409, 413, 415, 422, 429, 400, 404 `off` | Plays the `line` of the error body (a clip the server's error table can send; the firmware's own table is the fallback), flashes rose, stays paired. The recording is not kept.                                                                 |
| 5xx, 408, no answer, a timeout, a dropped connection          | Unreachable: the recording is kept as a saved note under the same turn id and the pet says "I'm offline, so I saved that"; a heartbeat probe finds out when OpenStellarFirm is back.                                                            |

### Notices

- **Quiet hours are the server's word.** The pet has no clock or time zone: the `quiet`
  of every inbox answer and every heartbeat answer says whether it is quiet now. A
  notice in quiet hours, or with "say notices aloud" off, lights the pet and waits for
  a tap.
- **No double announcement.** A turn answered `needs-approve` has already said that a
  step waits; one answered `answered` has said the work is done. For two minutes after
  it, an `approval` notice for the same work (the run when both have one, else the
  chat: the server's approval notice names the chat) and a `done` notice for the same
  run only move the light. Nothing is said and nothing waits for a tap. A notice that
  reached the state machine while the pet was sending is dropped when the answer says
  the same (`PetApp::repeatsTurn`).
- **Messages are read aloud.** A `message` notice, the greeting OpenStellarFirm pushes at
  pairing ("Hi, I'm Nova. ...") included, is fetched spoken through `GET /say/<seq>`;
  when that cannot be done (no network, a failure) the pet plays the pack's clip:
  `hello` for the greeting, `message` for any other. A `done` notice with a work title
  is fetched the same way and falls back to `done`.
- **A notice that cannot be read aloud** says "I'm paused" for a 409, "OpenStellarFirm
  is busy" for a 429, "my voice key was refused" for a 401 `no_access` and that the voice
  quota is used up for a 402 `out_of_credits`, and nothing is asked for again; any other
  failure plays the clip that stands in for the notice. The two 401 answers are told apart
  by the error name in the body alone (`isForgotten` is only `forgotten`; a refused key
  never makes the pet forget its pairing).
- **A `settings` notice** is silent. It asks for a heartbeat, which reads the new
  settings, and when the voice changed the pet downloads the pack of the new voice at
  its next idle moment (a failed try for the old voice does not delay it).
- **The inbox cursor** is what the server's `next` says, taken whenever it differs
  from the pet's `after`, so a counter that started over (a `next` below `after`) is
  followed. It is written to flash only when it changes, and put back to 0 when the
  pet is paired again; an answer that comes back across a forgetting or a new pairing
  is thrown away.

### The setup network

**It no longer sets a pet up.** Pairing needs the computer's certificate fingerprint, and a
phone cannot carry that safely (docs/desk-pets-plan.md: "the setup network is left out of the
first version"), so a pet is paired only over the USB cable. What is left of the network is
gated, not removed: it still opens on the first start (a power-on with no pairing, and the 10
second reset hold) and for ten minutes at most after a tap or a hold of the light, with
nobody finishing (`SetupWindow`, `kSetupWindowMs`), as a WPA2 Wi-Fi network called
`OpenStellarFirm <Name> <last four hex digits of the MAC>`, with a captive portal, and the
pet still says its password (12 characters of the code alphabet in lower case,
`core/setup_access.h`, made once from the hardware random numbers while the radio is on and
kept in NVS as `setuppass`; `WifiSetup::start` never starts an open network).

What a phone gets there is the page in `net/setup_page.h` (one string, no external
assets), which says the pet cannot be set up from a phone and to use the cable, with its
form hidden. `WifiSetup::handleJoin` answers 403 and **reads, keeps and acts on nothing the
form sends**: no submission, no state change, nothing mirrored to the cable. Even if a
submission got through, `NetWorker::pairWith` refuses one with no computer to pin
(`SetupSubmission::hasServer`), so a pet can never pair without a pin. The host checks the
setup page already had stay: the network's DNS answers every name with the pet's address
for a phone's captive portal check, and the handlers answer only a request made to the
pet's own address (`setupHostIsAccessPoint`, `WifiSetup::atMyAddress`), with the header the
page adds and no foreign `Origin` (`WifiSetup::fromThePage`, `setupRequestAllowed`), so a
page on another site cannot read or drive it. A USB try switches the network off for its
length and the pet brings it back if the try fails. A `Forgotten` answer wipes the pet and
makes it say it was disconnected, but does not open the network; a tap or a hold does.

**Still to do** (a founder decision, since the lines are in `src/shared/pets/lines.ts`): the
greeting `setup-join` still says "...or join my Wi-Fi network on your phone", and the
pet still spells the network's password after it. Neither is true to what the network
now does. The page tells the person where to go, so nothing is lost, but the words and the
spelled password should go with the first rendering of the boot pack.

### Setup over USB

The only way to set a pet up is the app's page over the pet's data USB cable (Web Serial,
in the app's own window: Settings, Desk pets, Add a desk pet). The app sends the pet the
computer's address, port, certificate fingerprint and name (`server`), the Wi-Fi name and
password (`wifi`) and the setup code (`start`); the pet joins the Wi-Fi, connects to the
computer and pins its certificate, asks it to pair (`pairWith`), says its confirm code and
makes its one-time claim once the owner has typed the code in OpenStellarFirm. Rules 1 to
6 do not change.

The wire is **pet-usb v2** (the pet's `hello` says `2`; a page that finds version 1 sends
nothing else, and the app tells the owner the pet needs an update). v1's framing, hex,
limits and rate limit are unchanged, and the v1 `join` line is still read. Its words,
limits and golden lines come from `src/shared/pets/usb.ts` through
`include/generated/protocol.h`, `usb_vectors.h` and `usb2_vectors.h`; the pure parser is
`core/usb_setup_rules.*` (no Arduino header) and `net/usb_setup.*` moves bytes between it
and the port in the network task.

| What               | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A line             | `@pet1 `, space-separated tokens, a newline; at most 512 bytes before the newline (`PET_USB_MAX_LINE`), printable ASCII. A longer line is thrown away up to the newline and answered `refused bad_line`. A line without the prefix gets no reply and costs nothing against the rate limit (it is the serial monitor, or a stray byte).                                                                                                                                                                                                                                  |
| Page to pet        | `hello`, `scan`, `status`, `cancel`; `server <address or -> <port> <fingerprint> <name>`, `wifi <ssidHex> <passwordHex or ->`, `start <setupCode>`; v1's `join <ssidHex> <passwordHex or -> <setupCode>`. The name and password are lowercase hex; `-` is an open network's empty password, or no address for the computer.                                                                                                                                                                                                                                             |
| Pet to page        | `hello <version> <kind> <firmware> paired\|unpaired open\|closed`, `ok server\|wifi\|start`, `net <ssidHex> <rssi> open\|locked`, `scan-done <count>`, `state joining\|pairing\|confirm\|done`, `state error <code>`, `refused <reason>`.                                                                                                                                                                                                                                                                                                                               |
| Codes              | Errors: `wifi_failed`, `code_refused`, `unreachable`, `timed_out`, `save_failed` (the ways `pairWith` and `claimToken` fail; a pet that cannot use the computer it was given says `unreachable`). Refusals: `paired`, `busy`, `bad_line`, `unknown_op`, `rate_limited`, `bad_value`, `not_ready`.                                                                                                                                                                                                                                                                       |
| Checks, in order   | No prefix (ignored), the rate limit (10 lines in any second, `PET_USB_MAX_LINES_PER_SECOND`), the shape, the op, the state, then the values (the setup page's own rules for the Wi-Fi and the code, `core/server_pin.h` for the address, port, fingerprint and name), and for `start` that `server` and `wifi` are both staged (`not_ready`).                                                                                                                                                                                                                           |
| Who may do what    | Unpaired: `hello`, `status`, `cancel` always; `scan`, `server`, `wifi`, `start` and `join` when no try is running (`busy` otherwise). Paired: `hello` only, everything else is `refused paired` before any value is read, so a paired pet on a cable can never be asked to join or be given another computer.                                                                                                                                                                                                                                                           |
| Staged values      | `server` and `wifi` only stage values in RAM and answer `ok server` and `ok wifi`; `start` takes them into the try and forgets them (the Wi-Fi password never sits in the pet longer than it must), and so do `cancel`, a pulled cable and a power cut. A `join` takes the staged server and is `refused not_ready` without one, so no way of starting a try leaves out the pin.                                                                                                                                                                                        |
| Never on the cable | The device token, the device secret, the device id, a request id or a URL with an id, the confirm code, any echo of the Wi-Fi password, the setup code, the address or the fingerprint, the setup network's password, audio, notes, transcripts. The reply builders take only fixed words, counts and a scanned name, and `test_usb_setup` pins it. The state `confirm` only means "listen to your pet": the code is said aloud and typed by the owner, and `WifiSetup::setStatus` keeps it for the setup page alone (the observer that feeds the cable never gets it). |

A `start` runs `NetWorker::pairWith` with the source `Usb`: the setup network is switched
off for the try (the pet joins the Wi-Fi as a station only) and comes back if the try
fails. The cable is answered whenever the pet is unpaired, also after the setup network's
ten minutes have run out: whoever holds the cable is in the room, like a tap of the light.
The line that carried the Wi-Fi password in hex is wiped from the buffer as soon as it is
read.

**The port.** The board is built with `ARDUINO_USB_CDC_ON_BOOT=1`, so the Arduino core
has already called `Serial.begin()` in `app_main` when `setup()` runs. `setup()` in
`main.cpp` then sets the running port's receive buffer to 1024 bytes (the core swaps the
queue and keeps the bytes already waiting, and `Serial.begin(115200)` keeps the new one)
and calls `Serial.enableReboot(false)`, in its first milliseconds, and nothing ever turns
it back on. With reboot enabled (the core's default) the USB serial restarts the chip
into the ROM's download mode when the host opens it at 1200 baud or toggles DTR and RTS
in the esptool order, and from there anything with a port grant could read the flash or
replace the firmware. The short window between the core's begin and `setup()` reaching
those calls is a known limit: a computer would have to open the port at 1200 baud in the
first milliseconds after power-on. The board's own bootloader is still there by hand: the
B1 to GND jumper, or a double press of RST.

Reboot off does not reach a second door. The board definition sets
`-DARDUINO_USB_DFU_ON_BOOT=1`, and the core then registers the board's in-app DFU
interface, whose download callback writes each block into the next app slot and whose
manifest callback switches the boot partition. With it, any program on the computer
(`dfu-util -d 2341:0070 -D x.bin`, which is also what PlatformIO's DFU upload does) or
a page with a WebUSB grant could replace the firmware with no button pressed, paired or
not, which would defeat rule 4. So `[env:nano_esp32]` unflags it and sets
`-DARDUINO_USB_DFU_ON_BOOT=0` (`nano_esp32_first` inherits that; `bringup` keeps the
board's default). In the built image `USB.enableDFU` is discarded by the link and the
DFU descriptor string is not there; the callbacks that stay linked are unreachable
without the interface. `test_usb_setup` pins the flags. Whether the double press of
RST upload and the B1 to GND first flash work with all this, and that the board still
enumerates as `2341:0070`, has not been tried on a unit (see
[Bring-up over USB](#bring-up-over-usb)).

**One writer, and it never waits.** The port's send buffer is small and
`Serial.write()` waits, holding the chip's other work back, until the computer has read
what does not fit, so a page that opens the port and reads nothing would freeze the pet.
`hw/log.*` is therefore the only code that writes to the port: a protocol reply or a
`PET_LOG` line goes into a small queue of whole lines (`core/line_queue.*`, 512 bytes),
the main loop and the network task move it on with `serialPump()`, no write is ever
larger than `Serial.availableForWrite()` says the port can take, and **a line that does
not fit in the queue is dropped whole** (a log line is cut at 160 bytes). Nobody having
the port open (`!Serial`) drops what waits. The page drops every line without the
`@pet1 ` prefix, so the log and the protocol share the port.

**Debug output.** `platformio.ini` pins `-DCORE_DEBUG_LEVEL=0` in `esp32_common`, which
compiles the Arduino core's own `log_e`, `log_w` and the rest out (their default keeps the
error ones, and a line could carry a URL). The pet's only log is `PET_LOG`, which prints
states, counts and status codes and never the Wi-Fi name or password or a code. That the
ESP-IDF's own error and panic output goes to the chip's UART and not to the USB port is
**not checked on a unit**.

### Resetting

Holding the lime light for 10 seconds from power-on forgets the pet. The network
task is told, and what it is doing stops at its next step (a sync, the wait for the
confirm code, a voice pack download, a reply being played); the commands queued
before the reset do not run. If the wipe is not finished in 8 seconds (an upload in
flight cannot be cut short) the main loop clears the token, the secret and the Wi-Fi
itself and restarts, and the next start, finding no pairing, wipes the saved notes.

### Battery cut-off

Below 3.5 V under load the pet switches the lights and the amplifier off and goes to
deep sleep until USB power arrives. The amplifier's shutdown pin is held low through
the sleep (`gpio_hold_en`), because a floating pin sits at about 0.3 V on the
breakout, which the MAX98357A reads as "on". `setup()` lets go of the hold first
(`Power::releaseAmplifierHold`), since a held pad ignores `pinMode` and `digitalWrite`.

### Flash

`partitions_pet.csv` is the Nano ESP32's own table with its FAT partition used for
LittleFS: two 3 MB app slots (for signed over-the-air updates in phase 4), NVS, about
9.4 MB of LittleFS, mounted by the label `littlefs`, and the board's 512 KB factory
slot. The saved notes and one voice pack share the file system. Keep the factory
slot: it holds the Nano's own recovery firmware, which is what a double press of RST
starts for the DFU upload (the only way to update a unit running the pet image), and LittleFS stops before it so a format never touches it.

## Voice packs

The pet plays its saved lines from a voice pack: one `.sfvp` file per voice
(format in `src/core/voice_pack.h`), which the app serves at
`GET /pets/voice/<voice>.sfvp` on the same pinned connection as every call (no token). The
pet downloads the pack of its voice after pairing and when the owner changes the
voice (only while idle, checked and renamed into place from
`/voice/<voice>.sfvp.tmp`; other voices' packs are deleted), and keeps one.

Before it has one, and for any clip a pack lacks, it falls back to the **boot
pack**: a small pack compiled into the firmware (the setup lines, the 31 characters
of the code alphabet and the lines that must work offline) in one default voice.
`include/generated/boot_pack.h` is not in the repository until someone renders it.
**Without it the firmware still builds and runs, but a unit cannot be set up:** the
confirm code (and the setup network's password) are told only by voice (every `char-*`
clip), and a line nobody can say is a short tone, so eight identical beeps tell nobody
anything: the confirm code cannot be heard.
Render it before flashing a unit that will be paired (the renderer is a later phase);
the build warns when it is missing.

The packs are made on your own ElevenLabs key, never in CI and never published, by the
app ([docs/desk-pets-plan.md](../../docs/desk-pets-plan.md), phase P3). The
format is described in [tools/voice-pack/README.md](tools/voice-pack/README.md).
Nothing has been rendered or committed yet, so the pet keeps its boot pack.

## Tests

`pio test -e native` builds `src/core/` with `-Wall -Wextra -Werror` and runs the
Unity suites in `test/` (state machine, queue, ADPCM against the vectors the
TypeScript package writes, lights, gestures, API rules and the answer table, voice
pack, text rules, heartbeat policy, the voice detector, the recording writer and slot
plan, pet-usb v1 and v2 (`test_usb_setup`: the line assembler, the parser, the rate limit, the
paired and busy rules, the staged values and `not_ready`, the reply builders and the log queue,
against the golden lines in `usb_vectors.h` and `usb2_vectors.h`), the computer's record and
the pin (`test_server_pin`: the address, port, name and fingerprint rules, the constant-time
comparison, what a certificate at each depth of a chain is given, the address of a call and
the mDNS name, and source checks that the client names no server, trusts no authority and
reaches no time server), the answer table (`test_api_rules`: the refused voice key and the
used up voice quota told apart from a forgotten pet by the error name, and the date the
computer's clock comes from), and the small pieces: skin ID, battery, base64url, WAV
header, the notice plan).
The hardware modules cannot be unit tested; they are checked by building them in CI
and by the bring-up firmware on a real board. Tests are offline: no network, no
board.

## What a real board must still test

Nothing below has run on a unit. Each line says what to do and what a pass looks like; the
USB and audio checks before it ([Bring-up over USB](#bring-up-over-usb)) come first, then
these, with a computer on the same Wi-Fi that runs OpenStellarFirm with Desk pets on.

1. **The pin on the real TLS stack.** Pair a pet. In the app, Settings, Desk pets, make a new
   certificate (the pet then holds a pin that is no longer the computer's): the pet's next
   call must fail like an unreachable computer (a note is saved, the heartbeat does not
   answer) and **the app's log must show no request carrying the pet's token**. Then pair it
   again: it works. This is the one test that shows `verifyPin` runs inside the handshake
   on mbedtls 3.6.2 (the host check used 2.28), that `esp_crt_bundle_attach` leaves the CA
   chain mbedtls needs for `VERIFY_REQUIRED`, and that a self-signed ECDSA P-256 certificate
   with no dates the pet can check (its clock is at 1970 before the first answer) is
   accepted. Also point a second program on the computer's network at the same port with
   another certificate (for example `openssl s_server` with its own self-signed one, on a
   second machine given the pet's address): the pet must refuse it, and a `tcpdump` of the
   handshake must show a fatal alert and no application data.
2. **The first handshake's cost.** Time a first pair and the first call after a boot: an
   ECDSA handshake on the ESP32-S3 should take a second or two, which `kConnectTimeoutMs`
   (8 s) allows for. Look at free internal RAM (the log prints it when a connect fails) with
   the inbox task's long poll and a turn's upload connecting at once.
3. **The mDNS fallback.** Pair, then give the computer another address (turn its Wi-Fi off
   and on, or reserve another address in the router) and restart the app. The pet's next
   call connects to the old address, fails within 8 seconds, asks `osf-<label>.local` and
   goes on with the new address; after a power cycle it starts from that address (kept in
   NVS). Check three things the host cannot: that the router passes multicast to the pet
   (a guest network or "client isolation" will not), that `mdns_query_a` on this core
   answers for that name, and that `mdns_init` and `mdns_free` around each question leave
   no leak (free heap before and after twenty fall backs).
4. **The server record survives a power cycle,** and a pet paired by firmware that predates
   this one (no record) is forgotten at its first boot and sets up again over the cable.
   The record is written before the token and a power cut between them leaves none: pull
   the power while pairing a few times and check the pet is never left paired with no
   record (it would be forgotten at boot, never stuck).
5. **The key line.** With ElevenLabs set to a wrong key in the app the pet's turn and a
   spoken notice must say "My voice key was refused" and stay paired (a second turn works
   after the key is fixed, no new pairing); with the quota used up it must say the quota is
   used up. A forgotten pet (Forget in the app) must say it was disconnected and go back to
   setup instead: the two 401 answers differ by the error name alone.
6. **The clock.** After the first answer a saved note carries a real `X-Pet-Recorded-At`
   (turn the Wi-Fi off, record, turn it on and read the note in the app), and the pet
   never asks any host but the computer (watch the router's DNS log during a day).
7. **The phone's page.** From a phone on the pet's setup network, `http://192.168.4.1/` shows
   the "use the cable" page and no form, and `curl -X POST -H 'X-Pet-Setup: 1'
   http://192.168.4.1/join -d ssid=x` answers 403 with no state change on the cable.
8. **IPv6.** The app may give an IPv6 address (`fd..`/`2001:..`): check that one pairs and
   that a call to it works; the address is put in brackets in the URL.

Not checked on hardware, from before this phase:

- **The voice detector's thresholds** (`core/vad.h`: `kVadAbsoluteFloorRms` 30,
  `kVadNoiseRatio` 3, `kVadHangoverFrames` 6, `kVadOnsetFrames` 3,
  `kVadInitialNoiseMaxRms` 150) are first guesses from the microphone's measured noise
  and have not been tried on a real pet. They need tuning on hardware before the first
  unit is given to anyone: too high and a quiet speaker is cut off or dropped as "didn't
  catch", too low and a noisy room never lets the pet stop (the 120 second cap still
  does). The noise floor is followed only while silent, so a steady noise that starts
  suddenly above three times the floor (a fan switched on) reads as speech until it
  stops.
- **Everything USB.** None of it has run on a unit; what is known is read from the
  Arduino-ESP32 3.1.3 source. That covers the TinyUSB serial's enumeration as
  `2341:0070`, the rule that it writes only while the host holds DTR,
  `Serial.enableReboot(false)` keeping the 1200-baud touch and the DTR and RTS dance
  from reaching download mode (it is called in `setup()`, after the core has started
  the port, so the first milliseconds after power-on are not covered), the pet image without the board's in-app DFU interface
  (still enumerating as `2341:0070`, and the double press of RST upload and first
  flash still working with both), the 64-byte send buffer against `availableForWrite()` and the log queue, and
  ESP-IDF output staying off the port. The browsers' choosers on macOS and Windows and
  Linux's serial access are untried too. Use [Bring-up over USB](#bring-up-over-usb).
- **Two 0.97 MB slots and the rest of PSRAM.** The second slot is made only when the
  PSRAM leaves 1 MiB; the real free PSRAM after the speaker's ring buffer and the TLS
  stack has not been measured (the serial log says when only one slot was made).
- **The turn's timeouts.** A turn waits up to 85 seconds for the answer after the
  upload (`PET_TURN_HTTP_TIMEOUT_MS`: the 25 second first-answer wait and 60 seconds
  for OpenStellarFirm to transcribe up to two minutes of speech and make the speech), and
  the Sending watchdog gives the whole turn 150 seconds: 45 seconds for the upload
  (`PET_TURN_UPLOAD_SECONDS`, 966,716 bytes at about 170 kbit/s), the 85 seconds and a
  margin. The saved-note watchdog is 20 minutes, enough for a pass over six
  full-length notes. How long OpenStellarFirm really takes to transcribe two minutes has
  not been measured against them; `test_pet_app` keeps the three in order.
- **A flash write while listening.** A note that is being saved can overlap the next
  recording if the owner starts to talk meanwhile (a 0.97 MB write takes a few
  seconds); the receiver is not safe against a flash erase, so a gap in that recording
  is possible.
- `kMinRecordingPeak` (64): noise-floor peaks measured about 25 and quiet speech about
  125, so a note under 64 is dropped as dead air. Confirm it on the real microphone.
- `NoteStoreFs::writeMeta` relies on LittleFS renaming over an existing file in one
  step. If it does not, the old record stays and a refusal only holds until the next
  start.
- The inbox cursor is written to NVS only when it changes; a long run of notices on a
  noisy account has not been measured for wear.

## Not built yet

- **Locked-down units (a later phase).** A development unit keeps the token, the Wi-Fi
  password and the computer's record in plain NVS (a lost pet holds your Wi-Fi password and
  its token: Forget it in the app). Later units get flash encryption, secure boot
  and signed over-the-air updates; the partition table already has the two app
  slots, and `UpdateOffered` is in the state machine.
- A wake word is not planned: the pet starts listening only when the owner holds the
  lime light.
- Repeating the last answer on a tap is not built. The intended behaviour is that a
  tap while not listening plays the waiting notice or repeats the last answer; today a
  tap plays the waiting notice and with nothing waiting does nothing.
- The old double tap, which dismissed the attention lights, is gone: a double tap is
  now "what's happening". Nothing on the pet clears a waiting Approve light any more;
  it runs out by itself after half an hour (`kApproveLightMs`), as the team-working
  light does after a finished piece of work or six hours. The server does not tell the
  pet when an Approve was dealt with.
