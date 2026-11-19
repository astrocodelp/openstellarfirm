#pragma once

// Where bytes come from when the hardware layer needs them in pieces: a
// recording in memory, a saved note on flash, a voice pack on flash or the
// boot pack compiled into the firmware. The HTTP client uploads from one, the
// voice pack reader plays from one, and the tests use the memory one.
//
// read() may return fewer bytes than asked (the end of the data, or a short
// read from the file system); 0 means nothing is left at that offset.

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>

#include "note_queue.h"

namespace pet {

class ByteSource {
 public:
  virtual ~ByteSource() = default;
  virtual size_t size() const = 0;
  virtual size_t read(size_t offset, uint8_t* out, size_t len) = 0;
};

// Bytes that already sit in memory (a recording in PSRAM, a table built in a
// test, the boot pack in flash, which the CPU reads like memory).
class MemorySource : public ByteSource {
 public:
  MemorySource(const uint8_t* data, size_t size) : data_(data), size_(size) {}

  size_t size() const override { return size_; }

  size_t read(size_t offset, uint8_t* out, size_t len) override {
    if (data_ == nullptr || out == nullptr || offset >= size_) {
      return 0;
    }
    const size_t n = std::min(len, size_ - offset);
    std::memcpy(out, data_ + offset, n);
    return n;
  }

 private:
  const uint8_t* data_;
  size_t size_;
};

// A saved note's audio, read through the note store without loading it whole.
class NoteSource : public ByteSource {
 public:
  NoteSource(NoteStore& store, std::string name, size_t size) : store_(store), name_(std::move(name)), size_(size) {}

  size_t size() const override { return size_; }

  size_t read(size_t offset, uint8_t* out, size_t len) override {
    if (out == nullptr || offset >= size_) {
      return 0;
    }
    return store_.readNote(name_, offset, out, std::min(len, size_ - offset));
  }

 private:
  NoteStore& store_;
  std::string name_;
  size_t size_;
};

}  // namespace pet
