// IMA-ADPCM: the encoder and decoder against the vector that
// src/shared/pets generated, so the firmware stays bit-identical to the
// server's adpcm.ts. Also the streaming decoder in odd chunk sizes, and the WAV
// header the upload starts with.
#include <unity.h>

#include <cstdint>
#include <cstring>
#include <vector>

#include "core/adpcm.h"
#include "core/wav.h"
#include "generated/adpcm_vectors.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

std::vector<int16_t> vectorInput() {
  std::vector<int16_t> in(ADPCM_VECTOR_SAMPLES);
  for (int n = 0; n < ADPCM_VECTOR_SAMPLES; ++n) {
    in[n] = adpcm_vector_input(n);
  }
  return in;
}

// Drains a streaming decoder over `data` in chunks of `chunk` bytes, with an
// output buffer of `outCap` samples.
std::vector<int16_t> streamDecode(const uint8_t* data, size_t len, size_t chunk, size_t outCap, size_t limit,
                                  bool* corruptOut = nullptr) {
  AdpcmBlockDecoder dec(ADPCM_VECTOR_BLOCK_ALIGN);
  dec.reset(limit);
  std::vector<int16_t> all;
  std::vector<int16_t> buf(outCap);
  size_t pos = 0;
  int guard = 0;
  while (pos < len) {
    const size_t take = (len - pos < chunk) ? (len - pos) : chunk;
    size_t offered = 0;
    while (offered < take) {
      size_t used = 0;
      const size_t n = dec.decode(data + pos + offered, take - offered, used, buf.data(), outCap);
      all.insert(all.end(), buf.begin(), buf.begin() + static_cast<long>(n));
      offered += used;
      if (used == 0 && n == 0) {
        // Not even one byte could be taken: the caller would be stuck.
        TEST_FAIL_MESSAGE("decoder made no progress");
      }
      if (++guard > 10000000) {
        TEST_FAIL_MESSAGE("decoder loop did not end");
      }
    }
    pos += take;
  }
  if (corruptOut != nullptr) {
    *corruptOut = dec.corrupt();
  }
  return all;
}

}  // namespace

void test_block_sizes() {
  TEST_ASSERT_EQUAL_INT(1017, adpcmSamplesPerBlock(512));
  TEST_ASSERT_EQUAL_INT(PET_ADPCM_SAMPLES_PER_BLOCK, adpcmSamplesPerBlock(PET_ADPCM_BLOCK_ALIGN));
  TEST_ASSERT_EQUAL_INT(0, adpcmSamplesPerBlock(7));
  TEST_ASSERT_EQUAL_INT(0, adpcmSamplesPerBlock(8192 + 1));
  TEST_ASSERT_EQUAL_INT(9, adpcmSamplesPerBlock(8));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncodedSize(100, 3));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncodedSize(0, 512));
  TEST_ASSERT_EQUAL_INT(512, adpcmEncodedSize(1, 512));
  TEST_ASSERT_EQUAL_INT(512, adpcmEncodedSize(1017, 512));
  TEST_ASSERT_EQUAL_INT(1024, adpcmEncodedSize(1018, 512));
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_ENCODED_BYTES, adpcmEncodedSize(ADPCM_VECTOR_SAMPLES, 512));
}

void test_encoder_matches_the_vector() {
  std::vector<int16_t> in = vectorInput();
  std::vector<uint8_t> out(ADPCM_VECTOR_ENCODED_BYTES, 0xAA);
  size_t n = adpcmEncode(in.data(), in.size(), out.data(), out.size(), ADPCM_VECTOR_BLOCK_ALIGN);
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_ENCODED_BYTES, n);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(ADPCM_VECTOR_ENCODED, out.data(), ADPCM_VECTOR_ENCODED_BYTES);
}

void test_decoder_matches_the_vector() {
  std::vector<int16_t> out(ADPCM_VECTOR_SAMPLES + 50, 0x1234);
  bool corrupt = true;
  size_t n = adpcmDecode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, ADPCM_VECTOR_BLOCK_ALIGN, out.data(),
                         ADPCM_VECTOR_SAMPLES, &corrupt);
  TEST_ASSERT_FALSE(corrupt);
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_SAMPLES, n);
  TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, out.data(), ADPCM_VECTOR_SAMPLES);
  // Nothing past maxSamples was touched.
  TEST_ASSERT_EQUAL_INT16(0x1234, out[ADPCM_VECTOR_SAMPLES]);
}

void test_decoder_without_a_sample_count_decodes_the_padding_too() {
  std::vector<int16_t> out(3 * 1017);
  size_t n = adpcmDecode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, 512, out.data(), out.size());
  TEST_ASSERT_EQUAL_INT(3 * 1017, n);
  TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, out.data(), ADPCM_VECTOR_SAMPLES);
}

void test_block_by_block_encoding_equals_whole_encoding() {
  std::vector<int16_t> in = vectorInput();
  std::vector<uint8_t> out(ADPCM_VECTOR_ENCODED_BYTES, 0);
  AdpcmState state;
  size_t written = 0;
  for (size_t first = 0; first < in.size(); first += 1017) {
    size_t count = in.size() - first < 1017 ? in.size() - first : 1017;
    size_t n = adpcmEncodeBlock(in.data() + first, count, state, out.data() + written, 512);
    TEST_ASSERT_EQUAL_INT(512, n);
    written += n;
  }
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_ENCODED_BYTES, written);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(ADPCM_VECTOR_ENCODED, out.data(), ADPCM_VECTOR_ENCODED_BYTES);
}

void test_headers_carry_the_first_sample_and_the_step_index() {
  std::vector<int16_t> in = vectorInput();
  // Block 0: predictor is the first sample, index starts at 0.
  int16_t p0 = static_cast<int16_t>(ADPCM_VECTOR_ENCODED[0] | (ADPCM_VECTOR_ENCODED[1] << 8));
  TEST_ASSERT_EQUAL_INT16(in[0], p0);
  TEST_ASSERT_EQUAL_UINT8(0, ADPCM_VECTOR_ENCODED[2]);
  TEST_ASSERT_EQUAL_UINT8(0, ADPCM_VECTOR_ENCODED[3]);
  // Block 1 starts with the sample that begins it, and a carried-on index.
  int16_t p1 = static_cast<int16_t>(ADPCM_VECTOR_ENCODED[512] | (ADPCM_VECTOR_ENCODED[513] << 8));
  TEST_ASSERT_EQUAL_INT16(in[1017], p1);
  TEST_ASSERT_TRUE(ADPCM_VECTOR_ENCODED[514] <= kAdpcmMaxStepIndex);
  TEST_ASSERT_EQUAL_UINT8(0, ADPCM_VECTOR_ENCODED[515]);
}

void test_the_last_block_is_zero_padded() {
  // 66 real samples in the third block: 1 header sample + 65 codes = 33 bytes.
  const uint8_t* last = ADPCM_VECTOR_ENCODED + 1024;
  for (size_t i = 4 + 33; i < 512; ++i) {
    TEST_ASSERT_EQUAL_UINT8(0, last[i]);
  }
}

void test_a_short_block_and_a_single_sample() {
  int16_t one[1] = {-1234};
  uint8_t out[512];
  std::memset(out, 0x55, sizeof(out));
  AdpcmState state;
  TEST_ASSERT_EQUAL_INT(512, adpcmEncodeBlock(one, 1, state, out, 512));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(-1234 & 0xff), out[0]);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>((-1234 >> 8) & 0xff), out[1]);
  for (size_t i = 2; i < 512; ++i) {
    TEST_ASSERT_EQUAL_UINT8(0, out[i]);
  }
  int16_t back[4] = {0, 0, 0, 0};
  TEST_ASSERT_EQUAL_INT(1, adpcmDecode(out, 512, 512, back, 1));
  TEST_ASSERT_EQUAL_INT16(-1234, back[0]);
}

void test_encoder_refuses_what_it_cannot_do() {
  int16_t s[10] = {0};
  uint8_t out[1024];
  AdpcmState state;
  TEST_ASSERT_EQUAL_INT(0, adpcmEncodeBlock(s, 0, state, out, 512));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncodeBlock(s, 1018, state, out, 512));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncodeBlock(s, 5, state, out, 4));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncode(s, 0, out, sizeof(out), 512));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncode(s, 10, out, 511, 512));
  std::memset(out, 0x77, sizeof(out));
  TEST_ASSERT_EQUAL_INT(0, adpcmEncode(s, 10, out, 100, 512));
  TEST_ASSERT_EQUAL_UINT8(0x77, out[0]);
  TEST_ASSERT_EQUAL_INT(0, adpcmEncode(nullptr, 10, out, sizeof(out), 512));
}

void test_decoder_flags_a_corrupt_step_index() {
  uint8_t block[512];
  std::memset(block, 0, sizeof(block));
  block[2] = 89;
  int16_t out[2000];
  bool corrupt = false;
  size_t n = adpcmDecode(block, sizeof(block), 512, out, 2000, &corrupt);
  TEST_ASSERT_TRUE(corrupt);
  TEST_ASSERT_EQUAL_INT(0, n);
}

void test_decoders_refuse_a_block_size_the_format_does_not_have() {
  int16_t out[16];
  bool corrupt = false;
  TEST_ASSERT_EQUAL_INT(0, adpcmDecode(ADPCM_VECTOR_ENCODED, 512, 4, out, 16, &corrupt));
  TEST_ASSERT_FALSE(corrupt);
  TEST_ASSERT_EQUAL_INT(0, adpcmDecode(nullptr, 512, 512, out, 16));
  TEST_ASSERT_EQUAL_INT(0, adpcmDecode(ADPCM_VECTOR_ENCODED, 512, 512, nullptr, 16));
  // The streaming decoder takes the bytes, gives nothing, and says it is corrupt.
  AdpcmBlockDecoder dec(4);
  size_t used = 0;
  TEST_ASSERT_EQUAL_INT(0, dec.decode(ADPCM_VECTOR_ENCODED, 100, used, out, 16));
  TEST_ASSERT_EQUAL_INT(100, used);
  TEST_ASSERT_TRUE(dec.corrupt());
  // A reset does not make a bad size good.
  dec.reset();
  TEST_ASSERT_EQUAL_INT(0, dec.decode(ADPCM_VECTOR_ENCODED, 10, used, out, 16));
  TEST_ASSERT_TRUE(dec.corrupt());
}

void test_decoder_stops_at_the_requested_sample_count() {
  int16_t out[10];
  size_t n = adpcmDecode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, 512, out, 7);
  TEST_ASSERT_EQUAL_INT(7, n);
  TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, out, 7);
  // An even and an odd cut inside the data bytes.
  n = adpcmDecode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, 512, out, 8);
  TEST_ASSERT_EQUAL_INT(8, n);
  TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, out, 8);
}

void test_streaming_decoder_in_odd_chunk_sizes() {
  const size_t chunks[] = {1, 2, 3, 5, 7, 13, 33, 64, 100, 509, 511, 512, 513, 1000, 1536};
  for (size_t chunk : chunks) {
    std::vector<int16_t> got = streamDecode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, chunk, 4096,
                                            ADPCM_VECTOR_SAMPLES);
    TEST_ASSERT_EQUAL_INT_MESSAGE(ADPCM_VECTOR_SAMPLES, got.size(), "sample count");
    TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, got.data(), ADPCM_VECTOR_SAMPLES);
  }
}

void test_streaming_decoder_with_a_small_output_buffer() {
  // Back-pressure: the caller's buffer holds only a few samples at a time.
  const size_t caps[] = {2, 3, 5, 17, 1017};
  for (size_t cap : caps) {
    std::vector<int16_t> got =
        streamDecode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, 509, cap, ADPCM_VECTOR_SAMPLES);
    TEST_ASSERT_EQUAL_INT_MESSAGE(ADPCM_VECTOR_SAMPLES, got.size(), "sample count");
    TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, got.data(), ADPCM_VECTOR_SAMPLES);
  }
}

void test_streaming_decoder_reports_done_and_drops_the_padding() {
  AdpcmBlockDecoder dec(512);
  dec.reset(ADPCM_VECTOR_SAMPLES);
  std::vector<int16_t> buf(5000);
  size_t used = 0;
  size_t n = dec.decode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, used, buf.data(), buf.size());
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_SAMPLES, n);
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_ENCODED_BYTES, used);
  TEST_ASSERT_TRUE(dec.done());
  TEST_ASSERT_FALSE(dec.corrupt());
  TEST_ASSERT_EQUAL_INT(ADPCM_VECTOR_SAMPLES, dec.samplesEmitted());
  // Another clip on the same decoder after a reset.
  dec.reset(10);
  TEST_ASSERT_FALSE(dec.done());
  n = dec.decode(ADPCM_VECTOR_ENCODED, ADPCM_VECTOR_ENCODED_BYTES, used, buf.data(), buf.size());
  TEST_ASSERT_EQUAL_INT(10, n);
  TEST_ASSERT_TRUE(dec.done());
  TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, buf.data(), 10);
}

void test_streaming_decoder_skips_a_corrupt_block_and_goes_on() {
  std::vector<uint8_t> data(1024, 0);
  data[2] = 90;  // block 0 is corrupt
  // Block 1 is the vector's first block.
  std::memcpy(data.data() + 512, ADPCM_VECTOR_ENCODED, 512);
  bool corrupt = false;
  std::vector<int16_t> got = streamDecode(data.data(), data.size(), 100, 4096, kAdpcmNoLimit, &corrupt);
  TEST_ASSERT_TRUE(corrupt);
  TEST_ASSERT_EQUAL_INT(1017, got.size());
  TEST_ASSERT_EQUAL_INT16_ARRAY(ADPCM_VECTOR_DECODED, got.data(), 1017);
}

void test_round_trip_is_close_for_a_smooth_signal() {
  // A slow ramp-and-wave signal with no jumps: ADPCM keeps up with it.
  std::vector<int16_t> in(3000);
  for (size_t i = 0; i < in.size(); ++i) {
    int wave = static_cast<int>((i % 200) < 100 ? (i % 100) * 60 : (100 - (i % 100)) * 60);
    in[i] = static_cast<int16_t>(wave - 3000);
  }
  std::vector<uint8_t> enc(adpcmEncodedSize(in.size(), 512));
  TEST_ASSERT_EQUAL_INT(enc.size(), adpcmEncode(in.data(), in.size(), enc.data(), enc.size(), 512));
  std::vector<int16_t> dec(in.size());
  TEST_ASSERT_EQUAL_INT(in.size(), adpcmDecode(enc.data(), enc.size(), 512, dec.data(), dec.size()));
  long worst = 0;
  for (size_t i = 0; i < in.size(); ++i) {
    long d = in[i] - dec[i];
    if (d < 0) {
      d = -d;
    }
    if (d > worst) {
      worst = d;
    }
  }
  TEST_ASSERT_TRUE_MESSAGE(worst < 600, "decoded signal drifted from the input");
}

void test_full_scale_square_wave_keeps_the_index_in_range() {
  std::vector<int16_t> in(4000);
  for (size_t i = 0; i < in.size(); ++i) {
    in[i] = (i / 3) % 2 == 0 ? 32767 : -32768;
  }
  std::vector<uint8_t> enc(adpcmEncodedSize(in.size(), 512));
  TEST_ASSERT_EQUAL_INT(enc.size(), adpcmEncode(in.data(), in.size(), enc.data(), enc.size(), 512));
  for (size_t b = 0; b < enc.size(); b += 512) {
    TEST_ASSERT_TRUE(enc[b + 2] <= kAdpcmMaxStepIndex);
  }
  std::vector<int16_t> dec(in.size());
  bool corrupt = true;
  TEST_ASSERT_EQUAL_INT(in.size(), adpcmDecode(enc.data(), enc.size(), 512, dec.data(), dec.size(), &corrupt));
  TEST_ASSERT_FALSE(corrupt);
}

void test_other_block_sizes_round_trip_their_first_sample() {
  const uint16_t aligns[] = {8, 64, 256, 1024, 2048};
  for (uint16_t align : aligns) {
    size_t per = adpcmSamplesPerBlock(align);
    std::vector<int16_t> in(per * 2 + 3);
    for (size_t i = 0; i < in.size(); ++i) {
      in[i] = static_cast<int16_t>((static_cast<int>(i) * 37) % 2000 - 1000);
    }
    std::vector<uint8_t> enc(adpcmEncodedSize(in.size(), align));
    TEST_ASSERT_EQUAL_INT(enc.size(), adpcmEncode(in.data(), in.size(), enc.data(), enc.size(), align));
    TEST_ASSERT_EQUAL_INT(3 * align, enc.size());
    std::vector<int16_t> dec(in.size());
    TEST_ASSERT_EQUAL_INT(in.size(), adpcmDecode(enc.data(), enc.size(), align, dec.data(), dec.size()));
    TEST_ASSERT_EQUAL_INT16(in[0], dec[0]);
    TEST_ASSERT_EQUAL_INT16(in[per], dec[per]);
    TEST_ASSERT_EQUAL_INT16(in[per * 2], dec[per * 2]);
  }
}

// -- WAV header --------------------------------------------------------------

namespace {

uint32_t rd32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}
uint16_t rd16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }

}  // namespace

void test_wav_header_fields() {
  uint8_t h[64];
  std::memset(h, 0xEE, sizeof(h));
  size_t n = writeImaWavHeader(h, 16000, 2100, 1536, 512);
  TEST_ASSERT_EQUAL_INT(60, n);
  TEST_ASSERT_EQUAL_INT(kImaWavHeaderBytes, n);
  TEST_ASSERT_EQUAL_MEMORY("RIFF", h, 4);
  TEST_ASSERT_EQUAL_UINT32(52 + 1536, rd32(h + 4));
  TEST_ASSERT_EQUAL_MEMORY("WAVE", h + 8, 4);
  TEST_ASSERT_EQUAL_MEMORY("fmt ", h + 12, 4);
  TEST_ASSERT_EQUAL_UINT32(20, rd32(h + 16));
  TEST_ASSERT_EQUAL_UINT16(0x11, rd16(h + 20));
  TEST_ASSERT_EQUAL_UINT16(1, rd16(h + 22));
  TEST_ASSERT_EQUAL_UINT32(16000, rd32(h + 24));
  // 16000 * 512 / 1017 = 8055 (floor).
  TEST_ASSERT_EQUAL_UINT32(8055, rd32(h + 28));
  TEST_ASSERT_EQUAL_UINT16(512, rd16(h + 32));
  TEST_ASSERT_EQUAL_UINT16(4, rd16(h + 34));
  TEST_ASSERT_EQUAL_UINT16(2, rd16(h + 36));
  TEST_ASSERT_EQUAL_UINT16(1017, rd16(h + 38));
  TEST_ASSERT_EQUAL_MEMORY("fact", h + 40, 4);
  TEST_ASSERT_EQUAL_UINT32(4, rd32(h + 44));
  TEST_ASSERT_EQUAL_UINT32(2100, rd32(h + 48));
  TEST_ASSERT_EQUAL_MEMORY("data", h + 52, 4);
  TEST_ASSERT_EQUAL_UINT32(1536, rd32(h + 56));
  // The bytes after the header are not touched.
  TEST_ASSERT_EQUAL_UINT8(0xEE, h[60]);
}

void test_wav_header_refuses_bad_arguments() {
  uint8_t h[60];
  TEST_ASSERT_EQUAL_INT(0, writeImaWavHeader(nullptr, 16000, 1, 512, 512));
  TEST_ASSERT_EQUAL_INT(0, writeImaWavHeader(h, 16000, 1, 512, 4));
}

void test_wav_header_with_the_upload_limit() {
  // The largest upload the protocol accepts still fits the 32-bit sizes.
  uint8_t h[60];
  TEST_ASSERT_EQUAL_INT(60, writeImaWavHeader(h, PET_UP_SAMPLE_RATE, static_cast<uint32_t>(PET_RECORD_MAX_SECONDS) * PET_UP_SAMPLE_RATE,
                                              PET_UPLOAD_MAX_BYTES - 60, PET_ADPCM_BLOCK_ALIGN));
  TEST_ASSERT_EQUAL_UINT32(PET_UPLOAD_MAX_BYTES - 60, rd32(h + 56));
  TEST_ASSERT_EQUAL_UINT32(PET_UPLOAD_MAX_BYTES - 8, rd32(h + 4));
}

void test_a_full_recording_fits_in_the_upload_limit() {
  // The longest recording (PET_RECORD_MAX_SECONDS at 16 kHz), as whole blocks and the
  // header, is inside the upload cap. At the 120 s decided on 21 October 2026 that is
  // 1,920,000 samples = 1888 blocks = 966,656 bytes + the 60-byte header, about 0.97 MB,
  // inside the 1 MiB cap. (As PCM16 it would be 3.84 MB.)
  size_t samples = static_cast<size_t>(PET_RECORD_MAX_SECONDS) * PET_UP_SAMPLE_RATE;
  size_t bytes = adpcmEncodedSize(samples, PET_ADPCM_BLOCK_ALIGN);
  const size_t blocks = (samples + PET_ADPCM_SAMPLES_PER_BLOCK - 1) / PET_ADPCM_SAMPLES_PER_BLOCK;
  TEST_ASSERT_EQUAL_INT(blocks * PET_ADPCM_BLOCK_ALIGN, bytes);
  TEST_ASSERT_EQUAL_INT(1888 * 512, bytes);
  TEST_ASSERT_TRUE(bytes + kImaWavHeaderBytes <= PET_UPLOAD_MAX_BYTES);
  // The header's 32-bit sizes hold it, and the RIFF size is the file less 8 bytes.
  uint8_t h[60];
  TEST_ASSERT_EQUAL_INT(60, writeImaWavHeader(h, PET_UP_SAMPLE_RATE, static_cast<uint32_t>(samples), static_cast<uint32_t>(bytes),
                                              PET_ADPCM_BLOCK_ALIGN));
  TEST_ASSERT_EQUAL_UINT32(bytes + kImaWavHeaderBytes - 8, rd32(h + 4));
  TEST_ASSERT_EQUAL_UINT32(samples, rd32(h + 48));
  // One second more would be about 8 blocks more than the pet keeps, still inside the
  // cap: the cap on the recording is the protocol's PET_RECORD_MAX_SECONDS, not the cap
  // on bytes.
  TEST_ASSERT_TRUE(adpcmEncodedSize(samples + PET_UP_SAMPLE_RATE, PET_ADPCM_BLOCK_ALIGN) + kImaWavHeaderBytes <= PET_UPLOAD_MAX_BYTES);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_block_sizes);
  RUN_TEST(test_encoder_matches_the_vector);
  RUN_TEST(test_decoder_matches_the_vector);
  RUN_TEST(test_decoder_without_a_sample_count_decodes_the_padding_too);
  RUN_TEST(test_block_by_block_encoding_equals_whole_encoding);
  RUN_TEST(test_headers_carry_the_first_sample_and_the_step_index);
  RUN_TEST(test_the_last_block_is_zero_padded);
  RUN_TEST(test_a_short_block_and_a_single_sample);
  RUN_TEST(test_encoder_refuses_what_it_cannot_do);
  RUN_TEST(test_decoder_flags_a_corrupt_step_index);
  RUN_TEST(test_decoders_refuse_a_block_size_the_format_does_not_have);
  RUN_TEST(test_decoder_stops_at_the_requested_sample_count);
  RUN_TEST(test_streaming_decoder_in_odd_chunk_sizes);
  RUN_TEST(test_streaming_decoder_with_a_small_output_buffer);
  RUN_TEST(test_streaming_decoder_reports_done_and_drops_the_padding);
  RUN_TEST(test_streaming_decoder_skips_a_corrupt_block_and_goes_on);
  RUN_TEST(test_round_trip_is_close_for_a_smooth_signal);
  RUN_TEST(test_full_scale_square_wave_keeps_the_index_in_range);
  RUN_TEST(test_other_block_sizes_round_trip_their_first_sample);
  RUN_TEST(test_wav_header_fields);
  RUN_TEST(test_wav_header_refuses_bad_arguments);
  RUN_TEST(test_wav_header_with_the_upload_limit);
  RUN_TEST(test_a_full_recording_fits_in_the_upload_limit);
  return UNITY_END();
}
