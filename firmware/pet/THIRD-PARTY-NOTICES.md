# Third-party notices for the desk pet firmware

The firmware and the print files are contributed by Astro Code L.P. under the
licence in the repository's [LICENSE](../../LICENSE) (see [NOTICE](../../NOTICE)).
A built firmware image also contains the work of others, under their own
licences. This list is for people who build and flash a pet. **Nothing in it
ships inside the OpenStellarFirm desktop app**: the app never includes this
folder's build output, and the app's own third-party list is the one in
[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

None of these are copied into this repository. PlatformIO downloads each one
at the exact version pinned in [platformio.ini](platformio.ini) when you build.

## In the firmware image

| What                                                                                                   | Version                                           | Licence                                                                                         | Where from                                                 |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Arduino-ESP32 core, with its bundled libraries (WiFi, WebServer, DNSServer, Preferences, FS, LittleFS) | the one that the pinned platform release installs | LGPL-2.1-or-later                                                                               | https://github.com/espressif/arduino-esp32                 |
| Adafruit NeoPixel                                                                                      | 1.12.3                                            | LGPL-3.0-or-later                                                                               | https://github.com/adafruit/Adafruit_NeoPixel              |
| ArduinoJson                                                                                            | 7.2.1                                             | MIT                                                                                             | https://github.com/bblanchon/ArduinoJson                   |
| ESP-IDF, with its HTTP client and TLS client (`esp_http_client`, `esp-tls`), FreeRTOS and drivers      | the one that the pinned platform release installs | Apache-2.0                                                                                      | https://github.com/espressif/esp-idf                       |
| mbedTLS, inside ESP-IDF (TLS and the SHA-256 the pet uses)                                             | the one ESP-IDF carries                           | Apache-2.0 (it is also offered under GPL-2.0-or-later; this firmware uses the Apache-2.0 terms) | https://github.com/Mbed-TLS/mbedtls                        |
| The CA certificate bundle (`esp_crt_bundle`, a list of root certificates from Mozilla's CA store)      | the one ESP-IDF carries                           | MPL-2.0 for the certificate data; the code around it is Apache-2.0                              | https://github.com/espressif/esp-idf, `components/esp-tls` |
| littlefs, the file system of the pet's flash, inside the core's LittleFS library                       | the one the core carries                          | BSD-3-Clause                                                                                    | https://github.com/littlefs-project/littlefs               |

The pinned platform is the pioarduino release `53.03.13` of
`platform-espressif32` (Apache-2.0,
https://github.com/pioarduino/platform-espressif32). The release's own
`platform.json` names the exact Arduino-ESP32, ESP-IDF and toolchain versions
it installs. That file was not read when this list was written, so check it
whenever you change the pin, and fill in the rows above that say "the one the
pinned platform release installs".

### The LGPL parts

The Arduino-ESP32 core and Adafruit NeoPixel are LGPL, and they are linked
into the image. You may change and replace them: this folder holds all of the
firmware's own source and `platformio.ini` names every library, so you can
build the image again with your own copy of either one. Their licence texts
come with the packages PlatformIO downloads.

## Only when you run the tests

| What                                                                         | Licence    | Note                                          |
| ---------------------------------------------------------------------------- | ---------- | --------------------------------------------- |
| Unity (ThrowTheSwitch), PlatformIO's test framework for `pio test -e native` | MIT        | Runs on your computer, never flashed to a pet |
| PlatformIO Core                                                              | Apache-2.0 | A build tool, not part of the image           |

## For the print files

| What                                                                                                                                          | Licence                   | Note                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liberation Sans Bold, the font that [`hardware/pets/cad/base.scad`](../../hardware/pets/cad/base.scad) names for the labels on the launch pad | SIL Open Font License 1.1 | Named only. It is **not** shipped in this repository, and the exported print files hold the letters as shapes. OpenSCAD takes the font from your own computer. |
| OpenSCAD                                                                                                                                      | GPL-2.0-or-later          | The program that turns the `.scad` files into print files. It is not part of this repository.                                                                  |

## Voice lines

No voice recording is published here. The pet's spoken lines are made on your
own ElevenLabs key when you set a pet up, so no audio is shipped.
