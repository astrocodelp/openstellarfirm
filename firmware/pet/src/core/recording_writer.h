#pragma once

// A recording being written straight into its slot as IMA-ADPCM, block by block, as
// the microphone delivers samples (rule 4 and recording_plan.h explain why: two
// minutes of PCM16 would take 3.84 MB, four times the ADPCM, and two slots of it nearly
// all of the pet's PSRAM; two minutes of ADPCM is under 1 MB). The slot holds the WAV file as it will be uploaded or saved: a 60-byte
// header and the encoded blocks, nothing is converted or copied afterwards.
//
//   RecordingWriter w;
//   w.begin(slot, slotBytes);
//   while (recording) w.push(samples, n);     // n samples of 16 kHz mono PCM16
//   size_t bytes = w.finish();                // the file's length, 0 for no audio
//
// Pure: it touches only the buffer it is given, so the encoding is unit tested on the
// computer against the same vectors as the encoder, and the hardware side (audio/mic.cpp)
// only reads the microphone and calls push().

#include <cstddef>
#include <cstdint>

#include "adpcm.h"
#include "generated/protocol.h"
#include "recording_plan.h"
#include "wav.h"

namespace pet {

class RecordingWriter {
 public:
  // Starts a recording in `buffer` (`bytes` long, at least a header and one block). It
  // keeps what fits: whole blocks, at most PET_RECORD_MAX_SECONDS of audio and never a
  // file the server would refuse. False (and nothing is written) when the buffer is
  // null or too small.
  bool begin(uint8_t* buffer, size_t bytes);

  // Takes up to `count` samples and returns how many it kept: fewer than `count` when
  // the slot is full. The loudest absolute sample is tracked for peak().
  size_t push(const int16_t* samples, size_t count);

  // Ends the recording: the last, partly filled block is encoded (zero padded) and the
  // WAV header is written in front of the blocks. Returns the length of the file in
  // the buffer, or 0 when no audio was recorded. The writer is idle afterwards.
  size_t finish();

  bool active() const { return buffer_ != nullptr; }
  // The real samples kept so far.
  uint32_t samples() const { return samples_; }
  // How many samples the slot keeps in all.
  uint32_t limitSamples() const { return limit_; }
  // True when no more can be kept.
  bool full() const { return limit_ != 0 && samples_ >= limit_; }
  // The loudest sample kept, 0..32768 (a dead-quiet recording is not worth keeping).
  uint16_t peak() const { return peak_; }
  // The blocks written so far (the one being filled is not counted until it is full).
  uint32_t blocks() const { return blocks_; }

 private:
  void flushBlock();

  uint8_t* buffer_ = nullptr;
  uint32_t maxBlocks_ = 0;
  uint32_t limit_ = 0;
  uint32_t samples_ = 0;
  uint32_t blocks_ = 0;
  uint16_t inBlock_ = 0;
  uint16_t peak_ = 0;
  AdpcmState state_;
  int16_t block_[PET_ADPCM_SAMPLES_PER_BLOCK] = {};
};

}  // namespace pet
