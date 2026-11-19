#include "voice_pack.h"

#include <cstdio>
#include <cstring>

#include "adpcm.h"

namespace pet {

namespace {

uint16_t le16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }

uint32_t le32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}

// The 31 characters of the code alphabet, each with its clip, in alphabet order.
// The test pins that "char-" + the character is the clip.
const char* const kCharClips[] = {
    PET_LINE_CHAR_A, PET_LINE_CHAR_B, PET_LINE_CHAR_C, PET_LINE_CHAR_D, PET_LINE_CHAR_E, PET_LINE_CHAR_F,
    PET_LINE_CHAR_G, PET_LINE_CHAR_H, PET_LINE_CHAR_J, PET_LINE_CHAR_K, PET_LINE_CHAR_M, PET_LINE_CHAR_N,
    PET_LINE_CHAR_P, PET_LINE_CHAR_Q, PET_LINE_CHAR_R, PET_LINE_CHAR_S, PET_LINE_CHAR_T, PET_LINE_CHAR_U,
    PET_LINE_CHAR_V, PET_LINE_CHAR_W, PET_LINE_CHAR_X, PET_LINE_CHAR_Y, PET_LINE_CHAR_Z, PET_LINE_CHAR_2,
    PET_LINE_CHAR_3, PET_LINE_CHAR_4, PET_LINE_CHAR_5, PET_LINE_CHAR_6, PET_LINE_CHAR_7, PET_LINE_CHAR_8,
    PET_LINE_CHAR_9,
};

}  // namespace

bool PackIndex::load(ByteSource& source) {
  entries_.clear();

  uint8_t header[PET_VOICE_PACK_HEADER_BYTES];
  if (source.read(0, header, sizeof(header)) != sizeof(header)) {
    return false;
  }
  if (std::memcmp(header, PET_VOICE_PACK_MAGIC, 4) != 0 || le16(header + 4) != PET_VOICE_PACK_VERSION) {
    return false;
  }
  const size_t count = le16(header + 6);
  const uint32_t sampleRate = le32(header + 8);
  const uint16_t blockAlign = le16(header + 12);
  if (count == 0 || count > kPackMaxClips || sampleRate != PET_DOWN_SAMPLE_RATE || blockAlign != PET_ADPCM_BLOCK_ALIGN) {
    return false;
  }

  const uint64_t fileSize = source.size();
  const uint64_t tableEnd = PET_VOICE_PACK_HEADER_BYTES + static_cast<uint64_t>(PET_VOICE_PACK_ENTRY_BYTES) * count;
  if (tableEnd > fileSize) {
    return false;
  }

  const size_t perBlock = adpcmSamplesPerBlock(blockAlign);
  std::vector<PackEntry> entries;
  entries.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    uint8_t raw[PET_VOICE_PACK_ENTRY_BYTES];
    const size_t at = PET_VOICE_PACK_HEADER_BYTES + PET_VOICE_PACK_ENTRY_BYTES * i;
    if (source.read(at, raw, sizeof(raw)) != sizeof(raw)) {
      return false;
    }
    PackEntry entry;
    size_t idLength = 0;
    while (idLength < kClipIdChars && raw[idLength] != 0) {
      const uint8_t c = raw[idLength];
      if (c < 0x21 || c > 0x7e) {
        return false;
      }
      entry.id[idLength] = static_cast<char>(c);
      ++idLength;
    }
    // After the first NUL the rest of the field must be NUL too.
    for (size_t k = idLength; k < kClipIdChars; ++k) {
      if (raw[k] != 0) {
        return false;
      }
    }
    if (idLength == 0) {
      return false;
    }
    entry.id[idLength] = '\0';
    entry.offset = le32(raw + kClipIdChars);
    entry.length = le32(raw + kClipIdChars + 4);
    entry.samples = le32(raw + kClipIdChars + 8);

    if (entry.offset < tableEnd || static_cast<uint64_t>(entry.offset) + entry.length > fileSize) {
      return false;
    }
    if (entry.length % blockAlign != 0) {
      return false;
    }
    const uint64_t room = static_cast<uint64_t>(entry.length / blockAlign) * perBlock;
    if (entry.samples > room) {
      return false;
    }
    entries.push_back(entry);
  }
  entries_ = std::move(entries);
  return true;
}

const PackEntry* PackIndex::find(const char* id) const {
  if (id == nullptr) {
    return nullptr;
  }
  for (const PackEntry& entry : entries_) {
    if (std::strcmp(entry.id, id) == 0) {
      return &entry;
    }
  }
  return nullptr;
}

bool isVoiceId(const char* voice) {
  if (voice == nullptr) {
    return false;
  }
  for (int i = 0; i < PET_VOICE_COUNT; ++i) {
    if (std::strcmp(voice, PET_VOICE_IDS[i]) == 0) {
      return true;
    }
  }
  return false;
}

bool packPath(const char* voice, bool tmp, char* out, size_t cap) {
  if (!isVoiceId(voice) || out == nullptr || cap == 0) {
    return false;
  }
  const int n = std::snprintf(out, cap, tmp ? "/voice/%s.sfvp.tmp" : "/voice/%s.sfvp", voice);
  return n > 0 && static_cast<size_t>(n) < cap;
}

bool packUrlPath(const char* voice, char* out, size_t cap) {
  if (!isVoiceId(voice) || out == nullptr || cap == 0) {
    return false;
  }
  const int n = std::snprintf(out, cap, "/pets/voice/%s.sfvp", voice);
  return n > 0 && static_cast<size_t>(n) < cap;
}

const char* charClipId(char c) {
  const char* alphabet = PET_CODE_ALPHABET;
  for (size_t i = 0; alphabet[i] != '\0'; ++i) {
    if (alphabet[i] == c) {
      return kCharClips[i];
    }
  }
  return nullptr;
}

size_t spellCodeClips(const char* code, const char** out, size_t cap) {
  if (code == nullptr || out == nullptr) {
    return 0;
  }
  size_t n = 0;
  for (size_t i = 0; code[i] != '\0' && n < cap; ++i) {
    const char* clip = charClipId(code[i]);
    if (clip != nullptr) {
      out[n++] = clip;
    }
  }
  return n;
}

}  // namespace pet
