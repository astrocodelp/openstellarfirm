#pragma once

// When the pet tells OpenStellarFirm how it is (POST /api/pets/heartbeat): every
// five minutes, and sooner when something the owner sees in Settings changes: the
// battery moved to another band, the charger was plugged or unplugged, the
// number of saved notes changed, or the figure on the pad changed. Pure: the
// network task passes in what it knows and the time.

#include <cstdint>

#include "generated/protocol.h"

namespace pet {

struct HeartbeatState {
  uint8_t batteryBand = 0;  // batteryBand(): 0..4
  bool charging = false;
  uint8_t queue = 0;  // saved notes waiting
  int8_t skin = -1;   // the PetKind on the pad, or -1 for none

  bool operator==(const HeartbeatState& o) const {
    return batteryBand == o.batteryBand && charging == o.charging && queue == o.queue && skin == o.skin;
  }
  bool operator!=(const HeartbeatState& o) const { return !(*this == o); }
};

class HeartbeatPolicy {
 public:
  // `minGapMs` keeps a battery reading that wobbles on a band edge from sending
  // a heartbeat every second.
  explicit HeartbeatPolicy(uint32_t periodMs = static_cast<uint32_t>(PET_HEARTBEAT_SECONDS) * 1000u,
                           uint32_t minGapMs = 15000u)
      : periodMs_(periodMs), minGapMs_(minGapMs) {}

  // True when a heartbeat should go now: none was ever sent, one was asked for,
  // the period passed, or the state changed and the minimum gap is over.
  bool due(const HeartbeatState& state, uint32_t nowMs) const;

  // Call after a heartbeat was answered.
  void sent(const HeartbeatState& state, uint32_t nowMs);

  // Something (a settings notice, pairing) wants one at the next chance, gap or not.
  void request() { requested_ = true; }

 private:
  uint32_t periodMs_;
  uint32_t minGapMs_;
  bool ever_ = false;
  bool requested_ = false;
  uint32_t lastMs_ = 0;
  HeartbeatState last_;
};

}  // namespace pet
