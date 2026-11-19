#pragma once

// The light language of the desk pet as pure frames: given a mode, the figure
// and the time, which colour each LED shows. The lights task (ui/lights.cpp)
// calls frame() 50 times a second and writes the result to the WS2812B chain.
//
// The LED chain per figure (hardware/pets/README.md, "What the lights mean"):
//
//   Nova   LED 0 chest light      LED 1 antenna ball
//   Zib    LED 0 belt buckle      LED 1 left antenna     LED 2 right antenna
//   Comet  LED 0 collar tag       LED 1 inside the glass helmet (lights the dome)
//
// LED 0 is "the lime light" the owner holds to talk. While the pet records it is
// solid lime at full brightness (Listening) and no other mode shows that colour
// as a steady light, so it always means "the microphone is on".
//
// `tMs` is the time since the mode began (the lights task restarts it whenever
// the mode changes). Done is a one-shot of about a second that ends in the Ready
// breath, and Checked a one-shot of 200 ms that ends in it too; every other mode
// repeats.

#include <cstdint>

#include "generated/protocol.h"
#include "pins.h"

namespace pet {

struct Rgb {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  constexpr bool operator==(const Rgb& o) const { return r == o.r && g == o.g && b == o.b; }
  constexpr bool operator!=(const Rgb& o) const { return !(*this == o); }
};

// The brand colours of the lights (the app's pets use the same ones).
constexpr Rgb kLime{0xd9, 0xff, 0x3f};
constexpr Rgb kSky{0x6f, 0xd0, 0xff};
constexpr Rgb kIvory{0xf3, 0xef, 0xe6};
constexpr Rgb kNebula{0xa5, 0x96, 0xff};
constexpr Rgb kRose{0xff, 0x8f, 0xb1};
constexpr Rgb kMoon{0xe4, 0xe2, 0xef};
constexpr Rgb kDark{0x00, 0x00, 0x00};

enum class LightMode : uint8_t {
  Off,
  Setup,         // setting up Wi-Fi or pairing: sky, slow blink, the antennas chase
  Ready,         // lime, a soft breath every 6 seconds at low brightness
  Listening,     // the mic is recording: LED 0 solid lime at full brightness
  Thinking,      // sending, waiting for the first answer: lime, 1 Hz pulse
  Speaking,      // ivory, flickers with the voice level
  TeamWorking,   // lime, the antennas or the dome alternate slowly
  NeedsApprove,  // nebula, a slow blink every 2 seconds (the Approve is in the app)
  Done,          // three quick lime sparkles, then Ready
  Stopped,       // rose, a double blink
  OfflineSaving, // moon, a slow breath
  MicOff,        // rose, dim and solid on the chest light
  LowBattery,    // rose, one blink every 10 seconds
  ChargingIdle,  // lime, a slow fill-up pulse
  Quiet,         // quiet hours: only the antenna or dome, at 2 percent moon
  Checked,       // the answer to a double tap with nothing waiting: one short lime blink
};

// How many LEDs the figure carries (Nova 2, Zib 3, Comet 2).
uint8_t ledCount(PetKind kind);

// The colour scaled to level/255 (255 returns it unchanged).
Rgb scaleRgb(Rgb colour, uint8_t level);

// The hue LED 0 shows in a mode at full brightness; the mode's pattern scales
// it. Black for Off and Quiet. For Listening it is lime exactly.
Rgb ledZeroBase(LightMode mode);

// Fills out[0..count-1] with the LEDs' colours; the rest of out[] is black.
// `voiceLevel` (0..255) matters to Speaking only.
void frame(LightMode mode, PetKind kind, uint32_t tMs, uint8_t voiceLevel, Rgb out[PET_LED_COUNT_MAX], uint8_t& count);

const char* lightModeName(LightMode mode);

}  // namespace pet
