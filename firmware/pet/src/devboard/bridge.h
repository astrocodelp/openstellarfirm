#pragma once

// The development board bridge (env devboard): the real pet firmware on a bare
// Arduino Nano ESP32, with the laptop standing in for the parts that are not
// wired yet. The laptop page (the simulator's Board mode, Web Serial; a later phase of
// docs/desk-pets-plan.md) is the
// pet's microphone, speaker, talk button and MIC switch, and shows its light.
//
// THIS IS NOT THE PET. It breaks two rules of docs/desk-pets-plan.md on purpose and
// so it must never be flashed onto a pet that will be paired for real:
//   * audio crosses the USB cable in both directions (the never-echo rule of
//     pet-usb v1 forbids that), and
//   * the ids of the clips being played cross it, so the page can say them while
//     there is no boot pack: during setup those are the characters of the setup
//     passphrase and of the confirm code.
// It pairs with the hardware id "nano-esp32-devboard", so the owner's list and the
// server can always tell it apart. Rule 4 still holds where the laptop is the
// microphone: the page sends audio only between "mic on" and "mic off", which
// the board sends only after the owner's press of the light, with LED 0 lime.
//
// Wire (one text line each, "@dev1 " first, so the page drops the log lines and
// the pet-usb lines; base64url without padding):
//   board -> page   @dev1 hello <kind>
//                   @dev1 led <rrggbb>          LED 0, on change
//                   @dev1 mic on | @dev1 mic off
//                   @dev1 spk <adpcm block>     the speaker at 11025 Hz, one IMA-ADPCM
//                                               block of 132 bytes (257 samples)
//                   @dev1 clip <id> [<id>...]   the clips a line is made of
//   page -> board   @dev1 hello
//                   @dev1 btn 1 | @dev1 btn 0   the talk button
//                   @dev1 micsw 1 | @dev1 micsw 0
//                   @dev1 mic <pcm16 16000 Hz>  only while the board said mic on
//   development only (scripts and the page's log, never the pet):
//                   @dev1 stats        counters and the boot facts ("speaker=1 mic=1")
//                   @dev1 where        logs the state machine's state and what the
//                                      voice detector heard
//                   @dev1 offline-pet  stores a made-up pairing and a Wi-Fi network
//                                      that does not exist, then restarts: a paired
//                                      pet with no network, so a recording can be
//                                      tried with no server (it becomes a saved note)
//                   @dev1 forget       wipes what the pet stored, then restarts
//                   @dev1 restart
// Every other line the page sends (pet-usb v1) is passed on to net/usb_setup.cpp.

#ifdef PET_DEVBOARD

#include <cstddef>
#include <cstdint>

#include "core/light_frames.h"

namespace pet {
namespace devboard {

// Sets the onboard RGB LED up and starts the task that reads the port.
void begin(const char* kindName);

// What the page sent that is not for the bridge, for net/usb_setup.cpp.
int setupAvailable();
int setupRead();

// The microphone: up to `n` samples the page sent, oldest first. Returns how many.
size_t micTake(int16_t* out, size_t n);
// Tells the page to start or stop sending the microphone (and drops what is left).
void micLive(bool on);

// A copy of what the speaker plays, for the page.
void speakerTee(const int16_t* mono, size_t n);
// LED 0, for the page and the board's own RGB LED.
void lightTee(const Rgb& led0);
// The clips a line is made of.
void clipTee(const char* const* ids, size_t count);

// A fact from setup() ("speaker", 1), printed by "@dev1 stats": the boot log is gone
// by the time a computer opens the port.
void note(const char* key, int value);

// A command the page (or a test script) may send as "@dev1 <name>", run on the
// bridge's task. main.cpp registers the ones that need its objects.
using Command = void (*)();
void onCommand(const char* name, Command fn);

bool buttonDown();
bool micSwitchOn();

}  // namespace devboard
}  // namespace pet

#endif  // PET_DEVBOARD
