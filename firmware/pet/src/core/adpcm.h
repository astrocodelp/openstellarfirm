#pragma once

// IMA-ADPCM for the desk pet, bit-identical to src/shared/pets/adpcm.ts
// (the tests check the encoder and decoder against the generated vector in
// include/generated/adpcm_vectors.h). Mono only.
//
// Block layout: a 4-byte header (the block's first sample as a little-endian
// int16 predictor, the step index 0..88, a zero byte) and then 4-bit codes, the
// earlier code in the low nibble. A block holds (blockAlign - 4) * 2 + 1
// samples: the header's own sample, then two per data byte. The step index
// carries on from one block to the next; the predictor restarts at each block's
// first sample. The last block is padded with zero bytes, so the caller keeps
// the real sample count (a WAV file's `fact` chunk, a voice pack entry).

#include <cstddef>
#include <cstdint>

namespace pet {

constexpr size_t kAdpcmHeaderBytes = 4;
constexpr uint8_t kAdpcmMaxStepIndex = 88;
// The smallest and largest block the format accepts (the TS package agrees).
constexpr uint16_t kAdpcmMinBlockAlign = 8;
constexpr uint16_t kAdpcmMaxBlockAlign = 8192;
constexpr size_t kAdpcmNoLimit = static_cast<size_t>(-1);

// What an encoder remembers between blocks. `index` is the part that carries on;
// `predictor` is the last block's final predictor, kept for inspection only.
struct AdpcmState {
  int16_t predictor = 0;
  uint8_t index = 0;
};

// Samples one block of `blockAlign` bytes holds, or 0 when blockAlign is not a
// size the format accepts.
size_t adpcmSamplesPerBlock(uint16_t blockAlign);

// Bytes `samples` samples encode to (whole blocks, the last one padded), or 0
// for an unusable blockAlign.
size_t adpcmEncodedSize(size_t samples, uint16_t blockAlign);

// Encodes up to adpcmSamplesPerBlock() samples (n >= 1) as one block of exactly
// `blockAlign` bytes into `out`, which the caller makes at least that long.
// Updates `state.index` so the next block carries on. Returns blockAlign, or 0
// when n is 0 or too big or blockAlign is unusable. This is what a recording
// encodes with as the blocks fill.
size_t adpcmEncodeBlock(const int16_t* samples, size_t n, AdpcmState& state, uint8_t* out, uint16_t blockAlign);

// Encodes all n samples into `out` (outCap bytes). Returns the bytes written, or
// 0 when n is 0, blockAlign is unusable or outCap is smaller than
// adpcmEncodedSize(n, blockAlign) (nothing is written then).
size_t adpcmEncode(const int16_t* samples, size_t n, uint8_t* out, size_t outCap, uint16_t blockAlign);

// Decodes whole or partial blocks, up to maxSamples samples. Returns the samples
// written. A block whose step index is above 88 is corrupt: decoding stops
// there and *corrupt (when given) is set.
size_t adpcmDecode(const uint8_t* data, size_t len, uint16_t blockAlign, int16_t* out, size_t maxSamples,
                   bool* corrupt = nullptr);

// A decoder that takes the bytes in any chunking, for the voice pack player
// (a clip is read from flash in pieces).
//
//   AdpcmBlockDecoder dec(512);
//   dec.reset(clipSamples);            // stop after the clip's real samples
//   size_t used = 0;
//   n = dec.decode(chunk, chunkLen, used, pcm, pcmCap);   // used < chunkLen: pcm was full
//
// `decode` stops when `out` is full, so the caller drains it and calls again
// with the rest; `outCap` must be at least 2. Bytes of a block that come after
// the sample limit (the zero padding) are consumed and give nothing.
class AdpcmBlockDecoder {
 public:
  explicit AdpcmBlockDecoder(uint16_t blockAlign = 512);

  // Starts a new stream. `sampleLimit` is how many samples are real.
  void reset(size_t sampleLimit = kAdpcmNoLimit);

  // Consumes bytes from `data` (len of them) and writes samples to `out`
  // (outCap of them). `consumed` says how many input bytes were used. Returns
  // the samples written.
  size_t decode(const uint8_t* data, size_t len, size_t& consumed, int16_t* out, size_t outCap);

  // True once the sample limit has been reached.
  bool done() const { return emitted_ >= limit_; }
  // True if a block with a bad step index was met (its samples were skipped).
  bool corrupt() const { return corrupt_; }
  size_t samplesEmitted() const { return emitted_; }

 private:
  uint16_t blockAlign_;
  uint16_t pos_ = 0;  // byte position inside the current block
  uint8_t header_[kAdpcmHeaderBytes] = {0, 0, 0, 0};
  int predictor_ = 0;
  int index_ = 0;
  bool skipBlock_ = false;
  bool corrupt_ = false;
  size_t limit_ = kAdpcmNoLimit;
  size_t emitted_ = 0;
};

}  // namespace pet
