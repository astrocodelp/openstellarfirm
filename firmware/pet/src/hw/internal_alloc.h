#pragma once

#include <esp_heap_caps.h>

#include <cstddef>

namespace pet {

// Runs `fn` while every free block of PSRAM is held, so that an allocation made with
// MALLOC_CAP_DEFAULT inside it can only come from internal RAM.
//
// Why: on this core (Arduino-ESP32 3.1.3, ESP-IDF 5.3, with PSRAM) a small
// heap_caps_calloc(..., MALLOC_CAP_DEFAULT) lands in PSRAM, while malloc() keeps
// small blocks internal. The I2S driver makes its channel object that way, and the
// core is built with CONFIG_GDMA_ISR_IRAM_SAFE, whose DMA interrupt refuses a context
// outside internal RAM: every i2s_channel_init_std_mode() failed with
// ESP_ERR_INVALID_ARG ("user context not in internal RAM"), so the pet had no speaker
// and no microphone. Found on a bare Nano ESP32 with the devboard build.
//
// Call it only in setup(), before the other tasks start: while it runs, nothing else
// can get PSRAM.
template <typename Fn>
auto withPsramHeld(Fn fn) -> decltype(fn()) {
  constexpr int kMaxBlocks = 64;
  void* held[kMaxBlocks] = {};
  int count = 0;
  while (count < kMaxBlocks) {
    const size_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM);
    if (largest < 16) {
      break;
    }
    void* block = heap_caps_malloc(largest, MALLOC_CAP_SPIRAM);
    if (block == nullptr) {
      break;
    }
    held[count++] = block;
  }
  auto result = fn();
  for (int i = 0; i < count; ++i) {
    heap_caps_free(held[i]);
  }
  return result;
}

}  // namespace pet
