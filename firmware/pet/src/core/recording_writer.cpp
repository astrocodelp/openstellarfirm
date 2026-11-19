#include "recording_writer.h"

#include <algorithm>

namespace pet {

bool RecordingWriter::begin(uint8_t* buffer, size_t bytes) {
  buffer_ = nullptr;
  samples_ = 0;
  blocks_ = 0;
  inBlock_ = 0;
  peak_ = 0;
  state_ = AdpcmState{};
  limit_ = recordingSamplesFor(bytes);
  maxBlocks_ = recordingBlocksFor(limit_);
  if (buffer == nullptr || limit_ == 0) {
    limit_ = 0;
    maxBlocks_ = 0;
    return false;
  }
  buffer_ = buffer;
  return true;
}

void RecordingWriter::flushBlock() {
  if (inBlock_ == 0 || buffer_ == nullptr || blocks_ >= maxBlocks_) {
    inBlock_ = 0;
    return;
  }
  uint8_t* out = buffer_ + kImaWavHeaderBytes + static_cast<size_t>(blocks_) * PET_ADPCM_BLOCK_ALIGN;
  adpcmEncodeBlock(block_, inBlock_, state_, out, PET_ADPCM_BLOCK_ALIGN);
  ++blocks_;
  inBlock_ = 0;
}

size_t RecordingWriter::push(const int16_t* samples, size_t count) {
  if (buffer_ == nullptr || samples == nullptr) {
    return 0;
  }
  size_t taken = 0;
  while (taken < count && samples_ < limit_) {
    const int16_t sample = samples[taken];
    const uint16_t magnitude = static_cast<uint16_t>(sample < 0 ? -static_cast<int32_t>(sample) : sample);
    peak_ = std::max(peak_, magnitude);
    block_[inBlock_++] = sample;
    ++samples_;
    ++taken;
    if (inBlock_ == PET_ADPCM_SAMPLES_PER_BLOCK) {
      flushBlock();
    }
  }
  return taken;
}

size_t RecordingWriter::finish() {
  if (buffer_ == nullptr) {
    return 0;
  }
  uint8_t* buffer = buffer_;
  flushBlock();  // the last, partly filled block (zero padded by the encoder)
  const uint32_t samples = samples_;
  const uint32_t blocks = blocks_;
  buffer_ = nullptr;
  if (samples == 0 || blocks == 0) {
    return 0;
  }
  const size_t dataBytes = static_cast<size_t>(blocks) * PET_ADPCM_BLOCK_ALIGN;
  writeImaWavHeader(buffer, PET_UP_SAMPLE_RATE, samples, static_cast<uint32_t>(dataBytes), PET_ADPCM_BLOCK_ALIGN);
  return kImaWavHeaderBytes + dataBytes;
}

}  // namespace pet
