#include "ui/button.h"

#include <Arduino.h>

#include "pins.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

namespace pet {

void Button::begin() { pinMode(PIN_BUTTON, INPUT_PULLUP); }

bool Button::pressedNow() const {
#ifdef PET_DEVBOARD
  // The page's talk button, or a wire from D10 to GND.
  if (devboard::buttonDown()) {
    return true;
  }
#endif
  return digitalRead(PIN_BUTTON) == LOW;
}

GestureEvent Button::poll(uint32_t nowMs) { return gestures_.update(pressedNow(), nowMs); }

}  // namespace pet
