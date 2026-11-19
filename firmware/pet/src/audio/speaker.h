#pragma once

#include <ESP_I2S.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <atomic>
#include <cstddef>
#include <cstdint>

#include "config.h"

namespace pet {

// What a stream of audio is for. When a stream finishes playing, the speaker
// reports its tag, so the state machine hears ReplyEnded when the answer has been
// spoken and NoticeShown when a notice has.
enum class PlayTag : uint8_t { Line, Reply, Notice };

// The amplifier (MAX98357A) over I2S: one stream at a time of 16-bit mono PCM at
// the downlink rate (22050 Hz), through a jitter buffer in PSRAM.
//
//   uint32_t stream = speaker.open(PlayTag::Reply);
//   while (more) { if (!speaker.feed(stream, pcm, count)) break; }   // false: replaced or stopped
//   speaker.close(stream);                                            // plays to the end, then onDrained
//
// A producer calls open/feed/close from any task; the audio task (or, in
// bring-up, the caller) calls pump() in a loop to move audio to the I2S driver.
// Opening a stream while another is open replaces it: the older producer's next
// feed() returns false and it stops. abort() drops everything without a report.
//
// Playback starts when about PET_JITTER_START_MS of audio is buffered (or the
// stream is closed, for a short clip), applies the volume with integer scaling,
// and switches the amplifier on only while there is sound (PIN_AMP_SD): nothing
// hisses at rest, and a pet that is never spoken to draws no amp current.
class Speaker {
 public:
  using DrainedFn = void (*)(PlayTag tag, void* context);

  Speaker();
  ~Speaker();
  Speaker(const Speaker&) = delete;
  Speaker& operator=(const Speaker&) = delete;

  // Allocates the jitter buffer (PSRAM, falling back to a small one in internal
  // RAM) and starts the transmitter at `sampleRate`. False if either failed.
  bool begin(uint32_t sampleRate = PET_DOWN_SAMPLE_RATE);

  // 0..1, from the pet's settings. Applies to what is played from now on.
  void setVolume(float volume01);

  // Called from the audio task when a closed stream has played to its end.
  void onDrained(DrainedFn fn, void* context);

  // Starts a stream, replacing any other. Returns 0 when there is no speaker, or,
  // for the second form, when abort() has run since `epoch` was read (epoch()).
  uint32_t open(PlayTag tag);
  uint32_t open(PlayTag tag, uint32_t epoch);
  // Counts up each time abort() runs. A producer that is not streaming yet (its
  // answer has not started, or its request is still on the way) takes the number
  // when it is told to speak and opens with it: if the owner stopped the pet in the
  // meantime, the stream is refused and the late answer is never played.
  uint32_t epoch() const { return epoch_.load(std::memory_order_acquire); }
  // Appends mono PCM16 samples. Waits up to timeoutMs for room. Returns false
  // when `stream` is no longer the current one (replaced, stopped) or on timeout.
  bool feed(uint32_t stream, const int16_t* samples, size_t count, uint32_t timeoutMs = 3000);
  // Samples that fit right now without waiting.
  size_t room() const;
  // No more audio for this stream.
  void close(uint32_t stream);
  // Drops the current stream and its audio at once. No onDrained.
  void abort();

  // The amplifier off, for the audio task to call while the microphone records:
  // nothing may leave it on beside an open microphone. Does nothing when it is off.
  void quiet();

  // Reports `tag` as played to its end without playing anything. For a caller that
  // could not open a stream (no speaker): what waits for the end of the sound must
  // not wait for ever.
  void notifyDrained(PlayTag tag);

  // True while a stream is open or its tail is still playing.
  bool busy() const { return busy_.load(std::memory_order_acquire); }

  // Moves audio to the I2S driver. Returns true when it did something, so the
  // audio loop can go straight round again; false means idle (sleep a moment).
  bool pump();

  // 0..255, how loud the last piece was (for the lights).
  uint8_t level() const { return level_.load(std::memory_order_relaxed); }

  // Bring-up, where no audio task runs: these play from the calling task and
  // pump by themselves until the audio has been heard.
  void playToneBlocking(uint16_t hz, uint32_t ms);
  void playBlocking(const int16_t* samples, size_t count);

 private:
  size_t availableLocked() const { return static_cast<size_t>(head_ - tail_); }
  uint32_t openLocked(PlayTag tag);
  // Switches the amplifier on for stream `gen`, unless that stream was stopped
  // while the amplifier was being got ready. False when it was stopped.
  bool ampOn(uint32_t gen);
  void ampOff();
  void writeSilence(size_t samples);

  I2SClass i2s_;
  SemaphoreHandle_t mutex_ = nullptr;
  DrainedFn drained_ = nullptr;
  void* drainedContext_ = nullptr;

  int16_t* ring_ = nullptr;
  uint32_t capacity_ = 0;  // samples, a power of two
  uint32_t head_ = 0;      // total samples written, wraps at 2^32
  uint32_t tail_ = 0;      // total samples read

  uint32_t sampleRate_ = PET_DOWN_SAMPLE_RATE;
  std::atomic<uint32_t> generation_{0};  // the current stream (0: none yet)
  std::atomic<uint32_t> epoch_{0};       // bumped by abort()
  PlayTag tag_ = PlayTag::Line;
  bool open_ = false;     // the producer may still feed
  bool closed_ = false;   // the producer said it is done
  bool started_ = false;  // enough is buffered; playback has begun
  std::atomic<bool> ampIsOn_{false};
  std::atomic<bool> dirty_{false};  // an aborted stream left audio in the I2S buffers
  bool began_ = false;
  size_t startSamples_ = 0;

  // The audio task's scratch pieces (only pump() touches them).
  static constexpr size_t kChunkSamples = 512;
  int16_t mono_[kChunkSamples] = {};
  int16_t stereo_[kChunkSamples * 2] = {};

  std::atomic<uint16_t> gainQ8_{154};  // 0.6
  std::atomic<bool> busy_{false};
  std::atomic<uint8_t> level_{0};
};

}  // namespace pet
