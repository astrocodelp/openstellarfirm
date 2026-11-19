#include "hw/skin.h"

#include <Arduino.h>

#include "config.h"
#include "pins.h"

namespace pet {

int readSkinMillivolts() {
  // The board pulls the pin up with 10 k; the figure's resistor pulls it down.
  pinMode(PIN_SKIN_ID, INPUT);
  uint32_t sum = 0;
  const int samples = 16;
  for (int i = 0; i < samples; ++i) {
    sum += analogReadMilliVolts(PIN_SKIN_ID);
    delayMicroseconds(200);
  }
  return static_cast<int>(sum / samples);
}

PetKindOrNone readSkin() {
#ifdef PET_DEVBOARD
  // No figure and no ID resistor: the build says which figure it plays.
  return PetKindOrNone::of(PET_DEVBOARD_KIND);
#else
  return skinFromMillivolts(readSkinMillivolts());
#endif
}

}  // namespace pet
