#include "ui/lights.h"

#include <Arduino.h>

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

namespace pet {

Lights::Lights() : strip_(PET_LED_COUNT_MAX, PIN_LED_DATA, NEO_GRB + NEO_KHZ800) {}

void Lights::begin(PetKind kind) {
  kind_ = kind;
  mutex_ = xSemaphoreCreateMutex();
  strip_.begin();
  const Rgb dark[PET_LED_COUNT_MAX] = {};
  write(dark);
}

void Lights::write(const Rgb out[PET_LED_COUNT_MAX]) {
  // Nothing new to show: skip the show(), which holds the data pin for a moment.
  bool same = lastValid_;
  for (int i = 0; i < PET_LED_COUNT_MAX && same; ++i) {
    same = (out[i] == last_[i]);
  }
  if (same) {
    return;
  }
  for (int i = 0; i < PET_LED_COUNT_MAX; ++i) {
    strip_.setPixelColor(i, out[i].r, out[i].g, out[i].b);
    last_[i] = out[i];
  }
  lastValid_ = true;
  strip_.show();
#ifdef PET_DEVBOARD
  devboard::lightTee(out[0]);
#endif
}

void Lights::render(uint32_t nowMs) {
  if (mutex_ == nullptr || xSemaphoreTake(mutex_, pdMS_TO_TICKS(50)) != pdTRUE) {
    return;
  }
  if (!direct_.load(std::memory_order_relaxed)) {
    // The microphone itself decides first: if it runs, this is the Listening frame.
    const LightMode wanted = micLive_.load(std::memory_order_acquire) ? LightMode::Listening : mode();
    if (wanted != lastMode_) {
      lastMode_ = wanted;
      modeSinceMs_ = nowMs;
    }
    Rgb out[PET_LED_COUNT_MAX] = {};
    uint8_t count = 0;
    frame(wanted, kind_, static_cast<uint32_t>(nowMs - modeSinceMs_), level_.load(std::memory_order_relaxed), out, count);
    write(out);
  }
  xSemaphoreGive(mutex_);
}

void Lights::setMicLive(bool live) {
  if (live) {
    direct_.store(false, std::memory_order_relaxed);
    micLive_.store(true, std::memory_order_release);
    // Draw the lime light before the caller switches the microphone on.
    render(millis());
  } else {
    micLive_.store(false, std::memory_order_release);
  }
}

void Lights::setDirect(const Rgb* colours, uint8_t count) {
  if (mutex_ == nullptr || xSemaphoreTake(mutex_, pdMS_TO_TICKS(50)) != pdTRUE) {
    return;
  }
  direct_.store(true, std::memory_order_relaxed);
  Rgb out[PET_LED_COUNT_MAX] = {};
  for (uint8_t i = 0; i < count && i < PET_LED_COUNT_MAX; ++i) {
    out[i] = colours[i];
  }
  write(out);
  xSemaphoreGive(mutex_);
}

void Lights::off() {
  mode_.store(static_cast<uint8_t>(LightMode::Off), std::memory_order_relaxed);
  micLive_.store(false, std::memory_order_release);
  const Rgb dark[PET_LED_COUNT_MAX] = {};
  setDirect(dark, PET_LED_COUNT_MAX);
}

bool Lights::startTask(UBaseType_t priority, BaseType_t core) {
  return xTaskCreatePinnedToCore(&Lights::taskEntry, "lights", 4096, this, priority, nullptr, core) == pdPASS;
}

void Lights::taskEntry(void* self) {
  Lights* lights = static_cast<Lights*>(self);
  TickType_t lastWake = xTaskGetTickCount();
  for (;;) {
    lights->render(millis());
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(PET_LIGHT_FRAME_MS));
  }
}

}  // namespace pet
