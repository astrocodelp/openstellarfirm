#include "audio_dsp.h"

namespace pet {

int16_t pcm16FromI2s32(int32_t slot) {
  const int32_t v = slot >> 14;
  if (v > 32767) {
    return 32767;
  }
  if (v < -32768) {
    return -32768;
  }
  return static_cast<int16_t>(v);
}

int16_t DcBlocker::process(int16_t x) {
  const float in = static_cast<float>(x);
  float y = in - x1_ + 0.995f * y1_;
  x1_ = in;
  y1_ = y;
  if (y > 32767.0f) {
    y = 32767.0f;
  } else if (y < -32768.0f) {
    y = -32768.0f;
  }
  // Truncation toward zero keeps a silent input silent after the filter settles.
  return static_cast<int16_t>(y);
}

uint16_t volumeGainQ8(float volume) {
  if (!(volume > 0.0f)) {
    return 0;
  }
  if (volume >= 1.0f) {
    return 256;
  }
  return static_cast<uint16_t>(volume * 256.0f + 0.5f);
}

int16_t applyGainQ8(int16_t sample, uint16_t gainQ8) {
  const int32_t v = (static_cast<int32_t>(sample) * static_cast<int32_t>(gainQ8)) >> 8;
  if (v > 32767) {
    return 32767;
  }
  if (v < -32768) {
    return -32768;
  }
  return static_cast<int16_t>(v);
}

void applyGainQ8(int16_t* samples, size_t count, uint16_t gainQ8) {
  for (size_t i = 0; i < count; ++i) {
    samples[i] = applyGainQ8(samples[i], gainQ8);
  }
}

}  // namespace pet
