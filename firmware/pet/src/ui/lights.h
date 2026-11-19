#pragma once

#include <Adafruit_NeoPixel.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include <atomic>
#include <cstdint>

#include "config.h"
#include "core/light_frames.h"
#include "pins.h"

namespace pet {

// The WS2812B chain in the figure, drawn from the pure light frames
// (core/light_frames.h). A lights task calls render() 50 times a second.
//
// Rule 4 of docs/desk-pets-plan.md is kept here a second time, below the state
// machine: whenever the microphone is really running (setMicLive(true), which the
// microphone driver calls before it switches the receiver on and clears after it
// switches it off), the frame is the Listening one, LED 0 solid lime at full
// brightness, whatever mode anyone asked for. The light cannot be wrong about the
// microphone because it follows the microphone itself.
class Lights {
 public:
  Lights();

  // Starts the strip dark. `kind` is the figure on the pad (how many LEDs it has
  // and what each one does).
  void begin(PetKind kind);

  // What the state machine wants (Actions::lightMode). Safe from any task.
  void setMode(LightMode mode) {
    direct_.store(false, std::memory_order_relaxed);
    mode_.store(static_cast<uint8_t>(mode), std::memory_order_relaxed);
  }
  LightMode mode() const { return static_cast<LightMode>(mode_.load(std::memory_order_relaxed)); }

  // How loud the voice is (0..255), for the Speaking flicker.
  void setVoiceLevel(uint8_t level) { level_.store(level, std::memory_order_relaxed); }

  // Rule 4. Turning it on draws the Listening frame at once, before returning.
  void setMicLive(bool live);
  bool micLive() const { return micLive_.load(std::memory_order_acquire); }

  // Draws one frame for the time `nowMs`. Only shows the strip when the frame
  // differs from the last one.
  void render(uint32_t nowMs);

  // Bring-up: shows these colours now and leaves the light language alone until
  // the next setMode() or setMicLive(true). Missing LEDs are dark.
  void setDirect(const Rgb* colours, uint8_t count);

  // All LEDs dark, now.
  void off();

  // Starts the 50 Hz lights task on `core`.
  bool startTask(UBaseType_t priority, BaseType_t core);

 private:
  static void taskEntry(void* self);
  void write(const Rgb out[PET_LED_COUNT_MAX]);

  Adafruit_NeoPixel strip_;
  PetKind kind_ = PET_DEFAULT_KIND;
  std::atomic<uint8_t> mode_{static_cast<uint8_t>(LightMode::Off)};
  std::atomic<uint8_t> level_{0};
  std::atomic<bool> micLive_{false};
  std::atomic<bool> direct_{false};
  LightMode lastMode_ = LightMode::Off;
  uint32_t modeSinceMs_ = 0;
  Rgb last_[PET_LED_COUNT_MAX] = {};
  bool lastValid_ = false;
  SemaphoreHandle_t mutex_ = nullptr;
};

}  // namespace pet
