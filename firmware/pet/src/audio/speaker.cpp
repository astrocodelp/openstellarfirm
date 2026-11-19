#include "audio/speaker.h"

#include <Arduino.h>
#include <esp_heap_caps.h>
#include <freertos/task.h>

#include <algorithm>
#include <cmath>
#include <cstring>

#include "core/audio_dsp.h"
#include "hw/internal_alloc.h"
#include "pins.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

namespace pet {

namespace {

// A power of two, so an index is a mask. 131072 samples of 16 bits are 256 KB of
// PSRAM: about six seconds, far more than the jitter head start needs.
constexpr uint32_t kRingSamples = 131072;
// Without PSRAM (a wrong board setting, say) the pet still speaks, from 32 KB.
constexpr uint32_t kFallbackRingSamples = 16384;
// What the I2S driver may still hold when a stream ends or is stopped: its six
// DMA buffers of 240 frames. Silence of this length pushes the old audio out.
constexpr size_t kDmaFlushSamples = 1600;
// Silence written before the amplifier is switched off, so the last word is not
// cut and the output ends on zero.
constexpr uint32_t kTailSilenceMs = 120;
// While the producer is slower than playback the output is fed silence in pieces
// this long.
constexpr size_t kHoldSamples = 256;

}  // namespace

Speaker::Speaker() = default;

Speaker::~Speaker() {
  if (ring_ != nullptr) {
    heap_caps_free(ring_);
  }
}

bool Speaker::begin(uint32_t sampleRate) {
  if (began_) {
    return true;
  }
  sampleRate_ = sampleRate;
  startSamples_ = jitterStartBytes() / 2;
  mutex_ = xSemaphoreCreateMutex();

  // The amplifier stays off until there is sound (SD low: shut down).
  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);

  capacity_ = kRingSamples;
  ring_ = static_cast<int16_t*>(heap_caps_malloc(capacity_ * sizeof(int16_t), MALLOC_CAP_SPIRAM));
  if (ring_ == nullptr) {
    capacity_ = kFallbackRingSamples;
    ring_ = static_cast<int16_t*>(heap_caps_malloc(capacity_ * sizeof(int16_t), MALLOC_CAP_8BIT));
  }
  if (ring_ == nullptr || mutex_ == nullptr) {
    return false;
  }

  // Mono audio goes out as stereo frames with the same sample on both sides: the
  // MAX98357A mixes (left + right) / 2, so this is full level whatever its
  // channel-select strapping is.
  i2s_.setPins(PIN_AMP_BCLK, PIN_AMP_LRCLK, PIN_AMP_DIN);
  // Inside withPsramHeld: the driver's channel object must be in internal RAM
  // (hw/internal_alloc.h). Call begin() in setup(), before the other tasks start.
  const bool i2sOk = withPsramHeld([&]() {
    return i2s_.begin(I2S_MODE_STD, sampleRate, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  });
  if (!i2sOk) {
    return false;
  }
  began_ = true;
  return true;
}

void Speaker::notifyDrained(PlayTag tag) {
  if (drained_ != nullptr) {
    drained_(tag, drainedContext_);
  }
}

void Speaker::setVolume(float volume01) { gainQ8_.store(volumeGainQ8(volume01), std::memory_order_relaxed); }

void Speaker::onDrained(DrainedFn fn, void* context) {
  drained_ = fn;
  drainedContext_ = context;
}

uint32_t Speaker::open(PlayTag tag) {
  if (!began_) {
    return 0;  // stream 0 is never current, so a feed() on it fails
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  const uint32_t gen = openLocked(tag);
  xSemaphoreGive(mutex_);
  return gen;
}

uint32_t Speaker::open(PlayTag tag, uint32_t epoch) {
  if (!began_) {
    return 0;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  // abort() bumps the epoch under this same lock, so the check and the opening
  // cannot be split by it.
  const uint32_t gen = epoch == epoch_.load(std::memory_order_acquire) ? openLocked(tag) : 0;
  xSemaphoreGive(mutex_);
  return gen;
}

// With the mutex held.
uint32_t Speaker::openLocked(PlayTag tag) {
  uint32_t gen = generation_.load() + 1;
  if (gen == 0) {
    gen = 1;
  }
  generation_.store(gen);
  tag_ = tag;
  open_ = true;
  closed_ = false;
  started_ = false;
  tail_ = head_;  // whatever the older stream had left is dropped
  busy_.store(true, std::memory_order_release);
  return gen;
}

size_t Speaker::room() const {
  // A racy read is fine: a producer only uses it to decide whether to wait.
  return capacity_ - static_cast<size_t>(head_ - tail_);
}

bool Speaker::feed(uint32_t stream, const int16_t* samples, size_t count, uint32_t timeoutMs) {
  if (!began_ || samples == nullptr) {
    return false;
  }
  const uint32_t startedAt = millis();
  const uint32_t mask = capacity_ - 1;
  size_t done = 0;
  while (done < count) {
    xSemaphoreTake(mutex_, portMAX_DELAY);
    if (stream != generation_.load() || !open_) {
      xSemaphoreGive(mutex_);
      return false;
    }
    const size_t freeSamples = capacity_ - availableLocked();
    const size_t n = std::min(freeSamples, count - done);
    for (size_t i = 0; i < n; ++i) {
      ring_[(head_ + static_cast<uint32_t>(i)) & mask] = samples[done + i];
    }
    head_ += static_cast<uint32_t>(n);
    xSemaphoreGive(mutex_);
    done += n;
    if (done < count) {
      if (static_cast<uint32_t>(millis() - startedAt) >= timeoutMs) {
        return false;
      }
      vTaskDelay(pdMS_TO_TICKS(5));
    }
  }
  return true;
}

void Speaker::close(uint32_t stream) {
  if (!began_) {
    return;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  if (stream == generation_.load() && open_) {
    open_ = false;
    closed_ = true;
  }
  xSemaphoreGive(mutex_);
}

void Speaker::abort() {
  if (!began_) {
    return;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  generation_.store(generation_.load() + 1);  // every producer's next feed() fails
  epoch_.fetch_add(1, std::memory_order_release);  // and no producer that is not streaming yet may start
  open_ = false;
  closed_ = false;
  started_ = false;
  tail_ = head_;
  busy_.store(false, std::memory_order_release);
  xSemaphoreGive(mutex_);
  level_.store(0, std::memory_order_relaxed);
  // The I2S driver may still hold up to a tenth of a second of the old audio;
  // the next stream flushes it before the amplifier comes on.
  dirty_.store(true, std::memory_order_relaxed);
  ampOff();
}

bool Speaker::ampOn(uint32_t gen) {
  if (ampIsOn_.load()) {
    return true;
  }
  if (dirty_.exchange(false)) {
    writeSilence(kDmaFlushSamples);  // with the amplifier still off; it yields
  }
  // abort() may have run while that wrote. Then this stream is gone and the
  // amplifier stays off (it would otherwise be left on, with nothing to stop it,
  // for as long as the microphone records). The check and the pin change are one
  // step under the lock abort() takes, so abort() either ran before it (the stream
  // is gone) or runs after it and switches the amplifier off itself.
  bool still = false;
  xSemaphoreTake(mutex_, portMAX_DELAY);
  if (gen == generation_.load()) {
    digitalWrite(PIN_AMP_SD, HIGH);
    ampIsOn_.store(true);
    still = true;
  }
  xSemaphoreGive(mutex_);
  if (!still) {
    dirty_.store(true, std::memory_order_relaxed);  // the I2S buffers hold old audio
    return false;
  }
  delay(5);  // the amplifier takes a few milliseconds to wake
  return true;
}

void Speaker::quiet() {
  if (ampIsOn_.load()) {
    ampOff();
    dirty_.store(true, std::memory_order_relaxed);
  }
}

void Speaker::ampOff() {
  digitalWrite(PIN_AMP_SD, LOW);
  ampIsOn_.store(false);
}

void Speaker::writeSilence(size_t samples) {
  std::memset(stereo_, 0, sizeof(stereo_));
  while (samples > 0) {
    const size_t n = std::min(samples, kChunkSamples);
    i2s_.write(reinterpret_cast<const uint8_t*>(stereo_), n * 2 * sizeof(int16_t));
    samples -= n;
  }
}

bool Speaker::pump() {
  if (!began_) {
    return false;
  }
  if (!busy_.load(std::memory_order_acquire)) {
    // Idle. If the amplifier is still on (a stream was stopped), push the old
    // audio out and switch it off, so nothing loops in the speaker.
    if (ampIsOn_.load()) {
      writeSilence(kDmaFlushSamples);
      ampOff();
      return true;
    }
    return false;
  }

  enum class Step { Wait, Play, Hold, Finish } step = Step::Wait;
  uint32_t gen = 0;
  PlayTag tag = PlayTag::Line;
  size_t n = 0;

  xSemaphoreTake(mutex_, portMAX_DELAY);
  gen = generation_.load();
  tag = tag_;
  const size_t avail = availableLocked();
  if (!started_ && (avail >= startSamples_ || closed_)) {
    started_ = true;
  }
  if (started_) {
    if (avail > 0) {
      n = std::min(avail, kChunkSamples);
      const uint32_t mask = capacity_ - 1;
      for (size_t i = 0; i < n; ++i) {
        mono_[i] = ring_[(tail_ + static_cast<uint32_t>(i)) & mask];
      }
      tail_ += static_cast<uint32_t>(n);
      step = Step::Play;
    } else if (closed_) {
      step = Step::Finish;
    } else {
      // The producer is behind the speaker: buffer again before going on.
      started_ = false;
      step = Step::Hold;
    }
  } else {
    step = Step::Hold;
  }
  xSemaphoreGive(mutex_);

  switch (step) {
    case Step::Wait:
      return false;

    case Step::Hold:
      // Before the first sound there is nothing to say. While re-buffering in the
      // middle of a stream the output must not be left to repeat itself.
      if (ampIsOn_.load()) {
        writeSilence(kHoldSamples);
        return true;
      }
      return false;

    case Step::Play: {
      if (gen != generation_.load()) {
        return true;  // stopped while the piece was being taken: drop it
      }
      if (!ampOn(gen)) {
        return true;  // stopped while the amplifier was getting ready
      }
      const uint16_t gain = gainQ8_.load(std::memory_order_relaxed);
      int32_t peak = 0;
      for (size_t i = 0; i < n; ++i) {
        const int16_t s = applyGainQ8(mono_[i], gain);
        stereo_[2 * i] = s;
        stereo_[2 * i + 1] = s;
        const int32_t magnitude = s < 0 ? -static_cast<int32_t>(s) : s;
        peak = std::max(peak, magnitude);
      }
      const uint8_t now = static_cast<uint8_t>(std::min<int32_t>(255, peak >> 7));
      const uint8_t before = level_.load(std::memory_order_relaxed);
      level_.store(std::max<uint8_t>(now, static_cast<uint8_t>(before - before / 4)), std::memory_order_relaxed);
#ifdef PET_DEVBOARD
      // No amplifier: the laptop plays a copy. The I2S write below still keeps the time.
      for (size_t i = 0; i < n; ++i) {
        mono_[i] = stereo_[2 * i];
      }
      devboard::speakerTee(mono_, n);
#endif
      i2s_.write(reinterpret_cast<const uint8_t*>(stereo_), n * 2 * sizeof(int16_t));
      return true;
    }

    case Step::Finish: {
      if (ampIsOn_.load()) {
        writeSilence(static_cast<size_t>(sampleRate_) * kTailSilenceMs / 1000);
      }
      bool same = false;
      xSemaphoreTake(mutex_, portMAX_DELAY);
      if (gen == generation_.load()) {
        same = true;
        busy_.store(false, std::memory_order_release);
        started_ = false;
        closed_ = false;
      }
      xSemaphoreGive(mutex_);
      if (!same) {
        return true;  // a new stream took over during the tail: leave the amplifier on for it
      }
      ampOff();
      level_.store(0, std::memory_order_relaxed);
      if (drained_ != nullptr) {
        drained_(tag, drainedContext_);
      }
      return true;
    }
  }
  return false;
}

void Speaker::playBlocking(const int16_t* samples, size_t count) {
  const uint32_t stream = open(PlayTag::Line);
  size_t done = 0;
  while (done < count) {
    const size_t n = std::min(room(), count - done);
    if (n == 0) {
      pump();
      continue;
    }
    if (!feed(stream, samples + done, n, 100)) {
      return;
    }
    done += n;
  }
  close(stream);
  while (busy()) {
    if (!pump()) {
      vTaskDelay(1);
    }
  }
}

void Speaker::playToneBlocking(uint16_t hz, uint32_t ms) {
  const size_t total = static_cast<size_t>(sampleRate_) * ms / 1000;
  const uint32_t stream = open(PlayTag::Line);
  int16_t piece[256];
  size_t done = 0;
  while (done < total) {
    const size_t n = std::min(sizeof(piece) / sizeof(piece[0]), total - done);
    for (size_t i = 0; i < n; ++i) {
      const float t = static_cast<float>(done + i) / static_cast<float>(sampleRate_);
      piece[i] = static_cast<int16_t>(12000.0f * std::sin(6.2831853f * static_cast<float>(hz) * t));
    }
    size_t fed = 0;
    while (fed < n) {
      const size_t m = std::min(room(), n - fed);
      if (m == 0) {
        pump();
        continue;
      }
      if (!feed(stream, piece + fed, m, 100)) {
        return;
      }
      fed += m;
    }
    done += n;
  }
  close(stream);
  while (busy()) {
    if (!pump()) {
      vTaskDelay(1);
    }
  }
}

}  // namespace pet
