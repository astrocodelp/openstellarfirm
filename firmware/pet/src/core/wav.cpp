#include "wav.h"

#include "adpcm.h"

namespace pet {

namespace {

void put32(uint8_t* p, uint32_t v) {
  p[0] = static_cast<uint8_t>(v & 0xff);
  p[1] = static_cast<uint8_t>((v >> 8) & 0xff);
  p[2] = static_cast<uint8_t>((v >> 16) & 0xff);
  p[3] = static_cast<uint8_t>((v >> 24) & 0xff);
}

void put16(uint8_t* p, uint16_t v) {
  p[0] = static_cast<uint8_t>(v & 0xff);
  p[1] = static_cast<uint8_t>((v >> 8) & 0xff);
}

void putTag(uint8_t* p, const char* tag) {
  for (int i = 0; i < 4; ++i) {
    p[i] = static_cast<uint8_t>(tag[i]);
  }
}

}  // namespace

size_t writeImaWavHeader(uint8_t* out60, uint32_t sampleRate, uint32_t samples, uint32_t dataBytes,
                         uint16_t blockAlign) {
  const size_t perBlock = adpcmSamplesPerBlock(blockAlign);
  if (out60 == nullptr || perBlock == 0) {
    return 0;
  }
  const uint32_t fmtSize = 20;
  putTag(out60 + 0, "RIFF");
  // Everything after the first eight bytes: WAVE, the three chunk headers and
  // bodies, and the data.
  put32(out60 + 4, static_cast<uint32_t>(kImaWavHeaderBytes - 8) + dataBytes);
  putTag(out60 + 8, "WAVE");
  putTag(out60 + 12, "fmt ");
  put32(out60 + 16, fmtSize);
  put16(out60 + 20, 0x11);  // IMA ADPCM
  put16(out60 + 22, 1);     // mono
  put32(out60 + 24, sampleRate);
  put32(out60 + 28, static_cast<uint32_t>((static_cast<uint64_t>(sampleRate) * blockAlign) / perBlock));
  put16(out60 + 32, blockAlign);
  put16(out60 + 34, 4);  // bits per sample
  put16(out60 + 36, 2);  // cbSize
  put16(out60 + 38, static_cast<uint16_t>(perBlock));
  putTag(out60 + 40, "fact");
  put32(out60 + 44, 4);
  put32(out60 + 48, samples);
  putTag(out60 + 52, "data");
  put32(out60 + 56, dataBytes);
  return kImaWavHeaderBytes;
}

}  // namespace pet
