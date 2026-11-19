#include "heartbeat.h"

namespace pet {

bool HeartbeatPolicy::due(const HeartbeatState& state, uint32_t nowMs) const {
  if (!ever_ || requested_) {
    return true;
  }
  const uint32_t since = static_cast<uint32_t>(nowMs - lastMs_);
  if (since >= periodMs_) {
    return true;
  }
  return state != last_ && since >= minGapMs_;
}

void HeartbeatPolicy::sent(const HeartbeatState& state, uint32_t nowMs) {
  ever_ = true;
  requested_ = false;
  lastMs_ = nowMs;
  last_ = state;
}

}  // namespace pet
