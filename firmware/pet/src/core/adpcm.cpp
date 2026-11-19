#include "adpcm.h"

#include <cstring>

namespace pet {

namespace {

// The standard IMA step sizes and index moves; the same as adpcm.ts.
const int kStepTable[89] = {
    7,     8,     9,     10,    11,    12,    13,    14,    16,    17,    19,    21,    23,    25,    28,
    31,    34,    37,    41,    45,    50,    55,    60,    66,    73,    80,    88,    97,    107,   118,
    130,   143,   157,   173,   190,   209,   230,   253,   279,   307,   337,   371,   408,   449,   494,
    544,   598,   658,   724,   796,   876,   963,   1060,  1166,  1282,  1411,  1552,  1707,  1878,  2066,
    2272,  2499,  2749,  3024,  3327,  3660,  4026,  4428,  4871,  5358,  5894,  6484,  7132,  7845,  8630,
    9493,  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767};

const int kIndexTable[16] = {-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8};

int clamp16(int v) { return v > 32767 ? 32767 : (v < -32768 ? -32768 : v); }
int clampIndex(int v) { return v < 0 ? 0 : (v > kAdpcmMaxStepIndex ? kAdpcmMaxStepIndex : v); }

bool blockAlignOk(uint16_t blockAlign) {
  return blockAlign >= kAdpcmMinBlockAlign && blockAlign <= kAdpcmMaxBlockAlign;
}

// One decoded step: how the predictor moves for a 4-bit code at a step index.
// The decoder adds the step's shifted terms the way adpcm.ts does, so the two
// agree to the last bit.
void decodeCode(int code, int& predictor, int& index) {
  const int step = kStepTable[index];
  int delta = step >> 3;
  if (code & 4) {
    delta += step;
  }
  if (code & 2) {
    delta += step >> 1;
  }
  if (code & 1) {
    delta += step >> 2;
  }
  predictor = clamp16((code & 8) ? predictor - delta : predictor + delta);
  index = clampIndex(index + kIndexTable[code]);
}

}  // namespace

size_t adpcmSamplesPerBlock(uint16_t blockAlign) {
  if (!blockAlignOk(blockAlign)) {
    return 0;
  }
  return (static_cast<size_t>(blockAlign) - kAdpcmHeaderBytes) * 2 + 1;
}

size_t adpcmEncodedSize(size_t samples, uint16_t blockAlign) {
  const size_t perBlock = adpcmSamplesPerBlock(blockAlign);
  if (perBlock == 0) {
    return 0;
  }
  return ((samples + perBlock - 1) / perBlock) * blockAlign;
}

size_t adpcmEncodeBlock(const int16_t* samples, size_t n, AdpcmState& state, uint8_t* out, uint16_t blockAlign) {
  const size_t perBlock = adpcmSamplesPerBlock(blockAlign);
  if (perBlock == 0 || n == 0 || n > perBlock || samples == nullptr || out == nullptr) {
    return 0;
  }
  // Zero first: the nibbles are OR-ed in, and the tail of a short block must be
  // zero padding.
  std::memset(out, 0, blockAlign);
  int predictor = samples[0];
  int index = state.index > kAdpcmMaxStepIndex ? kAdpcmMaxStepIndex : state.index;
  out[0] = static_cast<uint8_t>(predictor & 0xff);
  out[1] = static_cast<uint8_t>((predictor >> 8) & 0xff);
  out[2] = static_cast<uint8_t>(index);
  out[3] = 0;
  for (size_t i = 1; i < n; ++i) {
    int step = kStepTable[index];
    int diff = samples[i] - predictor;
    int code = 0;
    if (diff < 0) {
      code = 8;
      diff = -diff;
    }
    int delta = step >> 3;
    if (diff >= step) {
      code |= 4;
      diff -= step;
      delta += step;
    }
    step >>= 1;
    if (diff >= step) {
      code |= 2;
      diff -= step;
      delta += step;
    }
    step >>= 1;
    if (diff >= step) {
      code |= 1;
      delta += step;
    }
    predictor = clamp16((code & 8) ? predictor - delta : predictor + delta);
    index = clampIndex(index + kIndexTable[code]);
    // Two codes to a byte, the earlier one in the low nibble.
    const size_t k = i - 1;
    const size_t at = kAdpcmHeaderBytes + (k >> 1);
    out[at] = static_cast<uint8_t>(out[at] | ((k % 2 == 0) ? code : (code << 4)));
  }
  state.predictor = static_cast<int16_t>(predictor);
  state.index = static_cast<uint8_t>(index);
  return blockAlign;
}

size_t adpcmEncode(const int16_t* samples, size_t n, uint8_t* out, size_t outCap, uint16_t blockAlign) {
  const size_t perBlock = adpcmSamplesPerBlock(blockAlign);
  if (perBlock == 0 || n == 0 || samples == nullptr || out == nullptr) {
    return 0;
  }
  if (outCap < adpcmEncodedSize(n, blockAlign)) {
    return 0;
  }
  AdpcmState state;
  size_t written = 0;
  for (size_t first = 0; first < n; first += perBlock) {
    const size_t count = (n - first < perBlock) ? (n - first) : perBlock;
    written += adpcmEncodeBlock(samples + first, count, state, out + written, blockAlign);
  }
  return written;
}

size_t adpcmDecode(const uint8_t* data, size_t len, uint16_t blockAlign, int16_t* out, size_t maxSamples,
                   bool* corrupt) {
  if (corrupt != nullptr) {
    *corrupt = false;
  }
  if (adpcmSamplesPerBlock(blockAlign) == 0 || data == nullptr || out == nullptr) {
    return 0;
  }
  size_t written = 0;
  for (size_t base = 0; base + kAdpcmHeaderBytes <= len && written < maxSamples; base += blockAlign) {
    int predictor = static_cast<int16_t>(static_cast<uint16_t>(data[base] | (data[base + 1] << 8)));
    int index = data[base + 2];
    if (index > kAdpcmMaxStepIndex) {
      if (corrupt != nullptr) {
        *corrupt = true;
      }
      break;
    }
    out[written++] = static_cast<int16_t>(predictor);
    const size_t end = (base + blockAlign < len) ? base + blockAlign : len;
    for (size_t at = base + kAdpcmHeaderBytes; at < end && written < maxSamples; ++at) {
      const int byte = data[at];
      decodeCode(byte & 15, predictor, index);
      out[written++] = static_cast<int16_t>(predictor);
      if (written >= maxSamples) {
        break;
      }
      decodeCode(byte >> 4, predictor, index);
      out[written++] = static_cast<int16_t>(predictor);
    }
  }
  return written;
}

AdpcmBlockDecoder::AdpcmBlockDecoder(uint16_t blockAlign) : blockAlign_(blockAlign) {}

void AdpcmBlockDecoder::reset(size_t sampleLimit) {
  pos_ = 0;
  std::memset(header_, 0, sizeof(header_));
  predictor_ = 0;
  index_ = 0;
  skipBlock_ = false;
  corrupt_ = false;
  limit_ = sampleLimit;
  emitted_ = 0;
}

size_t AdpcmBlockDecoder::decode(const uint8_t* data, size_t len, size_t& consumed, int16_t* out, size_t outCap) {
  consumed = 0;
  if (!blockAlignOk(blockAlign_) || data == nullptr) {
    // A decoder made with a size the format does not accept takes everything
    // and says nothing, and reports itself corrupt.
    corrupt_ = true;
    consumed = len;
    return 0;
  }
  size_t written = 0;
  size_t i = 0;
  while (i < len) {
    const bool limitHit = emitted_ >= limit_;
    if (pos_ < kAdpcmHeaderBytes) {
      // The fourth header byte completes the header and yields the block's
      // first sample, so it needs one free slot.
      if (pos_ == kAdpcmHeaderBytes - 1 && !limitHit && written + 1 > outCap) {
        break;
      }
      header_[pos_] = data[i];
      ++pos_;
      ++i;
      if (pos_ == kAdpcmHeaderBytes) {
        predictor_ = static_cast<int16_t>(static_cast<uint16_t>(header_[0] | (header_[1] << 8)));
        index_ = header_[2];
        if (index_ > kAdpcmMaxStepIndex) {
          corrupt_ = true;
          skipBlock_ = true;
        } else if (!limitHit) {
          out[written++] = static_cast<int16_t>(predictor_);
          ++emitted_;
        }
      }
    } else if (skipBlock_ || limitHit) {
      ++pos_;
      ++i;
    } else {
      const size_t room = limit_ - emitted_;
      const size_t need = room < 2 ? room : 2;
      if (written + need > outCap) {
        break;
      }
      const int byte = data[i];
      decodeCode(byte & 15, predictor_, index_);
      out[written++] = static_cast<int16_t>(predictor_);
      ++emitted_;
      if (need == 2) {
        decodeCode(byte >> 4, predictor_, index_);
        out[written++] = static_cast<int16_t>(predictor_);
        ++emitted_;
      }
      ++pos_;
      ++i;
    }
    if (pos_ == blockAlign_) {
      pos_ = 0;
      skipBlock_ = false;
    }
  }
  consumed = i;
  return written;
}

}  // namespace pet
