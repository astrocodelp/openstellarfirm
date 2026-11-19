#pragma once

#include <cstdint>

namespace pet {

struct PowerReading {
  float volts = 0.0f;     // VSYS, from the divider on A0
  float fraction = 0.0f;  // a rough 0..1 for the heartbeat
  bool charging = false;  // the charger chip is charging the cell (CHG low)
  bool usbPresent = false;  // USB power is plugged into the CHARGE port (PGOOD low)

  // On USB power the battery is not what runs the pet: VSYS is held near 4.4 V,
  // so the low-battery rules must not fire.
  bool externalPower() const { return charging || usbPresent; }
};

class Power {
 public:
  // Sets the pins up. The charger lines and the mic switch line have pull-ups
  // (or a divider) on the core board.
  void begin();

  // One reading: the battery voltage averaged over 16 samples of the ADC (the
  // lights and the amplifier pull the rail around, one sample would jump).
  PowerReading read();

  // The MIC slide switch: true when it is on. The switch cuts the microphone's
  // own power; this line only tells the firmware, so it can say so and keep the
  // light honest. The firmware never records with it off.
  bool micSwitchOn() const;

  // Deep sleep until USB power is plugged in again (the chip restarts then). The
  // caller has already switched the lights and the amplifier off; this holds the
  // amplifier's shutdown pin low through the sleep. Does not return.
  [[noreturn]] static void sleepUntilPlugged();

  // The first thing setup() does: lets go of the hold that sleepUntilPlugged() put
  // on the amplifier's shutdown pin, so the pin can be driven again. Harmless when
  // nothing was held (a power-on or a plain restart).
  static void releaseAmplifierHold();
};

}  // namespace pet
