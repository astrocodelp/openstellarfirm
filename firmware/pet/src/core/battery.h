#pragma once

// The battery as the pet reads it: the voltage at VSYS through a 220 k / 220 k
// divider on A0, turned into volts and a rough fraction for the heartbeat.

namespace pet {

// VSYS volts from the millivolts the ADC reports at the pin (the divider halves it).
float batteryVoltsFromSense(int mvAtPin);

// A one-cell LiPo's charge as 0..1 from its voltage, a piecewise-linear curve:
// 3.5 V is 0, 3.7 V 0.35, 3.85 V 0.6, 4.0 V 0.85, 4.15 V and above 1.
float batteryFraction(float volts);

// Below 3.6 V the pet asks for the charger; below 3.5 V it shuts down under load.
bool isLow(float volts);
bool isCritical(float volts);

// Five bands of the fraction (0..4), for the heartbeat to send on a change
// instead of on every reading.
int batteryBand(float fraction);

}  // namespace pet
