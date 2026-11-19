#pragma once

// A small byte ring for the serial port that takes whole lines or nothing. Kept apart
// from the hardware so it can be tested (hw/log.cpp wraps it in a lock and moves its
// bytes to the port).
//
// Why it exists: the Nano ESP32's USB serial has a send buffer of 64 bytes, and
// Serial.write() waits (without letting any other task run) until the computer has
// read what does not fit. A computer that holds the port open and reads nothing would
// freeze the pet, so nothing is ever written that the port cannot take at once. A
// line longer than 64 bytes (a log line, the name of a Wi-Fi network) therefore waits
// here and leaves in pieces as the port frees up. A line that does not fit in this
// ring is dropped whole, so the computer never sees half a line from a full queue.

#include <cstddef>
#include <cstdint>

namespace pet {

class LineQueue {
 public:
  // What the ring holds at most. A line is at most about a hundred bytes. The
  // development board build (env devboard) carries audio lines and sets a larger one.
#ifdef PET_LINE_QUEUE_BYTES
  static constexpr size_t kCapacity = PET_LINE_QUEUE_BYTES;
#else
  static constexpr size_t kCapacity = 512;
#endif

  // Stores the line, or stores nothing and returns false: empty, or more than room().
  bool push(const uint8_t* bytes, size_t length);

  // The oldest queued bytes that sit in one run, for the port to take. Returns how
  // many (0 when empty); `data` points at them until the next push or consume.
  size_t front(const uint8_t*& data) const;

  // Drops the oldest `count` bytes (what the port took). More than size() empties it.
  void consume(size_t count);

  // Empties the ring: the computer went away, and what is queued is for nobody.
  void clear();

  size_t size() const { return size_; }
  size_t room() const { return kCapacity - size_; }
  bool empty() const { return size_ == 0; }

 private:
  uint8_t bytes_[kCapacity] = {0};
  size_t head_ = 0;  // where the oldest byte is
  size_t size_ = 0;
};

}  // namespace pet
