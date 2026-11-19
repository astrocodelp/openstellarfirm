#include "line_queue.h"

namespace pet {

bool LineQueue::push(const uint8_t* bytes, size_t length) {
  if (bytes == nullptr || length == 0 || length > room()) {
    return false;
  }
  size_t at = (head_ + size_) % kCapacity;
  for (size_t i = 0; i < length; ++i) {
    bytes_[at] = bytes[i];
    at = (at + 1) % kCapacity;
  }
  size_ += length;
  return true;
}

size_t LineQueue::front(const uint8_t*& data) const {
  data = bytes_ + head_;
  const size_t untilWrap = kCapacity - head_;
  return size_ < untilWrap ? size_ : untilWrap;
}

void LineQueue::consume(size_t count) {
  if (count >= size_) {
    clear();
    return;
  }
  head_ = (head_ + count) % kCapacity;
  size_ -= count;
}

void LineQueue::clear() {
  head_ = 0;
  size_ = 0;
}

}  // namespace pet
