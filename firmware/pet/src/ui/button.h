#pragma once

#include "core/gestures.h"

namespace pet {

// The talk button on the figure's skin connector: read the pin, run the pure
// debounce and gesture logic over it.
class Button {
 public:
  // INPUT_PULLUP: the button pulls the pin to ground.
  void begin();

  // Call every few milliseconds. The first call is the power-on sample, so a
  // button that is held while the pet powers up is seen as held at boot (the
  // 10 second reset), never as the start of a talk hold.
  GestureEvent poll(uint32_t nowMs);

  // The raw pin: true while the button is pressed.
  bool pressedNow() const;

  // The debounced state.
  bool pressed() const { return gestures_.pressed(); }

 private:
  Gestures gestures_;
};

}  // namespace pet
