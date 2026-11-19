#pragma once

// Retry delays after a failed call: 1 s, 2 s, 4 s, 8 s ... up to 300 s, then
// 300 s for as long as it keeps failing. The caller passes in a jitter fraction
// (0..1) from its own random source, so this stays deterministic and testable:
// the delay is cut by up to 20 percent of its nominal size, never lengthened,
// so the 300 s cap holds and many pets that lost the network together do not
// all come back in the same second. Jitter 0 gives the nominal delay exactly.

#include <cstdint>

namespace pet {

class Backoff {
 public:
  Backoff(uint32_t baseMs = 1000, uint32_t maxMs = 300000);

  // The delay to wait before the next try, then counts that try as made.
  // `jitter01` is clamped to 0..1.
  uint32_t nextDelayMs(float jitter01 = 0.0f);

  // The nominal (jitter-free) delay the next call to nextDelayMs would start from.
  uint32_t peekNominalMs() const;

  // A call worked: start again from the base delay.
  void reset() { attempts_ = 0; }

  uint32_t attempts() const { return attempts_; }

 private:
  uint32_t baseMs_;
  uint32_t maxMs_;
  uint32_t attempts_ = 0;
};

}  // namespace pet
