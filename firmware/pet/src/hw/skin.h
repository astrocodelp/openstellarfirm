#pragma once

#include "core/skin_id.h"

namespace pet {

// The skin ID pin in millivolts: 16 readings averaged.
int readSkinMillivolts();

// Which figure stands on the pad (core/skin_id.h has the voltage bands).
//
// The pin is GPIO13, which is on the ESP32-S3's ADC2, and ADC2 is shared with the
// Wi-Fi radio: a read while Wi-Fi runs can fail or return junk. So call this once
// at boot, before the radio starts, and keep the answer; the figure does not
// change while the pet is powered.
PetKindOrNone readSkin();

}  // namespace pet
