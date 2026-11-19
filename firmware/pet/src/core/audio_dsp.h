#pragma once

// The small sample-by-sample pieces of the audio path that need no hardware, so
// they can be unit tested: the microphone's 32-bit slot to a 16-bit sample, a
// DC blocker, the speaker's volume and the size of the jitter buffer's head
// start. The I2S drivers (audio/mic.cpp, audio/speaker.cpp) call them.

#include <cstddef>
#include <cstdint>

#include "config.h"

namespace pet {

// An INMP441 or ICS-43434 gives 24-bit samples left-justified in a 32-bit I2S
// slot. Shifting right by 14 (not 16) keeps two bits of gain, which a desk
// microphone needs, and saturates at the 16-bit limits.
int16_t pcm16FromI2s32(int32_t slot);

// A one-pole high-pass filter, y = x - x1 + 0.995 * y1, that removes the
// microphone's DC offset so the ADPCM encoder does not waste its range on it.
class DcBlocker {
 public:
  // Filters one sample; the result saturates at the 16-bit limits.
  int16_t process(int16_t x);
  void reset() {
    x1_ = 0.0f;
    y1_ = 0.0f;
  }

 private:
  float x1_ = 0.0f;
  float y1_ = 0.0f;
};

// Volume 0..1 (from the pet's settings) as a gain in 1/256 steps: 0 is silent,
// 256 is unchanged. Values outside 0..1 are clamped. The speaker scales with
// integers, never floats, in its feeding loop.
uint16_t volumeGainQ8(float volume);

// One sample times a Q8 gain, saturated.
int16_t applyGainQ8(int16_t sample, uint16_t gainQ8);
void applyGainQ8(int16_t* samples, size_t count, uint16_t gainQ8);

// A recording shorter than this (0.3 seconds: a bump of the button, not speech)
// is not sent or saved; the pet says it did not catch it.
constexpr uint32_t kMinRecordingSamples = static_cast<uint32_t>(PET_UP_SAMPLE_RATE) * 3u / 10u;
constexpr bool recordingTooShort(uint32_t samples) { return samples < kMinRecordingSamples; }

// A recording whose loudest sample stays below this (about -54 dBFS, the noise
// floor of the microphone with nothing said) is dead air. A saved note like that is
// not kept: the server could only refuse it, and a refused note stays on the pet for
// good (rule 6), holding one of its 50 places. Ordinary speech peaks at several
// hundred, so this only catches a silent recording.
constexpr uint16_t kMinRecordingPeak = 64;
constexpr bool recordingTooQuiet(uint16_t peak) { return peak < kMinRecordingPeak; }

// How many bytes of a reply must be buffered before playback starts
// (PET_JITTER_START_MS of 16-bit mono at the downlink rate), kept to a whole
// number of samples.
constexpr size_t jitterStartBytes() {
  return (static_cast<size_t>(PET_DOWN_SAMPLE_RATE) * 2 * PET_JITTER_START_MS / 1000) & ~static_cast<size_t>(1);
}

}  // namespace pet
