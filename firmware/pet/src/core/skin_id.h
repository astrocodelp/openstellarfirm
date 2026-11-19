#pragma once

// Which figure stands on the pad. The figure's chest module has one resistor
// from the skin connector's pin 5 to ground; the core board pulls the pin up
// with 10 k, so the pin reads a different voltage for each figure:
//
//   Nova  (10 k)  about 1.65 V     Zib (22 k) about 2.27 V
//   Comet (47 k)  about 2.72 V     no figure  3.3 V
//
// The bands are the midpoints between those readings.

#include "generated/protocol.h"

namespace pet {

// A figure, or none (no figure, or a reading that makes no sense).
struct PetKindOrNone {
  bool present = false;
  PetKind kind = PET_DEFAULT_KIND;

  static PetKindOrNone none() { return PetKindOrNone{}; }
  static PetKindOrNone of(PetKind k) {
    PetKindOrNone r;
    r.present = true;
    r.kind = k;
    return r;
  }
  bool operator==(const PetKindOrNone& o) const { return present == o.present && (!present || kind == o.kind); }
  bool operator!=(const PetKindOrNone& o) const { return !(*this == o); }
};

// Below 1200 mV is a fault (a shorted pin), not a figure. 1200..1959 Nova,
// 1960..2494 Zib, 2495..3000 Comet, above 3000 none.
PetKindOrNone skinFromMillivolts(int mv);

// The figure to behave as: the one found, else the default (Nova), so a pad
// with no figure still has a name, a voice and a light.
PetKind kindOrDefault(PetKindOrNone skin);

// What the heartbeat's `skin` field says: "astronaut", "alien", "cat" or "none".
const char* skinWireName(PetKindOrNone skin);

}  // namespace pet
