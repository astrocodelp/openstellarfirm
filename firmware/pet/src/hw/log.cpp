#include "hw/log.h"

#include <Arduino.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <atomic>
#include <cstdarg>
#include <cstdio>
#include <new>

#include "core/line_queue.h"

namespace pet {

namespace {

// A log line is cut at this many bytes (the longest one in the firmware is about a
// hundred).
constexpr size_t kLogLineBytes = 160;
// How long a sender waits for another task that is moving bytes. Short: a line that
// cannot be queued is dropped, never waited for.
constexpr TickType_t kLockWait = pdMS_TO_TICKS(20);

// The queue itself. The development board build's ring is 32 KB (it carries audio
// lines), which as a static object came out of internal RAM and left too little for a
// second TLS connection: a turn or a heartbeat made while the inbox call was open
// failed to connect. That build keeps the ring in PSRAM instead.
LineQueue& queue() {
#ifdef PET_DEVBOARD
  static LineQueue* made = []() -> LineQueue* {
    void* room = heap_caps_malloc(sizeof(LineQueue), MALLOC_CAP_SPIRAM);
    return room != nullptr ? new (room) LineQueue() : new LineQueue();
  }();
  return *made;
#else
  static LineQueue made;
  return made;
#endif
}
// What the queue holds, readable without the lock so serialPump() costs nothing when
// there is nothing to move.
std::atomic<size_t> queued{0};

SemaphoreHandle_t lock() {
  static SemaphoreHandle_t handle = xSemaphoreCreateMutex();
  return handle;
}

// Moves what the port can take right now. The lock is held. Every write is at most
// what availableForWrite() reported, so Serial.write() finds room for all of it and
// returns at once.
void drain() {
  if (queue().empty()) {
    return;
  }
  if (!Serial) {
    queue().clear();  // the computer left: what waits is for nobody, and half a line is no line
    queued.store(0);
    return;
  }
  while (!queue().empty()) {
    const int room = Serial.availableForWrite();
    if (room <= 0) {
      break;
    }
    const uint8_t* data = nullptr;
    size_t run = queue().front(data);
    if (run > static_cast<size_t>(room)) {
      run = static_cast<size_t>(room);
    }
    const size_t written = Serial.write(data, run);
    queue().consume(written);
    if (written < run) {
      break;
    }
  }
  queued.store(queue().size());
}

}  // namespace

SerialSend serialSendLine(const uint8_t* line, size_t length) {
  if (line == nullptr || length == 0 || xPortInIsrContext()) {
    return SerialSend::NoRoom;
  }
  if (!Serial) {
    return SerialSend::NotConnected;
  }
  if (xSemaphoreTake(lock(), kLockWait) != pdTRUE) {
    return SerialSend::NoRoom;
  }
  drain();  // room first, for what is already waiting
  const bool taken = queue().push(line, length);
  queued.store(queue().size());
  drain();
  xSemaphoreGive(lock());
  return taken ? SerialSend::Queued : SerialSend::NoRoom;
}

void serialPump() {
  if (queued.load() == 0 || xPortInIsrContext()) {
    return;
  }
  if (xSemaphoreTake(lock(), 0) != pdTRUE) {
    return;  // another task is moving bytes right now and will finish the job
  }
  drain();
  xSemaphoreGive(lock());
}

void logLine(const char* format, ...) {
  if (!Serial) {
    return;  // nobody is listening: skip the formatting too
  }
  char line[kLogLineBytes];
  va_list args;
  va_start(args, format);
  const int n = vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  if (n <= 0) {
    return;
  }
  size_t length = static_cast<size_t>(n);
  if (length >= sizeof(line)) {
    length = sizeof(line) - 1;  // cut, but a line always ends with its newline
    line[length - 1] = '\n';
  }
  serialSendLine(reinterpret_cast<const uint8_t*>(line), length);
}

}  // namespace pet
