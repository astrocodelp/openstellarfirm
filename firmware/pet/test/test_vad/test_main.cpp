// The voice activity detector (core/vad.h): 20 ms frames, RMS energy, an adaptive
// noise floor followed only while silent, a short hangover, and the two numbers the
// state machine reads (speechStarted, silenceMs). The signals are made here from a
// tone (speech stand-in) and a seeded hiss (room noise) at chosen RMS levels.
#include <unity.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <vector>

#include "core/vad.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

// A source of audio at chosen levels, with a phase and a noise generator that carry
// on from one call to the next, so a test can write a recording as a few lines.
class Source {
 public:
  explicit Source(uint32_t seed = 12345) : rng_(seed) {}

  // `ms` of a tone whose RMS is `rms` plus a hiss of `hissRms`, appended to `out`.
  void make(std::vector<int16_t>& out, uint32_t ms, double rms, double hissRms = 0.0) {
    const size_t n = static_cast<size_t>(ms) * PET_UP_SAMPLE_RATE / 1000;
    for (size_t i = 0; i < n; ++i) {
      double v = 0.0;
      if (rms > 0.0) {
        v += rms * std::sqrt(2.0) * std::sin(phase_);
      }
      if (hissRms > 0.0) {
        v += hissRms * std::sqrt(3.0) * (nextUnit() * 2.0 - 1.0);
      }
      phase_ += 2.0 * 3.14159265358979 * 440.0 / PET_UP_SAMPLE_RATE;
      if (phase_ > 2.0 * 3.14159265358979) {
        phase_ -= 2.0 * 3.14159265358979;
      }
      out.push_back(static_cast<int16_t>(std::lround(std::max(-32768.0, std::min(32767.0, v)))));
    }
  }

  // Room noise alone.
  void room(std::vector<int16_t>& out, uint32_t ms, double hissRms) { make(out, ms, 0.0, hissRms); }
  // Speech: a tone at `rms`, over a room of `hissRms`.
  void speech(std::vector<int16_t>& out, uint32_t ms, double rms, double hissRms = 0.0) { make(out, ms, rms, hissRms); }

 private:
  double nextUnit() {
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return static_cast<double>(rng_ % 100000u) / 100000.0;
  }
  uint32_t rng_;
  double phase_ = 0.0;
};

void feedAll(Vad& vad, const std::vector<int16_t>& audio) { vad.feed(audio.data(), audio.size()); }

}  // namespace

// -- The pieces ---------------------------------------------------------------------

void test_a_frame_is_twenty_milliseconds_and_five_seconds_is_250_frames() {
  TEST_ASSERT_EQUAL_UINT32(20, kVadFrameMs);
  TEST_ASSERT_EQUAL_UINT32(320, kVadFrameSamples);
  TEST_ASSERT_EQUAL_UINT32(250, kVadSilenceEndFrames);
  TEST_ASSERT_EQUAL_UINT32(5000, kVadSilenceEndFrames * kVadFrameMs);
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u, kVadSilenceEndFrames * kVadFrameMs);
}

void test_the_integer_square_root_is_exact() {
  for (uint64_t v = 0; v < 5000; ++v) {
    const uint64_t r = isqrt64(v);
    TEST_ASSERT_TRUE(r * r <= v);
    TEST_ASSERT_TRUE((r + 1) * (r + 1) > v);
  }
  // Around perfect squares and at the top of the range.
  const uint64_t big[] = {1000000ull, 999999ull, 1000001ull, 1073741824ull,       1073741823ull,
                          4294967295ull, 4294967296ull, 0xFFFFFFFFFFFFFFFFull, 0xFFFFFFFE00000001ull,
                          0xFFFFFFFE00000000ull};
  for (uint64_t v : big) {
    const unsigned __int128 r = isqrt64(v);
    TEST_ASSERT_TRUE(r * r <= v);
    TEST_ASSERT_TRUE((r + 1) * (r + 1) > v);
  }
  TEST_ASSERT_EQUAL_UINT32(4294967295u, isqrt64(0xFFFFFFFFFFFFFFFFull));
}

void test_a_whole_frame_is_needed_before_anything_is_judged() {
  Vad vad;
  std::vector<int16_t> audio(kVadFrameSamples - 1, 0);
  feedAll(vad, audio);
  TEST_ASSERT_EQUAL_UINT32(0, vad.frames());
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
  int16_t one = 0;
  vad.feed(&one, 1);
  TEST_ASSERT_EQUAL_UINT32(1, vad.frames());
  TEST_ASSERT_EQUAL_UINT32(20, vad.silenceMs());
}

void test_nothing_to_feed_is_fine() {
  Vad vad;
  vad.feed(nullptr, 100);
  int16_t x = 5;
  vad.feed(&x, 0);
  TEST_ASSERT_EQUAL_UINT32(0, vad.frames());
  TEST_ASSERT_FALSE(vad.speechStarted());
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
  TEST_ASSERT_FALSE(vad.speaking());
}

void test_the_rms_of_a_frame_is_measured() {
  Vad vad;
  std::vector<int16_t> audio(kVadFrameSamples, 1000);  // a constant: RMS 1000
  feedAll(vad, audio);
  TEST_ASSERT_EQUAL_UINT32(1000, vad.lastRms());
  Vad full;
  std::vector<int16_t> rail(kVadFrameSamples, -32768);  // the most negative sample squares without wrapping
  feedAll(full, rail);
  TEST_ASSERT_EQUAL_UINT32(32768, full.lastRms());
  Vad sine;
  Source src;
  std::vector<int16_t> tone;
  src.speech(tone, 20, 700.0);
  feedAll(sine, tone);
  TEST_ASSERT_INT_WITHIN(25, 700, sine.lastRms());
}

// -- Silence ------------------------------------------------------------------------

void test_digital_silence_is_never_speech_and_counts_up() {
  Vad vad;
  std::vector<int16_t> audio(PET_UP_SAMPLE_RATE, 0);  // a second
  for (int second = 1; second <= 10; ++second) {
    feedAll(vad, audio);
    TEST_ASSERT_FALSE(vad.speechStarted());
    TEST_ASSERT_FALSE(vad.speaking());
    TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(second) * 1000u, vad.silenceMs());
  }
}

void test_a_quiet_room_never_starts_speech_however_long() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 30000, 9.0);  // measured noise: a peak of about 25 is an RMS under 10
  feedAll(vad, audio);
  TEST_ASSERT_FALSE(vad.speechStarted());
  TEST_ASSERT_TRUE(vad.silenceMs() >= 29980);
  TEST_ASSERT_INT_WITHIN(3, 9, vad.noiseRms());
}

void test_a_recording_with_nothing_said_reports_no_speech_for_the_whole_five_seconds() {
  // This is what the state machine drops with "didn't catch".
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 5000, 12.0);
  feedAll(vad, audio);
  TEST_ASSERT_FALSE(vad.speechStarted());
  TEST_ASSERT_TRUE(vad.silenceMs() >= static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u - kVadFrameMs);
}

// -- Speech -------------------------------------------------------------------------

void test_speech_over_a_quiet_room_starts_after_three_loud_frames() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 1000, 9.0);
  feedAll(vad, audio);
  TEST_ASSERT_FALSE(vad.speechStarted());

  std::vector<int16_t> word;
  src.speech(word, 20, 400.0, 9.0);
  feedAll(vad, word);
  TEST_ASSERT_TRUE(vad.speaking());
  TEST_ASSERT_FALSE(vad.speechStarted());
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
  feedAll(vad, word);
  TEST_ASSERT_FALSE(vad.speechStarted());  // two frames: a knock, not a word
  feedAll(vad, word);
  TEST_ASSERT_TRUE(vad.speechStarted());  // the third
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
}

void test_a_knock_on_the_desk_is_not_speech() {
  for (uint32_t knockFrames = 1; knockFrames < kVadOnsetFrames; ++knockFrames) {
    Vad vad;
    Source src;
    std::vector<int16_t> audio;
    src.room(audio, 1000, 9.0);
    src.speech(audio, knockFrames * kVadFrameMs, 3000.0, 9.0);
    src.room(audio, 8000, 9.0);
    feedAll(vad, audio);
    TEST_ASSERT_FALSE(vad.speechStarted());
    // The knock was not nothing, though: the silence counted from it, not from the start.
    TEST_ASSERT_TRUE(vad.silenceMs() <= 8000 + kVadFrameMs);
    TEST_ASSERT_TRUE(vad.silenceMs() >= 8000 - kVadHangoverFrames * kVadFrameMs - kVadFrameMs);
  }
}

void test_speech_in_the_first_frames_is_not_taken_for_the_noise() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.speech(audio, 1000, 2000.0);  // the owner is already talking when the pet starts to listen
  feedAll(vad, audio);
  TEST_ASSERT_TRUE(vad.speechStarted());
  TEST_ASSERT_TRUE(vad.noiseRms() <= kVadInitialNoiseMaxRms);
}

void test_the_absolute_floor_holds_in_a_silent_room() {
  Source src;
  {
    Vad vad;  // zeros first, so the room's noise is 0: only the absolute floor decides
    std::vector<int16_t> audio(PET_UP_SAMPLE_RATE, 0);
    feedAll(vad, audio);
    std::vector<int16_t> faint;
    src.speech(faint, 1000, static_cast<double>(kVadAbsoluteFloorRms) - 4.0);
    feedAll(vad, faint);
    TEST_ASSERT_FALSE(vad.speechStarted());
  }
  {
    Vad vad;
    std::vector<int16_t> audio(PET_UP_SAMPLE_RATE, 0);
    feedAll(vad, audio);
    std::vector<int16_t> clear;
    src.speech(clear, 200, static_cast<double>(kVadAbsoluteFloorRms) + 15.0);
    feedAll(vad, clear);
    TEST_ASSERT_TRUE(vad.speechStarted());
  }
}

// -- The hangover and the silence that ends a recording ----------------------------------

void test_the_hangover_keeps_a_pause_inside_a_word_from_counting() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 500, 9.0);
  src.speech(audio, 600, 800.0, 9.0);
  feedAll(vad, audio);
  TEST_ASSERT_TRUE(vad.speechStarted());
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());

  // The speech stops. For the hangover's frames it still counts as speech.
  std::vector<int16_t> quiet;
  src.room(quiet, kVadFrameMs, 9.0);
  for (uint32_t frame = 1; frame <= kVadHangoverFrames; ++frame) {
    feedAll(vad, quiet);
    TEST_ASSERT_TRUE_MESSAGE(vad.speaking(), "in the hangover");
    TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
  }
  feedAll(vad, quiet);
  TEST_ASSERT_FALSE(vad.speaking());
  TEST_ASSERT_EQUAL_UINT32(kVadFrameMs, vad.silenceMs());
  feedAll(vad, quiet);
  TEST_ASSERT_EQUAL_UINT32(2 * kVadFrameMs, vad.silenceMs());
}

void test_five_seconds_of_silence_after_speech_is_reported() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 300, 9.0);
  src.speech(audio, 2000, 600.0, 9.0);
  feedAll(vad, audio);
  TEST_ASSERT_TRUE(vad.speechStarted());

  const uint32_t endMs = static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u;
  std::vector<int16_t> quiet;
  src.room(quiet, kVadFrameMs, 9.0);
  uint32_t frames = 0;
  while (vad.silenceMs() < endMs) {
    feedAll(vad, quiet);
    ++frames;
    TEST_ASSERT_TRUE(frames < 1000);
  }
  // The silence counts from the end of the hangover: the five seconds are real
  // silence, then.
  TEST_ASSERT_EQUAL_UINT32(kVadHangoverFrames + kVadSilenceEndFrames, frames);
  TEST_ASSERT_EQUAL_UINT32(endMs, vad.silenceMs());
  TEST_ASSERT_TRUE(vad.speechStarted());
}

void test_a_pause_shorter_than_five_seconds_does_not_end_it_and_more_speech_starts_over() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 300, 9.0);
  src.speech(audio, 1500, 700.0, 9.0);
  src.room(audio, 4000, 9.0);  // thinking
  feedAll(vad, audio);
  TEST_ASSERT_TRUE(vad.speechStarted());
  TEST_ASSERT_TRUE(vad.silenceMs() < static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u);
  TEST_ASSERT_TRUE(vad.silenceMs() > 3500);

  std::vector<int16_t> more;
  src.speech(more, 100, 700.0, 9.0);
  feedAll(vad, more);
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
  TEST_ASSERT_TRUE(vad.speechStarted());
}

void test_speech_started_is_latched_for_the_whole_recording() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.speech(audio, 500, 900.0, 5.0);
  src.room(audio, 60000, 5.0);
  feedAll(vad, audio);
  TEST_ASSERT_TRUE(vad.speechStarted());
  TEST_ASSERT_TRUE(vad.silenceMs() > 50000);
}

// -- The noise floor ----------------------------------------------------------------

void test_a_steady_noise_above_the_absolute_floor_is_learned_not_heard() {
  // A fan: RMS 40 is above kVadAbsoluteFloorRms, but the first frame is the floor, so
  // three times that is what counts as speech.
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 30000, 40.0);
  feedAll(vad, audio);
  TEST_ASSERT_FALSE(vad.speechStarted());
  TEST_ASSERT_INT_WITHIN(6, 40, vad.noiseRms());
  TEST_ASSERT_TRUE(vad.silenceMs() >= 29900);
}

void test_speech_over_a_noisy_room_is_heard_and_does_not_raise_the_floor() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 2000, 100.0);
  feedAll(vad, audio);
  TEST_ASSERT_FALSE(vad.speechStarted());
  const uint32_t before = vad.noiseRms();
  TEST_ASSERT_INT_WITHIN(15, 100, before);

  std::vector<int16_t> talk;
  src.speech(talk, 10000, 1200.0, 100.0);  // ten seconds of loud speech
  feedAll(vad, talk);
  TEST_ASSERT_TRUE(vad.speechStarted());
  // Tracked only while silent: ten seconds of speech did not move the floor.
  TEST_ASSERT_EQUAL_UINT32(before, vad.noiseRms());

  std::vector<int16_t> after;
  src.room(after, 8000, 100.0);
  feedAll(vad, after);
  TEST_ASSERT_TRUE(vad.silenceMs() >= static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u);
  TEST_ASSERT_INT_WITHIN(15, 100, vad.noiseRms());
}

void test_the_floor_never_rises_during_speech_frame_by_frame() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 1000, 10.0);
  feedAll(vad, audio);
  const uint32_t floorBefore = vad.noiseRms();
  std::vector<int16_t> frame;
  for (int i = 0; i < 500; ++i) {  // ten seconds of speech, one frame at a time
    frame.clear();
    src.speech(frame, kVadFrameMs, 2500.0, 10.0);
    feedAll(vad, frame);
    if (vad.speaking()) {
      TEST_ASSERT_TRUE(vad.noiseRms() <= floorBefore);
    }
  }
  TEST_ASSERT_TRUE(vad.speechStarted());
}

void test_the_floor_falls_quickly_when_the_room_gets_quieter() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 1000, 120.0);  // a noisy start
  feedAll(vad, audio);
  const uint32_t loud = vad.noiseRms();
  TEST_ASSERT_TRUE(loud > 90);
  std::vector<int16_t> quiet;
  src.room(quiet, 1000, 8.0);  // the fan stops
  feedAll(vad, quiet);
  TEST_ASSERT_TRUE(vad.noiseRms() < 15);
  // And speech that is quiet by the old room's standard is now heard.
  std::vector<int16_t> word;
  src.speech(word, 200, 60.0, 8.0);
  feedAll(vad, word);
  TEST_ASSERT_TRUE(vad.speechStarted());
}

void test_a_room_that_gets_louder_slowly_is_followed_and_never_heard_as_speech() {
  Vad vad;
  Source src;
  // From RMS 8 to 70 over two minutes, a step every second.
  for (int second = 0; second < 120; ++second) {
    std::vector<int16_t> audio;
    src.room(audio, 1000, 8.0 + second * 0.52);
    feedAll(vad, audio);
    TEST_ASSERT_FALSE_MESSAGE(vad.speechStarted(), "a slowly rising room");
  }
  TEST_ASSERT_INT_WITHIN(10, 70, vad.noiseRms());
}

void test_reset_forgets_everything() {
  Vad vad;
  Source src;
  std::vector<int16_t> audio;
  src.speech(audio, 2000, 900.0, 20.0);
  src.room(audio, 3000, 20.0);
  feedAll(vad, audio);
  TEST_ASSERT_TRUE(vad.speechStarted());
  vad.reset();
  TEST_ASSERT_FALSE(vad.speechStarted());
  TEST_ASSERT_FALSE(vad.speaking());
  TEST_ASSERT_EQUAL_UINT32(0, vad.silenceMs());
  TEST_ASSERT_EQUAL_UINT32(0, vad.frames());
  TEST_ASSERT_EQUAL_UINT32(0, vad.noiseRms());
  // A half frame from before the reset does not count towards the next one.
  Vad half;
  std::vector<int16_t> part(kVadFrameSamples / 2, 20000);
  feedAll(half, part);
  half.reset();
  feedAll(half, part);
  TEST_ASSERT_EQUAL_UINT32(0, half.frames());
}

// -- Chunking and length --------------------------------------------------------------

void test_the_result_does_not_depend_on_how_the_samples_come_in() {
  Source src;
  std::vector<int16_t> audio;
  src.room(audio, 700, 9.0);
  src.speech(audio, 1300, 500.0, 9.0);
  src.room(audio, 6000, 9.0);

  Vad whole;
  feedAll(whole, audio);
  for (size_t chunk : {static_cast<size_t>(1), static_cast<size_t>(7), static_cast<size_t>(256), static_cast<size_t>(320),
                       static_cast<size_t>(1000), static_cast<size_t>(5000)}) {
    Vad vad;
    for (size_t at = 0; at < audio.size(); at += chunk) {
      vad.feed(audio.data() + at, std::min(chunk, audio.size() - at));
    }
    TEST_ASSERT_EQUAL_UINT32(whole.frames(), vad.frames());
    TEST_ASSERT_EQUAL_UINT32(whole.silenceMs(), vad.silenceMs());
    TEST_ASSERT_EQUAL_UINT32(whole.noiseRms(), vad.noiseRms());
    TEST_ASSERT_EQUAL_UINT32(whole.lastRms(), vad.lastRms());
    TEST_ASSERT_EQUAL_INT(whole.speechStarted(), vad.speechStarted());
  }
  TEST_ASSERT_TRUE(whole.speechStarted());
}

void test_a_five_minute_recording_of_silence_counts_without_overflow() {
  Vad vad;
  std::vector<int16_t> second(PET_UP_SAMPLE_RATE, 0);
  for (int i = 0; i < PET_RECORD_MAX_SECONDS; ++i) {
    feedAll(vad, second);
  }
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(PET_RECORD_MAX_SECONDS) * 1000u, vad.silenceMs());
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(PET_RECORD_MAX_SECONDS) * 1000u / kVadFrameMs, vad.frames());
  TEST_ASSERT_FALSE(vad.speechStarted());
}

void test_the_tuning_constants_are_in_sane_proportion() {
  // These are first guesses that need tuning on hardware (vad.h); the proportions
  // between them are not guesses.
  TEST_ASSERT_TRUE(kVadNoiseRatio >= 2);
  TEST_ASSERT_TRUE(kVadHangoverFrames >= 1 && kVadHangoverFrames * kVadFrameMs < 1000);
  TEST_ASSERT_TRUE(kVadOnsetFrames >= 2 && kVadOnsetFrames * kVadFrameMs <= 100);
  TEST_ASSERT_TRUE(kVadAbsoluteFloorRms > 8);  // above the measured noise of the microphone
  TEST_ASSERT_TRUE(kVadAbsoluteFloorRms < 100);  // below quiet speech
  TEST_ASSERT_TRUE(kVadInitialNoiseMaxRms * kVadNoiseRatio < 1000);
  TEST_ASSERT_TRUE(kVadHangoverFrames < kVadSilenceEndFrames);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_a_frame_is_twenty_milliseconds_and_five_seconds_is_250_frames);
  RUN_TEST(test_the_integer_square_root_is_exact);
  RUN_TEST(test_a_whole_frame_is_needed_before_anything_is_judged);
  RUN_TEST(test_nothing_to_feed_is_fine);
  RUN_TEST(test_the_rms_of_a_frame_is_measured);
  RUN_TEST(test_digital_silence_is_never_speech_and_counts_up);
  RUN_TEST(test_a_quiet_room_never_starts_speech_however_long);
  RUN_TEST(test_a_recording_with_nothing_said_reports_no_speech_for_the_whole_five_seconds);
  RUN_TEST(test_speech_over_a_quiet_room_starts_after_three_loud_frames);
  RUN_TEST(test_a_knock_on_the_desk_is_not_speech);
  RUN_TEST(test_speech_in_the_first_frames_is_not_taken_for_the_noise);
  RUN_TEST(test_the_absolute_floor_holds_in_a_silent_room);
  RUN_TEST(test_the_hangover_keeps_a_pause_inside_a_word_from_counting);
  RUN_TEST(test_five_seconds_of_silence_after_speech_is_reported);
  RUN_TEST(test_a_pause_shorter_than_five_seconds_does_not_end_it_and_more_speech_starts_over);
  RUN_TEST(test_speech_started_is_latched_for_the_whole_recording);
  RUN_TEST(test_a_steady_noise_above_the_absolute_floor_is_learned_not_heard);
  RUN_TEST(test_speech_over_a_noisy_room_is_heard_and_does_not_raise_the_floor);
  RUN_TEST(test_the_floor_never_rises_during_speech_frame_by_frame);
  RUN_TEST(test_the_floor_falls_quickly_when_the_room_gets_quieter);
  RUN_TEST(test_a_room_that_gets_louder_slowly_is_followed_and_never_heard_as_speech);
  RUN_TEST(test_reset_forgets_everything);
  RUN_TEST(test_the_result_does_not_depend_on_how_the_samples_come_in);
  RUN_TEST(test_a_five_minute_recording_of_silence_counts_without_overflow);
  RUN_TEST(test_the_tuning_constants_are_in_sane_proportion);
  return UNITY_END();
}
