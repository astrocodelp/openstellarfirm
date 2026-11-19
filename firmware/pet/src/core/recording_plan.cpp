#include "recording_plan.h"

#include <algorithm>

namespace pet {

int recordingSlotsFor(size_t freePsramBytes) {
  if (freePsramBytes < kRecordSlotBytes) {
    return 0;
  }
  return freePsramBytes >= 2 * kRecordSlotBytes + kPsramReserveBytes ? 2 : 1;
}

uint32_t recordingBlocksFor(uint32_t samples) {
  return (samples + PET_ADPCM_SAMPLES_PER_BLOCK - 1) / PET_ADPCM_SAMPLES_PER_BLOCK;
}

uint32_t recordingSamplesFor(size_t bufferBytes) {
  const size_t usable = std::min<size_t>(bufferBytes, PET_UPLOAD_MAX_BYTES);
  if (usable < kImaWavHeaderBytes + PET_ADPCM_BLOCK_ALIGN) {
    return 0;
  }
  const size_t blocks = (usable - kImaWavHeaderBytes) / PET_ADPCM_BLOCK_ALIGN;
  const size_t samples = blocks * PET_ADPCM_SAMPLES_PER_BLOCK;
  return static_cast<uint32_t>(std::min<size_t>(samples, kRecordMaxSamples));
}

}  // namespace pet
