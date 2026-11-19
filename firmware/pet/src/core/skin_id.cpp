#include "skin_id.h"

namespace pet {

PetKindOrNone skinFromMillivolts(int mv) {
  if (mv < 1200) {
    return PetKindOrNone::none();
  }
  if (mv < 1960) {
    return PetKindOrNone::of(PET_KIND_ASTRONAUT);
  }
  if (mv < 2495) {
    return PetKindOrNone::of(PET_KIND_ALIEN);
  }
  if (mv <= 3000) {
    return PetKindOrNone::of(PET_KIND_CAT);
  }
  return PetKindOrNone::none();
}

PetKind kindOrDefault(PetKindOrNone skin) { return skin.present ? skin.kind : PET_DEFAULT_KIND; }

const char* skinWireName(PetKindOrNone skin) { return skin.present ? PET_KIND_IDS[skin.kind] : "none"; }

}  // namespace pet
