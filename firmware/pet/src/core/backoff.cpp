#include "backoff.h"

namespace pet {

Backoff::Backoff(uint32_t baseMs, uint32_t maxMs) : baseMs_(baseMs == 0 ? 1 : baseMs), maxMs_(maxMs) {
  if (maxMs_ < baseMs_) {
    maxMs_ = baseMs_;
  }
}

uint32_t Backoff::peekNominalMs() const {
  // Doubling stops as soon as the cap is reached, so a long outage cannot
  // overflow the shift.
  uint64_t delay = baseMs_;
  for (uint32_t i = 0; i < attempts_ && delay < maxMs_; ++i) {
    delay *= 2;
  }
  return delay > maxMs_ ? maxMs_ : static_cast<uint32_t>(delay);
}

uint32_t Backoff::nextDelayMs(float jitter01) {
  const uint32_t nominal = peekNominalMs();
  if (attempts_ < 0xFFFFFFFFu) {
    ++attempts_;
  }
  if (jitter01 < 0.0f || jitter01 != jitter01) {
    jitter01 = 0.0f;
  }
  if (jitter01 > 1.0f) {
    jitter01 = 1.0f;
  }
  // Up to 20 percent off, in integer thousandths so the result is exact.
  const uint64_t cutThousandths = static_cast<uint64_t>(jitter01 * 200.0f);
  const uint32_t cut = static_cast<uint32_t>((static_cast<uint64_t>(nominal) * cutThousandths) / 1000);
  return nominal - cut;
}

}  // namespace pet
