#pragma once

// Voice activity detection for the listening rule (rule 4 in docs/desk-pets-plan.md):
// the pet starts listening on a hold of the lime light, and stops when the owner has
// been silent for PET_SILENCE_END_SECONDS, or when nothing was said at all in the
// first PET_SILENCE_END_SECONDS. This module only measures; PetApp decides.
//
// It is pure (no hardware, no clock): the microphone task feeds it the samples it
// has already filtered (16 kHz mono PCM16, DC removed) in any chunking, and the
// main loop reads two numbers from it.
//
//   speechStarted()  true once real speech began in this recording (latched until
//                    reset(), so a pause never un-starts it)
//   silenceMs()      milliseconds since the last speech frame, in whole frames; before
//                    any speech it counts from the first frame, that is, the length of
//                    the recording so far
//
// How it decides, 20 ms at a time:
//
//   * the energy of a frame is its RMS;
//   * the noise floor is the RMS of the room, followed only while the frame is silent
//     (never during speech or its hangover), falling quickly and rising slowly;
//   * a frame is loud when its RMS is above max(noise * kVadNoiseRatio,
//     kVadAbsoluteFloorRms);
//   * a speech frame is a loud frame or one of the kVadHangoverFrames after it, so the
//     small dips inside a word do not count as silence;
//   * speech has started once kVadOnsetFrames loud frames came in a row, so a click or
//     a knock on the desk is not speech.
//
// TUNING: every threshold below is a first guess from the microphone's measured noise
// (peaks of about 25 with nothing said, about 125 for quiet speech, kMinRecordingPeak
// in audio_dsp.h) and has not been tried on a real pet. They need tuning on hardware
// before the first unit is given to anyone: too high and a quiet speaker is cut off or
// dropped as "didn't catch", too low and a noisy room never lets the pet stop (the
// 120 second cap still does).

#include <cstddef>
#include <cstdint>

#include "generated/protocol.h"

namespace pet {

// One frame is 20 ms of the uplink rate: 320 samples.
constexpr uint32_t kVadFrameMs = 20;
constexpr uint32_t kVadFrameSamples = static_cast<uint32_t>(PET_UP_SAMPLE_RATE) / 1000u * kVadFrameMs;
static_assert(kVadFrameSamples * 1000u == static_cast<uint32_t>(PET_UP_SAMPLE_RATE) * kVadFrameMs,
              "a frame is a whole number of samples");

// TUNING (see above). RMS values are in PCM16 units, 0..32767.
constexpr uint32_t kVadAbsoluteFloorRms = 30;   // never call anything under this speech, however quiet the room
constexpr uint32_t kVadNoiseRatio = 3;          // speech is this many times the room's noise
constexpr uint32_t kVadHangoverFrames = 6;      // 120 ms of speech after the last loud frame
constexpr uint32_t kVadOnsetFrames = 3;         // 60 ms of loud frames in a row start the speech
constexpr uint32_t kVadInitialNoiseMaxRms = 150;  // the first frame sets the floor, but never above this

// The silence that ends a recording, in frames. PetApp compares silenceMs() with
// PET_SILENCE_END_SECONDS; this is the same number as a frame count.
constexpr uint32_t kVadSilenceEndFrames = static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u / kVadFrameMs;

class Vad {
 public:
  // Forgets everything: the start of a recording.
  void reset();

  // Takes samples in any number; a frame is judged each time 320 have come in.
  void feed(const int16_t* samples, size_t count);

  bool speechStarted() const { return speechStarted_; }
  // Milliseconds since the last speech frame (whole frames of kVadFrameMs).
  uint32_t silenceMs() const;
  // True when the last whole frame was speech (loud, or inside the hangover).
  bool speaking() const { return speaking_; }

  // For tests and the log: the room's noise (RMS, whole units), the RMS of the last
  // whole frame, and how many whole frames were judged.
  uint32_t noiseRms() const { return noiseQ4_ >> 4; }
  uint32_t lastRms() const { return lastRms_; }
  uint32_t frames() const { return frames_; }

 private:
  void judge(uint32_t rms);

  // The sum of squares of the samples of the frame being filled.
  uint64_t sumSquares_ = 0;
  uint32_t inFrame_ = 0;

  uint32_t frames_ = 0;
  uint32_t lastRms_ = 0;
  // The room's noise, RMS times 16 so it can move slowly with whole numbers.
  uint32_t noiseQ4_ = 0;
  uint32_t loudRun_ = 0;
  uint32_t hangover_ = 0;
  uint32_t silentFrames_ = 0;
  bool speaking_ = false;
  bool speechStarted_ = false;
};

// The integer square root, rounded down. Public because the tests check it.
uint32_t isqrt64(uint64_t value);

}  // namespace pet
