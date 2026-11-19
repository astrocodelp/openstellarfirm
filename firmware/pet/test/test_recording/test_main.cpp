// How a recording is held: the size of a slot for 120 seconds, how many slots the
// PSRAM allows, and the writer that encodes IMA-ADPCM block by block into a slot as the
// microphone delivers samples (core/recording_plan.h, core/recording_writer.h).
#include <unity.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "config.h"
#include "core/adpcm.h"
#include "core/recording_plan.h"
#include "core/recording_writer.h"
#include "core/wav.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

uint32_t rd32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}
uint16_t rd16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }

// A deterministic signal in integer math: speech-like swings, never silent.
int16_t signalAt(size_t n) {
  int v = static_cast<int>((n * 97) % 4001) - 2000;
  v = v * 6 + ((n % 50 < 25) ? 2500 : -2500);
  return static_cast<int16_t>(std::max(-32768, std::min(32767, v)));
}

std::vector<int16_t> makeSignal(size_t samples) {
  std::vector<int16_t> out(samples);
  for (size_t n = 0; n < samples; ++n) {
    out[n] = signalAt(n);
  }
  return out;
}

// Pushes everything in pieces of `piece` samples, as the audio task does (it reads up
// to 256 at a time), and returns how many the writer kept.
size_t pushAll(RecordingWriter& w, const std::vector<int16_t>& audio, size_t piece) {
  size_t kept = 0;
  for (size_t at = 0; at < audio.size(); at += piece) {
    kept += w.push(audio.data() + at, std::min(piece, audio.size() - at));
  }
  return kept;
}

constexpr uint8_t kGuard = 0xA5;

}  // namespace

// -- The plan -----------------------------------------------------------------------------

void test_a_slot_holds_120_seconds_of_adpcm_and_the_wav_header() {
  TEST_ASSERT_EQUAL_UINT32(1920000, kRecordMaxSamples);
  TEST_ASSERT_EQUAL_UINT32(1888, kRecordMaxBlocks);  // 1,920,000 / 1017 = 1887.9, rounded up
  TEST_ASSERT_EQUAL_UINT32(60 + 1888 * 512, kRecordSlotBytes);
  TEST_ASSERT_EQUAL_UINT32(966716, kRecordSlotBytes);
  // About 0.97 MB, where the same 120 s as PCM16 would be 3.84 MB: four times as much,
  // and two slots of it (7.68 MB) would use nearly all of the 8 MB of PSRAM.
  TEST_ASSERT_TRUE(kRecordSlotBytes > 960000 && kRecordSlotBytes < 970000);
  const size_t pcmBytes = static_cast<size_t>(PET_RECORD_MAX_SECONDS) * PET_UP_SAMPLE_RATE * 2;
  TEST_ASSERT_EQUAL_UINT32(3840000, pcmBytes);
  TEST_ASSERT_TRUE(2 * pcmBytes > 7u * 1024u * 1024u);
  TEST_ASSERT_TRUE(pcmBytes > 3 * kRecordSlotBytes);
  TEST_ASSERT_TRUE(kRecordSlotBytes <= static_cast<size_t>(PET_UPLOAD_MAX_BYTES));
  // The upload cap is 1 MiB, so a full recording fits with about 80 KB to spare.
  TEST_ASSERT_EQUAL_UINT32(1048576, PET_UPLOAD_MAX_BYTES);
  TEST_ASSERT_TRUE(PET_UPLOAD_MAX_BYTES - kRecordSlotBytes > 75000);
}

void test_blocks_are_counted_rounding_up() {
  TEST_ASSERT_EQUAL_UINT32(0, recordingBlocksFor(0));
  TEST_ASSERT_EQUAL_UINT32(1, recordingBlocksFor(1));
  TEST_ASSERT_EQUAL_UINT32(1, recordingBlocksFor(1017));
  TEST_ASSERT_EQUAL_UINT32(2, recordingBlocksFor(1018));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxBlocks, recordingBlocksFor(kRecordMaxSamples));
}

void test_two_slots_only_when_the_psram_leaves_room() {
  const size_t slot = kRecordSlotBytes;
  TEST_ASSERT_EQUAL_INT(0, recordingSlotsFor(0));
  TEST_ASSERT_EQUAL_INT(0, recordingSlotsFor(slot - 1));
  TEST_ASSERT_EQUAL_INT(1, recordingSlotsFor(slot));
  TEST_ASSERT_EQUAL_INT(1, recordingSlotsFor(2 * slot));
  TEST_ASSERT_EQUAL_INT(1, recordingSlotsFor(2 * slot + kPsramReserveBytes - 1));
  TEST_ASSERT_EQUAL_INT(2, recordingSlotsFor(2 * slot + kPsramReserveBytes));
  // The Nano ESP32 has 8 MB of PSRAM: two slots, about 6 MB left over.
  TEST_ASSERT_EQUAL_INT(2, recordingSlotsFor(8u * 1024u * 1024u));
  // A part with half of that still makes two (1.9 MB for the slots and 1 MiB kept).
  TEST_ASSERT_EQUAL_INT(2, recordingSlotsFor(4u * 1024u * 1024u));
  // A part with 2 MiB free makes one: a second slot would leave less than the reserve.
  TEST_ASSERT_EQUAL_INT(1, recordingSlotsFor(2u * 1024u * 1024u));
  // And a second slot never takes more than the reserve allows.
  TEST_ASSERT_TRUE(8u * 1024u * 1024u - 2 * slot >= kPsramReserveBytes);
}

void test_the_samples_a_buffer_keeps() {
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, recordingSamplesFor(kRecordSlotBytes));
  // A bigger buffer is capped at the 120 seconds, and at the upload cap.
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, recordingSamplesFor(16u * 1024u * 1024u));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, recordingSamplesFor(PET_UPLOAD_MAX_BYTES));
  // A buffer too small for the header and one block keeps nothing.
  TEST_ASSERT_EQUAL_UINT32(0, recordingSamplesFor(0));
  TEST_ASSERT_EQUAL_UINT32(0, recordingSamplesFor(kImaWavHeaderBytes + PET_ADPCM_BLOCK_ALIGN - 1));
  TEST_ASSERT_EQUAL_UINT32(1017, recordingSamplesFor(kImaWavHeaderBytes + PET_ADPCM_BLOCK_ALIGN));
  TEST_ASSERT_EQUAL_UINT32(2 * 1017, recordingSamplesFor(kImaWavHeaderBytes + 2 * PET_ADPCM_BLOCK_ALIGN + 511));
  // The no-PSRAM buffer (96 KB) keeps about twelve seconds.
  const uint32_t fallback = recordingSamplesFor(96 * 1024);
  TEST_ASSERT_EQUAL_UINT32(191u * 1017u, fallback);
  TEST_ASSERT_TRUE(fallback > 12u * PET_UP_SAMPLE_RATE && fallback < 13u * PET_UP_SAMPLE_RATE);
  // Whatever the size, the file that holds the samples fits the buffer.
  for (size_t bytes = 0; bytes < 400000; bytes += 7919) {
    const uint32_t samples = recordingSamplesFor(bytes);
    if (samples > 0) {
      TEST_ASSERT_TRUE(kImaWavHeaderBytes + static_cast<size_t>(recordingBlocksFor(samples)) * PET_ADPCM_BLOCK_ALIGN <= bytes);
    }
  }
}

// -- The writer ---------------------------------------------------------------------------

void test_the_writer_refuses_a_buffer_it_cannot_use() {
  RecordingWriter w;
  uint8_t tiny[100];
  TEST_ASSERT_FALSE(w.begin(nullptr, 100000));
  TEST_ASSERT_FALSE(w.begin(tiny, sizeof(tiny)));
  TEST_ASSERT_FALSE(w.active());
  int16_t x = 5;
  TEST_ASSERT_EQUAL_UINT32(0, w.push(&x, 1));
  TEST_ASSERT_EQUAL_UINT32(0, w.finish());
  TEST_ASSERT_FALSE(w.full());  // a writer with no buffer is not "full", it is not running
}

void test_a_full_120_second_recording_is_encoded_block_by_block_into_the_slot() {
  const std::vector<int16_t> audio = makeSignal(kRecordMaxSamples);
  std::vector<uint8_t> slot(kRecordSlotBytes + 64, kGuard);

  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(slot.data(), kRecordSlotBytes));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, w.limitSamples());
  // 256 samples at a time, the way the microphone task reads them.
  const size_t kept = pushAll(w, audio, 256);
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, kept);
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, w.samples());
  TEST_ASSERT_TRUE(w.full());
  const size_t bytes = w.finish();

  TEST_ASSERT_EQUAL_UINT32(kRecordSlotBytes, bytes);
  TEST_ASSERT_TRUE(bytes <= static_cast<size_t>(PET_UPLOAD_MAX_BYTES));
  // Nothing was written past the slot.
  for (size_t i = kRecordSlotBytes; i < slot.size(); ++i) {
    TEST_ASSERT_EQUAL_UINT8(kGuard, slot[i]);
  }

  // The header says what the file is.
  const uint8_t* h = slot.data();
  TEST_ASSERT_EQUAL_MEMORY("RIFF", h, 4);
  TEST_ASSERT_EQUAL_UINT32(bytes - 8, rd32(h + 4));
  TEST_ASSERT_EQUAL_UINT16(0x11, rd16(h + 20));
  TEST_ASSERT_EQUAL_UINT32(PET_UP_SAMPLE_RATE, rd32(h + 24));
  TEST_ASSERT_EQUAL_UINT16(PET_ADPCM_BLOCK_ALIGN, rd16(h + 32));
  TEST_ASSERT_EQUAL_UINT16(PET_ADPCM_SAMPLES_PER_BLOCK, rd16(h + 38));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, rd32(h + 48));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxBlocks * PET_ADPCM_BLOCK_ALIGN, rd32(h + 56));

  // The blocks are exactly what the whole-signal encoder makes: the streaming encoder
  // is bit-identical to it, so the server decodes what the tests decode.
  std::vector<uint8_t> reference(adpcmEncodedSize(audio.size(), PET_ADPCM_BLOCK_ALIGN));
  TEST_ASSERT_EQUAL_UINT32(reference.size(),
                           adpcmEncode(audio.data(), audio.size(), reference.data(), reference.size(), PET_ADPCM_BLOCK_ALIGN));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxBlocks * PET_ADPCM_BLOCK_ALIGN, reference.size());
  TEST_ASSERT_EQUAL_MEMORY(reference.data(), h + kImaWavHeaderBytes, reference.size());

  // And it decodes back, all 120 seconds of it, to the same samples as the reference.
  std::vector<int16_t> decoded(kRecordMaxSamples);
  bool corrupt = false;
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples,
                           adpcmDecode(h + kImaWavHeaderBytes, bytes - kImaWavHeaderBytes, PET_ADPCM_BLOCK_ALIGN, decoded.data(),
                                       decoded.size(), &corrupt));
  TEST_ASSERT_FALSE(corrupt);
  std::vector<int16_t> viaReference(kRecordMaxSamples);
  adpcmDecode(reference.data(), reference.size(), PET_ADPCM_BLOCK_ALIGN, viaReference.data(), viaReference.size());
  TEST_ASSERT_EQUAL_MEMORY(viaReference.data(), decoded.data(), decoded.size() * sizeof(int16_t));
}

void test_the_writer_keeps_exactly_120_seconds_and_ignores_the_rest() {
  const std::vector<int16_t> audio = makeSignal(static_cast<size_t>(PET_RECORD_MAX_SECONDS + 1) * PET_UP_SAMPLE_RATE);
  std::vector<uint8_t> slot(kRecordSlotBytes);
  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
  const size_t kept = pushAll(w, audio, 1000);
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, kept);  // the 121st second was refused
  TEST_ASSERT_TRUE(w.full());
  int16_t more[10] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
  TEST_ASSERT_EQUAL_UINT32(0, w.push(more, 10));
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, w.samples());
  const size_t bytes = w.finish();
  // The server's "too long" is 120 seconds: a capped recording is exactly at it, not over.
  TEST_ASSERT_EQUAL_UINT32(kRecordMaxSamples, rd32(slot.data() + 48));
  TEST_ASSERT_TRUE(bytes <= static_cast<size_t>(PET_UPLOAD_MAX_BYTES));
}

void test_a_short_recording_pads_its_last_block_and_says_how_many_samples_are_real() {
  const size_t n = 8000;  // half a second
  const std::vector<int16_t> audio = makeSignal(n);
  std::vector<uint8_t> slot(kRecordSlotBytes, kGuard);
  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
  TEST_ASSERT_EQUAL_UINT32(n, pushAll(w, audio, 333));
  TEST_ASSERT_FALSE(w.full());
  const size_t bytes = w.finish();
  const uint32_t blocks = (n + PET_ADPCM_SAMPLES_PER_BLOCK - 1) / PET_ADPCM_SAMPLES_PER_BLOCK;
  TEST_ASSERT_EQUAL_UINT32(8, blocks);
  TEST_ASSERT_EQUAL_UINT32(kImaWavHeaderBytes + blocks * PET_ADPCM_BLOCK_ALIGN, bytes);
  TEST_ASSERT_EQUAL_UINT32(n, rd32(slot.data() + 48));
  TEST_ASSERT_EQUAL_UINT32(blocks * PET_ADPCM_BLOCK_ALIGN, rd32(slot.data() + 56));
  // The last block's unused tail is zero.
  const uint8_t* last = slot.data() + kImaWavHeaderBytes + (blocks - 1) * PET_ADPCM_BLOCK_ALIGN;
  const size_t realInLast = n - (blocks - 1) * PET_ADPCM_SAMPLES_PER_BLOCK;  // 881
  const size_t usedBytes = 4 + (realInLast - 1 + 1) / 2;
  for (size_t i = usedBytes; i < PET_ADPCM_BLOCK_ALIGN; ++i) {
    TEST_ASSERT_EQUAL_UINT8(0, last[i]);
  }
  // Nothing after the file was touched.
  for (size_t i = bytes; i < slot.size(); ++i) {
    TEST_ASSERT_EQUAL_UINT8(kGuard, slot[i]);
  }
  std::vector<int16_t> decoded(n + 100);
  TEST_ASSERT_EQUAL_UINT32(n, adpcmDecode(slot.data() + kImaWavHeaderBytes, bytes - kImaWavHeaderBytes, PET_ADPCM_BLOCK_ALIGN,
                                          decoded.data(), n));
}

void test_a_recording_of_exactly_one_block_and_of_one_sample() {
  for (size_t n : {static_cast<size_t>(1), static_cast<size_t>(PET_ADPCM_SAMPLES_PER_BLOCK),
                   static_cast<size_t>(PET_ADPCM_SAMPLES_PER_BLOCK + 1)}) {
    std::vector<uint8_t> slot(kRecordSlotBytes);
    RecordingWriter w;
    TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
    const std::vector<int16_t> audio = makeSignal(n);
    TEST_ASSERT_EQUAL_UINT32(n, w.push(audio.data(), audio.size()));
    const size_t bytes = w.finish();
    const size_t blocks = (n + PET_ADPCM_SAMPLES_PER_BLOCK - 1) / PET_ADPCM_SAMPLES_PER_BLOCK;
    TEST_ASSERT_EQUAL_UINT32(kImaWavHeaderBytes + blocks * PET_ADPCM_BLOCK_ALIGN, bytes);
    TEST_ASSERT_EQUAL_UINT32(n, rd32(slot.data() + 48));
  }
}

void test_nothing_recorded_is_not_a_file() {
  std::vector<uint8_t> slot(kRecordSlotBytes);
  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
  TEST_ASSERT_EQUAL_UINT32(0, w.finish());
  TEST_ASSERT_FALSE(w.active());
  // And finishing twice is harmless.
  TEST_ASSERT_EQUAL_UINT32(0, w.finish());
}

void test_beginning_again_starts_clean() {
  std::vector<uint8_t> slot(kRecordSlotBytes);
  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
  const std::vector<int16_t> loud(3000, 20000);
  w.push(loud.data(), loud.size());
  TEST_ASSERT_EQUAL_UINT16(20000, w.peak());
  w.finish();
  TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
  TEST_ASSERT_EQUAL_UINT32(0, w.samples());
  TEST_ASSERT_EQUAL_UINT16(0, w.peak());
  TEST_ASSERT_EQUAL_UINT32(0, w.blocks());
  const std::vector<int16_t> quiet(2000, 30);
  w.push(quiet.data(), quiet.size());
  TEST_ASSERT_EQUAL_UINT16(30, w.peak());
  // The encoder starts again too: the first block's step index is 0.
  const size_t bytes = w.finish();
  TEST_ASSERT_TRUE(bytes > 0);
  TEST_ASSERT_EQUAL_UINT8(0, slot[kImaWavHeaderBytes + 2]);
}

void test_the_peak_is_the_loudest_kept_sample() {
  std::vector<uint8_t> slot(kRecordSlotBytes);
  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
  const int16_t samples[] = {5, -300, 120, -32768, 7};
  w.push(samples, 5);
  TEST_ASSERT_EQUAL_UINT16(32768, w.peak());
  // A dead-quiet recording has a small peak (main.cpp drops it with "didn't catch").
  RecordingWriter quiet;
  TEST_ASSERT_TRUE(quiet.begin(slot.data(), slot.size()));
  const std::vector<int16_t> hiss(5000, 12);
  quiet.push(hiss.data(), hiss.size());
  TEST_ASSERT_EQUAL_UINT16(12, quiet.peak());
}

void test_without_psram_a_short_buffer_fills_and_says_so() {
  std::vector<uint8_t> small(96 * 1024, kGuard);
  RecordingWriter w;
  TEST_ASSERT_TRUE(w.begin(small.data(), small.size()));
  const uint32_t limit = 191u * 1017u;
  TEST_ASSERT_EQUAL_UINT32(limit, w.limitSamples());
  const std::vector<int16_t> audio = makeSignal(static_cast<size_t>(20) * PET_UP_SAMPLE_RATE);
  const size_t kept = pushAll(w, audio, 256);
  TEST_ASSERT_EQUAL_UINT32(limit, kept);
  TEST_ASSERT_TRUE(w.full());  // the state machine hears "the memory is full" and ends the recording
  const size_t bytes = w.finish();
  TEST_ASSERT_TRUE(bytes <= small.size());
  TEST_ASSERT_EQUAL_UINT32(limit, rd32(small.data() + 48));
}

void test_every_chunking_gives_the_same_file() {
  const std::vector<int16_t> audio = makeSignal(25000);
  std::vector<std::vector<uint8_t>> files;
  for (size_t piece : {static_cast<size_t>(1), static_cast<size_t>(255), static_cast<size_t>(256), static_cast<size_t>(1017),
                       static_cast<size_t>(1018), static_cast<size_t>(25000)}) {
    std::vector<uint8_t> slot(kRecordSlotBytes, 0);
    RecordingWriter w;
    TEST_ASSERT_TRUE(w.begin(slot.data(), slot.size()));
    pushAll(w, audio, piece);
    const size_t bytes = w.finish();
    slot.resize(bytes);
    files.push_back(slot);
  }
  for (size_t i = 1; i < files.size(); ++i) {
    TEST_ASSERT_EQUAL_UINT32(files[0].size(), files[i].size());
    TEST_ASSERT_EQUAL_MEMORY(files[0].data(), files[i].data(), files[0].size());
  }
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_a_slot_holds_120_seconds_of_adpcm_and_the_wav_header);
  RUN_TEST(test_blocks_are_counted_rounding_up);
  RUN_TEST(test_two_slots_only_when_the_psram_leaves_room);
  RUN_TEST(test_the_samples_a_buffer_keeps);
  RUN_TEST(test_the_writer_refuses_a_buffer_it_cannot_use);
  RUN_TEST(test_a_full_120_second_recording_is_encoded_block_by_block_into_the_slot);
  RUN_TEST(test_the_writer_keeps_exactly_120_seconds_and_ignores_the_rest);
  RUN_TEST(test_a_short_recording_pads_its_last_block_and_says_how_many_samples_are_real);
  RUN_TEST(test_a_recording_of_exactly_one_block_and_of_one_sample);
  RUN_TEST(test_nothing_recorded_is_not_a_file);
  RUN_TEST(test_beginning_again_starts_clean);
  RUN_TEST(test_the_peak_is_the_loudest_kept_sample);
  RUN_TEST(test_without_psram_a_short_buffer_fills_and_says_so);
  RUN_TEST(test_every_chunking_gives_the_same_file);
  return UNITY_END();
}
