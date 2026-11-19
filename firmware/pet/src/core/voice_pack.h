#pragma once

// The voice pack file (.sfvp) the pet plays its saved lines from, and the small
// rules around it. Pure: the bytes come in through a ByteSource, so the flash
// reader, the boot pack compiled into the firmware and the tests all use the
// same parser. The format is src/shared/pets/voice-pack.ts:
//
//   header, 16 bytes   "SFVP", u16 version (1), u16 clip count, u32 sample rate
//                      (22050), u16 block align (512), u16 reserved
//   clip table         36 bytes a clip: char id[24] (NUL padded, no terminator
//                      when it fills all 24), u32 offset from the file start,
//                      u32 length in bytes, u32 samples
//   clips              raw IMA-ADPCM blocks of 512 bytes, no WAV header
//
// All numbers are little-endian. A pack this firmware does not fully understand
// is refused whole, so a half-downloaded or damaged file never plays noise.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "byte_source.h"
#include "generated/protocol.h"

namespace pet {

constexpr size_t kPackMaxClips = 160;
constexpr size_t kClipIdChars = PET_VOICE_PACK_ID_BYTES;

struct PackEntry {
  char id[kClipIdChars + 1] = {0};  // always NUL terminated here
  uint32_t offset = 0;
  uint32_t length = 0;
  uint32_t samples = 0;
};

class PackIndex {
 public:
  // Reads the header and the clip table. False, with an empty index, when the
  // source is not a pack this firmware plays: wrong magic or version, another
  // sample rate or block size, a table or clip that runs past the end, a clip
  // id that is empty or not printable, a clip whose length is not whole blocks
  // or whose sample count does not fit its blocks.
  bool load(ByteSource& source);

  void clear() { entries_.clear(); }

  // The first clip with this id, or nullptr.
  const PackEntry* find(const char* id) const;

  size_t count() const { return entries_.size(); }
  const PackEntry& at(size_t index) const { return entries_[index]; }

 private:
  std::vector<PackEntry> entries_;
};

// True for one of the six voices (PET_VOICE_IDS). A voice id from the server is
// put in a file name and a URL path, so nothing else is ever accepted.
bool isVoiceId(const char* voice);

// "/voice/<voice>.sfvp", or with `tmp` "/voice/<voice>.sfvp.tmp" (the download
// is written there and renamed once it checks out). False for a name that is
// not a voice or an `out` too small.
bool packPath(const char* voice, bool tmp, char* out, size_t cap);

// "/pets/voice/<voice>.sfvp": where OpenStellarFirm serves the pack, relative to
// the address the pet talks to.
bool packUrlPath(const char* voice, char* out, size_t cap);

// The clip that says one character of a confirm code ("char-K"), or nullptr
// for a character that is not in the code alphabet (the dash, a space).
const char* charClipId(char c);

// The clips that spell `code` out, one per character of the alphabet, skipping
// the rest. Returns how many were written to out[0..cap).
size_t spellCodeClips(const char* code, const char** out, size_t cap);

}  // namespace pet
