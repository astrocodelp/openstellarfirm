#include "battery.h"

#include "config.h"

namespace pet {

float batteryVoltsFromSense(int mvAtPin) { return static_cast<float>(mvAtPin) * 2.0f / 1000.0f; }

float batteryFraction(float volts) {
  struct Point {
    float volts;
    float fraction;
  };
  static const Point kCurve[] = {{3.5f, 0.0f}, {3.7f, 0.35f}, {3.85f, 0.6f}, {4.0f, 0.85f}, {4.15f, 1.0f}};
  const int count = static_cast<int>(sizeof(kCurve) / sizeof(kCurve[0]));
  if (!(volts > kCurve[0].volts)) {
    return 0.0f;
  }
  if (volts >= kCurve[count - 1].volts) {
    return 1.0f;
  }
  for (int i = 1; i < count; ++i) {
    if (volts <= kCurve[i].volts) {
      const float span = kCurve[i].volts - kCurve[i - 1].volts;
      const float t = (volts - kCurve[i - 1].volts) / span;
      return kCurve[i - 1].fraction + t * (kCurve[i].fraction - kCurve[i - 1].fraction);
    }
  }
  return 1.0f;
}

bool isLow(float volts) { return volts < PET_LOW_BATTERY_VOLTS; }

bool isCritical(float volts) { return volts < PET_CRITICAL_BATTERY_VOLTS; }

int batteryBand(float fraction) {
  if (!(fraction > 0.0f)) {
    return 0;
  }
  const int band = static_cast<int>(fraction * 5.0f);
  return band > 4 ? 4 : band;
}

}  // namespace pet
