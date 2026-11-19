#include "vad.h"

#include <algorithm>

namespace pet {

namespace {

// Past this many silent frames the count stops, so silenceMs() cannot wrap.
constexpr uint32_t kMaxSilentFrames = 0xFFFFFFFFu / kVadFrameMs;

}  // namespace

uint32_t isqrt64(uint64_t value) {
  uint64_t result = 0;
  uint64_t bit = static_cast<uint64_t>(1) << 62;
  while (bit > value) {
    bit >>= 2;
  }
  while (bit != 0) {
    if (value >= result + bit) {
      value -= result + bit;
      result = (result >> 1) + bit;
    } else {
      result >>= 1;
    }
    bit >>= 2;
  }
  return static_cast<uint32_t>(result);
}

void Vad::reset() { *this = Vad(); }

uint32_t Vad::silenceMs() const { return silentFrames_ * kVadFrameMs; }

void Vad::feed(const int16_t* samples, size_t count) {
  if (samples == nullptr) {
    return;
  }
  for (size_t i = 0; i < count; ++i) {
    const int64_t s = samples[i];
    sumSquares_ += static_cast<uint64_t>(s * s);
    if (++inFrame_ == kVadFrameSamples) {
      judge(isqrt64(sumSquares_ / kVadFrameSamples));
      sumSquares_ = 0;
      inFrame_ = 0;
    }
  }
}

void Vad::judge(uint32_t rms) {
  lastRms_ = rms;
  if (frames_ == 0) {
    // The first frame is the first guess of the room's noise. If the owner is already
    // talking in it, it must not become the floor: speech would then look like noise.
    noiseQ4_ = std::min(rms, kVadInitialNoiseMaxRms) << 4;
  }
  if (frames_ < 0xFFFFFFFFu) {
    ++frames_;
  }

  const uint32_t threshold = std::max(noiseRms() * kVadNoiseRatio, kVadAbsoluteFloorRms);
  const bool loud = rms > threshold;

  bool inHangover = false;
  if (loud) {
    ++loudRun_;
    hangover_ = kVadHangoverFrames;
  } else {
    loudRun_ = 0;
    if (hangover_ > 0) {
      --hangover_;
      inHangover = true;
    }
  }
  if (loudRun_ >= kVadOnsetFrames) {
    speechStarted_ = true;
  }

  speaking_ = loud || inHangover;
  if (speaking_) {
    silentFrames_ = 0;
    return;
  }
  if (silentFrames_ < kMaxSilentFrames) {
    ++silentFrames_;
  }

  // The noise floor follows the room only while nothing is being said: down quickly
  // (a noisy moment is over), up slowly (a fan that came on), so that speech, which
  // is also loud, never raises it.
  const uint32_t target = rms << 4;
  if (target < noiseQ4_) {
    noiseQ4_ -= (noiseQ4_ - target + 3u) >> 2;
  } else {
    noiseQ4_ += (target - noiseQ4_) >> 6;
  }
}

}  // namespace pet
