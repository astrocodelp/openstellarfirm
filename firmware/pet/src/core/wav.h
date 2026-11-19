#pragma once

// The 60-byte header of the IMA-ADPCM WAV file a pet uploads
// (src/shared/pets/adpcm.ts, imaAdpcmWav): RIFF, a 20-byte `fmt `
// chunk (format 0x11, mono, 4 bits, cbSize 2, samples per block), a `fact`
// chunk with the real sample count, and the `data` chunk's header. The encoded
// blocks follow it.

#include <cstddef>
#include <cstdint>

namespace pet {

constexpr size_t kImaWavHeaderBytes = 60;

// Writes the header into `out60` (at least 60 bytes) and returns 60, or 0 when
// `out60` is null or blockAlign is not a size the format accepts. `samples` is
// the real sample count, `dataBytes` the length of the encoded blocks.
size_t writeImaWavHeader(uint8_t* out60, uint32_t sampleRate, uint32_t samples, uint32_t dataBytes,
                         uint16_t blockAlign);

}  // namespace pet
