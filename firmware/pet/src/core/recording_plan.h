#pragma once

// How big a recording can be, and how many recordings the pet can hold at once.
// Pure arithmetic over the protocol's limits, so it is unit tested; audio/mic.cpp
// does the allocating.
//
// The longest recording is PET_RECORD_MAX_SECONDS (120) at 16 kHz. As PCM16 that is
// 3.84 MB, four times the ADPCM and, in two slots, nearly all of the Nano ESP32's 8 MB
// of PSRAM, so the microphone encodes it to IMA-ADPCM as the samples arrive, block by
// block, straight into the slot. A slot is then the WAV header and at most 1888 blocks
// of 512 bytes: 966,716 bytes, which also fits the server's upload cap
// (PET_UPLOAD_MAX_BYTES, 1 MiB). The slot is the file that is uploaded or saved as it
// stands, so nothing is converted or copied later.
//
// Two slots let the next recording start while the last one is still going up or
// being saved. Both together are about 1.9 MB, which leaves the rest of the PSRAM
// (TLS buffers, the answer's stream, JSON) its room; when the PSRAM is shorter than
// that the pet makes one slot and a recording waits for the last one to be done.

#include <cstddef>
#include <cstdint>

#include "adpcm.h"
#include "generated/protocol.h"
#include "wav.h"

namespace pet {

// The most samples a recording keeps: exactly PET_RECORD_MAX_SECONDS, so the server
// never answers "too long" for a capped one.
constexpr uint32_t kRecordMaxSamples = static_cast<uint32_t>(PET_RECORD_MAX_SECONDS) * static_cast<uint32_t>(PET_UP_SAMPLE_RATE);

// The blocks of ADPCM that hold them.
constexpr uint32_t kRecordMaxBlocks =
    (kRecordMaxSamples + PET_ADPCM_SAMPLES_PER_BLOCK - 1) / PET_ADPCM_SAMPLES_PER_BLOCK;

// One slot: the WAV header and the blocks.
constexpr size_t kRecordSlotBytes = kImaWavHeaderBytes + static_cast<size_t>(kRecordMaxBlocks) * PET_ADPCM_BLOCK_ALIGN;

static_assert(kRecordSlotBytes <= PET_UPLOAD_MAX_BYTES,
              "the longest recording, as the WAV the pet uploads, fits the upload cap");

// PSRAM kept for everything that is not a recording when the second slot is made.
constexpr size_t kPsramReserveBytes = 1024u * 1024u;

// How many slots to make when `freePsramBytes` of PSRAM are free: 0 when not even one
// fits, 1 when a second would leave less than kPsramReserveBytes, else 2.
int recordingSlotsFor(size_t freePsramBytes);

// How many samples a buffer of `bufferBytes` bytes keeps: whole blocks after the
// header, never more than PET_RECORD_MAX_SECONDS, and never a file the server would
// refuse (the buffer counts as at most PET_UPLOAD_MAX_BYTES). 0 for a buffer too small
// for the header and one block.
uint32_t recordingSamplesFor(size_t bufferBytes);

// The number of ADPCM blocks those samples take.
uint32_t recordingBlocksFor(uint32_t samples);

}  // namespace pet
