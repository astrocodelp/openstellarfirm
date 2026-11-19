#pragma once

// The talk button as gestures. Pure: the hardware driver (ui/button.cpp) reads
// the pin and passes the raw level and the time; this turns it into events.
//
//   Down       a press, once it has been steady for the debounce time
//   HoldStart  the press reached PET_TAP_MAX_MS (0.4 s): the hold of the lime light.
//              This is what starts the microphone (the app's ButtonDown); rule 4
//              allows the mic only after this hold, never by itself, and nothing
//              before the hold is recorded. A hold while the pet already listens is
//              the owner pressing the light again: the app sends what it has at once.
//   Up         the release of a hold. Listening goes on after it (the app's ButtonUp
//              does nothing); it stops on silence, a tap, or the cap.
//   Tap        a release before PET_TAP_MAX_MS. While the pet listens, a tap stops
//              it and sends at once; otherwise it plays the waiting notice (repeating
//              the last answer, which is intended, is not built yet).
//   DoubleTap  a second tap that follows a tap within PET_DOUBLE_TAP_MS (the
//              tap before it was already reported as a Tap). It asks "what's
//              happening": the pet plays what waits, asks the inbox, or blinks once
//              (core/pet_app.h)
//   ResetHold  the button was already held when the pet powered on and stayed
//              held for PET_RESET_HOLD_MS: forget everything
//
// One event per update() call; the events of one release (Up or Tap or
// DoubleTap) never need two. A press that was already down at power-on gives
// no Down, HoldStart, Up or Tap at all, only the ResetHold if it is held long
// enough, so holding the button to reset never starts the microphone.
//
// Times are milliseconds from a free-running 32-bit counter; differences are
// taken in unsigned arithmetic, so a wrap after 49 days changes nothing.

#include <cstdint>

#include "config.h"

namespace pet {

enum class GestureEvent : uint8_t { None, Down, Up, Tap, DoubleTap, HoldStart, ResetHold };

class Gestures {
 public:
  // Call this often (every few milliseconds) with the raw pin level: true when
  // the button is pressed (the pin is active low; the driver inverts it).
  // The first call is the power-on sample.
  GestureEvent update(bool pressedRaw, uint32_t nowMs);

  // The debounced state.
  bool pressed() const { return stable_; }

 private:
  bool started_ = false;
  bool raw_ = false;
  bool stable_ = false;
  uint32_t rawSince_ = 0;

  uint32_t bootAt_ = 0;
  bool bootHeld_ = false;  // pressed at power-on and not released since
  bool resetSent_ = false;

  uint32_t downAt_ = 0;
  bool holdSent_ = false;

  bool tapPending_ = false;  // a tap was reported and a second one may follow
  uint32_t tapUpAt_ = 0;
  bool secondPress_ = false;  // this press follows a tap closely enough
};

}  // namespace pet
