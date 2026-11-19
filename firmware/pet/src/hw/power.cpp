#include "hw/power.h"

#include <Arduino.h>
#include <driver/gpio.h>
#include <esp_sleep.h>

#include "core/battery.h"
#include "pins.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

namespace pet {

void Power::begin() {
  // CHG and PGOOD are open-drain with 10 k pull-ups on the board.
  pinMode(PIN_CHARGING, INPUT);
  pinMode(PIN_USB_PRESENT, INPUT);
  // Plain INPUT, no internal pull: the sense line comes through 100 k from the
  // switched microphone supply, and an internal pull-down would swamp it.
  pinMode(PIN_MIC_SWITCH, INPUT);
  pinMode(PIN_BATTERY_SENSE, INPUT);
}

PowerReading Power::read() {
#ifdef PET_DEVBOARD
  // No battery and no charger on a bare board: the pins float. It reads as full and
  // on USB power, so the low-battery rules and the sleep never fire.
  PowerReading fake;
  fake.volts = 4.2f;
  fake.fraction = 1.0f;
  fake.usbPresent = true;
  return fake;
#endif
  uint32_t sum = 0;
  const int samples = 16;
  for (int i = 0; i < samples; ++i) {
    sum += analogReadMilliVolts(PIN_BATTERY_SENSE);
    delayMicroseconds(200);
  }
  PowerReading r;
  r.volts = batteryVoltsFromSense(static_cast<int>(sum / samples));
  r.fraction = batteryFraction(r.volts);
  r.charging = digitalRead(PIN_CHARGING) == LOW;
  r.usbPresent = digitalRead(PIN_USB_PRESENT) == LOW;
  return r;
}

bool Power::micSwitchOn() const {
#ifdef PET_DEVBOARD
  return devboard::micSwitchOn();
#else
  return digitalRead(PIN_MIC_SWITCH) == HIGH;
#endif
}

void Power::releaseAmplifierHold() { gpio_hold_dis(static_cast<gpio_num_t>(PIN_AMP_SD)); }

void Power::sleepUntilPlugged() {
  // The amplifier's shutdown pin must stay low for the whole sleep. In deep sleep
  // the pad is let go, and the breakout's 1 M pull-up to VIN against the chip's
  // 100 k pull-down puts a floating SD at about 0.3 V, which the MAX98357A reads
  // as "on": it would draw its quiescent current from a cell that is already empty.
  // GPIO8 is an RTC pad on the S3, so the hold survives deep sleep. setup() lets go
  // of it again (releaseAmplifierHold), since a held pad ignores pinMode and
  // digitalWrite after the wake-up reset.
  digitalWrite(PIN_AMP_SD, LOW);
  gpio_hold_en(static_cast<gpio_num_t>(PIN_AMP_SD));
  // PGOOD goes low when USB power arrives, and the board has a 10 k pull-up on it,
  // so a low level on this RTC pin wakes the chip.
  esp_sleep_enable_ext0_wakeup(static_cast<gpio_num_t>(PIN_USB_PRESENT), 0);
  esp_deep_sleep_start();
}

}  // namespace pet
