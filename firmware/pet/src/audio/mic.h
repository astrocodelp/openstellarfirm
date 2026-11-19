#pragma once

#include <driver/i2s_std.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <atomic>
#include <cstddef>
#include <cstdint>

#include "core/adpcm.h"
#include "core/audio_dsp.h"
#include "core/recording_plan.h"
#include "core/recording_writer.h"
#include "core/vad.h"
#include "generated/protocol.h"

namespace pet {

// A finished recording: the WAV file as it is uploaded or saved (the 60-byte IMA
// header, then the ADPCM blocks), in PSRAM. At most 966,716 bytes (120 seconds). It
// stays valid until the slot is started again; the caller (main.cpp) keeps a count of
// who still uses a slot.
struct Recording {
  int slot = -1;                 // -1: there is no recording
  const uint8_t* wav = nullptr;
  size_t bytes = 0;
  uint32_t samples = 0;          // the real samples, at the uplink rate
  uint16_t peak = 0;             // the loudest sample, 0..32767 (a dead-quiet recording is not worth keeping)
  bool valid() const { return slot >= 0 && wav != nullptr && bytes > 0; }
};

// The microphone (INMP441 or ICS-43434) over I2S, 16 kHz mono, encoded to IMA-ADPCM
// as it arrives, block by block, straight into the slot (core/recording_writer.h): two
// minutes of speech take about 0.97 MB, where PCM16 would take 3.84 MB (two slots of
// that would use nearly all of the pet's PSRAM).
//
// Rule 4 of docs/desk-pets-plan.md lives here:
//   * the I2S receiver runs only between start() and stop(), and pump() reads
//     only then; the state machine calls start() only after the owner's hold of the
//     lime light, and stop() when the recording ends (silence, a tap, the cap).
//     The receive channel is made once, in begin(), and left disabled: start()
//     enables it and stop() disables it. (Making it in start() would allocate while
//     the other tasks run, which hw/internal_alloc.h cannot do safely.);
//   * start() refuses when the MIC switch is off;
//   * the indicator (the lime light) is switched ON BEFORE the receiver starts
//     and OFF AFTER it has stopped, so the light is never behind the microphone;
//   * the slot keeps at most the 120 seconds the protocol allows (the state machine
//     ends the recording at that cap too, and sooner on silence).
//
// While it records, a voice activity detector (core/vad.h) listens to the same samples.
// The main loop reads what it heard (heard()) and gives it to the state machine, which
// decides when to stop; nothing here ends a recording by itself.
//
// Two slots, so a note that is still being saved or uploaded does not stop the
// next recording. The caller says which slot is free. A unit with less PSRAM free than
// two slots need and a reserve makes one slot (core/recording_plan.h).
class Mic {
 public:
  static constexpr int kSlots = 2;
  using IndicatorFn = void (*)(bool on, void* context);

  Mic();
  ~Mic();
  Mic(const Mic&) = delete;
  Mic& operator=(const Mic&) = delete;

  // Allocates the recording slots (one or two of about 0.97 MB in PSRAM, by what
  // PSRAM is free; a much shorter recording limit if only internal RAM is left) and
  // makes the I2S receive channel, disabled. False if either failed. Call it in
  // setup(), before the other tasks start.
  bool begin();

  // The lime light: called with true before the microphone starts and with false
  // after it stopped.
  void setIndicator(IndicatorFn fn, void* context);

  // Starts recording into `slot`. False when the MIC switch is off, the slot is
  // not usable, or the receiver would not start; nothing is recording then.
  bool start(int slot);

  // Ends the recording (the receiver is off when this returns) and returns it.
  // Not valid if nothing was recording or it holds no audio.
  Recording stop();

  // True exactly while the receiver runs.
  bool recording() const { return recording_.load(std::memory_order_acquire); }

  // Reads what the microphone has delivered and encodes it. Returns true when it
  // did work. The audio task calls this in a loop while recording() is true.
  bool pump();

  // Samples recorded so far in the current recording.
  uint32_t samplesSoFar() const { return samples_.load(std::memory_order_relaxed); }

  // What the voice detector has heard in the current recording, for the state
  // machine's Voice event (read from the main loop, written by the audio task).
  struct Heard {
    bool speechStarted = false;  // real speech began (latched)
    uint32_t silenceMs = 0;      // since the last speech frame
    bool full = false;           // the slot holds all it can: nothing more is kept
  };
  Heard heard() const;

  // The recording limit of this device's buffers, in samples: at most the 120
  // seconds the protocol takes, fewer on a unit with no PSRAM.
  uint32_t capacitySamples() const { return storeLimitSamples_; }

  // True when this slot has a buffer. A unit with no PSRAM has one internal
  // buffer, and a unit that got only one of the two PSRAM buffers has one slot;
  // the caller must not pick the other one.
  bool slotUsable(int slot) const { return slot >= 0 && slot < kSlots && buffers_[slot] != nullptr; }

  // The MIC slide switch reads on (HIGH). The pin is read by hw/power.cpp; the
  // mic repeats the check itself so it never depends on its caller.
  static bool switchOn();

 private:
  void publishHeard();

  i2s_chan_handle_t rx_ = nullptr;  // made in begin(), enabled only while recording
  SemaphoreHandle_t mutex_ = nullptr;
  IndicatorFn indicator_ = nullptr;
  void* indicatorContext_ = nullptr;

  uint8_t* buffers_[kSlots] = {nullptr, nullptr};
  size_t bufferBytes_ = 0;
  uint32_t storeLimitSamples_ = 0;  // what a slot keeps: at most 120 s, so the server never says too long

  std::atomic<bool> recording_{false};
  std::atomic<uint32_t> samples_{0};
  std::atomic<bool> speechStarted_{false};
  std::atomic<uint32_t> silenceMs_{0};
  std::atomic<bool> full_{false};
  int slot_ = -1;
  uint32_t discard_ = 0;  // samples still to throw away after the start (the mic wakes up with a pop)
  RecordingWriter writer_;
  Vad vad_;
  DcBlocker dc_;
  int32_t raw_[256] = {};
  int16_t pcm_[256] = {};
};

}  // namespace pet
