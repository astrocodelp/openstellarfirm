// The voice pack file: the parser must take what the TypeScript package writes
// (src/shared/pets/voice-pack.ts) and refuse anything damaged, since the
// pet downloads it over the air and plays it straight to the speaker.
#include <unity.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "core/adpcm.h"
#include "core/byte_source.h"
#include "core/voice_pack.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

void put16(std::vector<uint8_t>& out, size_t at, uint16_t v) {
  out[at] = static_cast<uint8_t>(v & 0xff);
  out[at + 1] = static_cast<uint8_t>(v >> 8);
}

void put32(std::vector<uint8_t>& out, size_t at, uint32_t v) {
  for (int i = 0; i < 4; ++i) {
    out[at + static_cast<size_t>(i)] = static_cast<uint8_t>((v >> (8 * i)) & 0xff);
  }
}

struct ClipSpec {
  std::string id;
  uint32_t samples;
};

// A pack laid out the way encodeVoicePack does: header, table, then each clip's
// blocks (sine-ish samples, really encoded).
std::vector<uint8_t> makePack(const std::vector<ClipSpec>& clips, uint32_t rate = PET_DOWN_SAMPLE_RATE,
                              uint16_t blockAlign = PET_ADPCM_BLOCK_ALIGN) {
  std::vector<std::vector<uint8_t>> blocks;
  for (const ClipSpec& clip : clips) {
    std::vector<int16_t> pcm(clip.samples);
    for (uint32_t i = 0; i < clip.samples; ++i) {
      pcm[i] = static_cast<int16_t>((i % 64) * 200 - 6400);
    }
    const size_t bytes = adpcmEncodedSize(clip.samples, blockAlign);
    std::vector<uint8_t> enc(bytes);
    if (clip.samples > 0) {
      adpcmEncode(pcm.data(), clip.samples, enc.data(), enc.size(), blockAlign);
    }
    blocks.push_back(enc);
  }
  const size_t tableEnd = PET_VOICE_PACK_HEADER_BYTES + PET_VOICE_PACK_ENTRY_BYTES * clips.size();
  size_t total = tableEnd;
  for (const auto& b : blocks) {
    total += b.size();
  }
  std::vector<uint8_t> out(total, 0);
  std::memcpy(out.data(), PET_VOICE_PACK_MAGIC, 4);
  put16(out, 4, PET_VOICE_PACK_VERSION);
  put16(out, 6, static_cast<uint16_t>(clips.size()));
  put32(out, 8, rate);
  put16(out, 12, blockAlign);
  size_t offset = tableEnd;
  for (size_t i = 0; i < clips.size(); ++i) {
    const size_t at = PET_VOICE_PACK_HEADER_BYTES + PET_VOICE_PACK_ENTRY_BYTES * i;
    std::memcpy(out.data() + at, clips[i].id.data(), clips[i].id.size());
    put32(out, at + 24, static_cast<uint32_t>(offset));
    put32(out, at + 28, static_cast<uint32_t>(blocks[i].size()));
    put32(out, at + 32, clips[i].samples);
    if (!blocks[i].empty()) {
      std::memcpy(out.data() + offset, blocks[i].data(), blocks[i].size());
    }
    offset += blocks[i].size();
  }
  return out;
}

bool loads(const std::vector<uint8_t>& bytes, PackIndex* into = nullptr) {
  MemorySource source(bytes.data(), bytes.size());
  PackIndex local;
  PackIndex& index = into != nullptr ? *into : local;
  return index.load(source);
}

}  // namespace

void test_a_valid_pack_loads_and_clips_are_found_by_id() {
  const auto bytes = makePack({{"setup-join", 3000}, {"char-K", 900}, {"saved", 1017}});
  PackIndex index;
  TEST_ASSERT_TRUE(loads(bytes, &index));
  TEST_ASSERT_EQUAL_INT(3, index.count());
  const PackEntry* join = index.find("setup-join");
  TEST_ASSERT_NOT_NULL(join);
  TEST_ASSERT_EQUAL_UINT32(3000, join->samples);
  TEST_ASSERT_EQUAL_UINT32(3 * 512, join->length);
  TEST_ASSERT_EQUAL_UINT32(PET_VOICE_PACK_HEADER_BYTES + PET_VOICE_PACK_ENTRY_BYTES * 3, join->offset);
  const PackEntry* saved = index.find("saved");
  TEST_ASSERT_NOT_NULL(saved);
  TEST_ASSERT_EQUAL_UINT32(512, saved->length);
  TEST_ASSERT_NULL(index.find("hello"));
  TEST_ASSERT_NULL(index.find(""));
  TEST_ASSERT_NULL(index.find(nullptr));
}

void test_a_clip_reads_back_as_the_samples_that_were_encoded() {
  const auto bytes = makePack({{"a", 2500}});
  MemorySource source(bytes.data(), bytes.size());
  PackIndex index;
  TEST_ASSERT_TRUE(index.load(source));
  const PackEntry* a = index.find("a");
  TEST_ASSERT_NOT_NULL(a);
  std::vector<uint8_t> blocks(a->length);
  TEST_ASSERT_EQUAL_INT(a->length, source.read(a->offset, blocks.data(), blocks.size()));
  std::vector<int16_t> pcm(a->samples + 2000);
  const size_t n = adpcmDecode(blocks.data(), blocks.size(), PET_ADPCM_BLOCK_ALIGN, pcm.data(), a->samples);
  TEST_ASSERT_EQUAL_INT(2500, n);
}

void test_a_twenty_four_character_id_has_no_terminator() {
  const std::string id(24, 'x');
  const auto bytes = makePack({{id, 100}});
  PackIndex index;
  TEST_ASSERT_TRUE(loads(bytes, &index));
  TEST_ASSERT_NOT_NULL(index.find(id.c_str()));
  TEST_ASSERT_EQUAL_INT(24, std::strlen(index.at(0).id));
}

void test_an_empty_clip_is_allowed() {
  const auto bytes = makePack({{"empty", 0}, {"after", 500}});
  PackIndex index;
  TEST_ASSERT_TRUE(loads(bytes, &index));
  TEST_ASSERT_EQUAL_UINT32(0, index.find("empty")->length);
}

void test_the_header_is_checked() {
  auto bytes = makePack({{"a", 100}});
  auto bad = bytes;
  bad[0] = 'X';
  TEST_ASSERT_FALSE(loads(bad));
  bad = bytes;
  put16(bad, 4, 2);  // version
  TEST_ASSERT_FALSE(loads(bad));
  bad = bytes;
  put32(bad, 8, 16000);  // sample rate
  TEST_ASSERT_FALSE(loads(bad));
  bad = bytes;
  put16(bad, 12, 256);  // block align
  TEST_ASSERT_FALSE(loads(bad));
  bad = bytes;
  put16(bad, 6, 0);  // no clips
  TEST_ASSERT_FALSE(loads(bad));
  bad = bytes;
  put16(bad, 6, static_cast<uint16_t>(kPackMaxClips + 1));
  TEST_ASSERT_FALSE(loads(bad));
  // Too short for a header, and nothing at all.
  bad.assign(bytes.begin(), bytes.begin() + 10);
  TEST_ASSERT_FALSE(loads(bad));
  bad.clear();
  TEST_ASSERT_FALSE(loads(bad));
}

void test_a_table_or_clip_that_runs_past_the_end_is_refused() {
  auto bytes = makePack({{"a", 3000}});
  // A download cut short loses the end of the last clip.
  std::vector<uint8_t> cut(bytes.begin(), bytes.end() - 1);
  TEST_ASSERT_FALSE(loads(cut));
  // The table itself is cut.
  std::vector<uint8_t> cutTable(bytes.begin(), bytes.begin() + PET_VOICE_PACK_HEADER_BYTES + 10);
  TEST_ASSERT_FALSE(loads(cutTable));
  // A clip that points back into the table.
  auto early = bytes;
  put32(early, PET_VOICE_PACK_HEADER_BYTES + 24, 8);
  TEST_ASSERT_FALSE(loads(early));
  // An offset plus length that wraps a 32-bit number.
  auto wrap = bytes;
  put32(wrap, PET_VOICE_PACK_HEADER_BYTES + 24, 0xFFFFFF00u);
  put32(wrap, PET_VOICE_PACK_HEADER_BYTES + 28, 0x200u);
  TEST_ASSERT_FALSE(loads(wrap));
}

void test_a_clip_that_is_not_whole_blocks_or_claims_too_many_samples_is_refused() {
  auto bytes = makePack({{"a", 3000}});
  auto odd = bytes;
  put32(odd, PET_VOICE_PACK_HEADER_BYTES + 28, 3 * 512 - 1);
  TEST_ASSERT_FALSE(loads(odd));
  auto many = bytes;
  put32(many, PET_VOICE_PACK_HEADER_BYTES + 32, 3 * PET_ADPCM_SAMPLES_PER_BLOCK + 1);
  TEST_ASSERT_FALSE(loads(many));
  // Exactly what the blocks hold is fine.
  auto exact = bytes;
  put32(exact, PET_VOICE_PACK_HEADER_BYTES + 32, 3 * PET_ADPCM_SAMPLES_PER_BLOCK);
  TEST_ASSERT_TRUE(loads(exact));
}

void test_clip_ids_must_be_printable_and_padded_with_nuls() {
  auto bytes = makePack({{"abc", 100}});
  auto empty = bytes;
  empty[PET_VOICE_PACK_HEADER_BYTES] = 0;
  empty[PET_VOICE_PACK_HEADER_BYTES + 1] = 0;
  empty[PET_VOICE_PACK_HEADER_BYTES + 2] = 0;
  TEST_ASSERT_FALSE(loads(empty));
  auto control = bytes;
  control[PET_VOICE_PACK_HEADER_BYTES + 1] = 0x07;
  TEST_ASSERT_FALSE(loads(control));
  auto space = bytes;
  space[PET_VOICE_PACK_HEADER_BYTES + 1] = ' ';
  TEST_ASSERT_FALSE(loads(space));
  auto high = bytes;
  high[PET_VOICE_PACK_HEADER_BYTES + 1] = 0xC3;
  TEST_ASSERT_FALSE(loads(high));
  // Text after the first NUL is not an id.
  auto junk = bytes;
  junk[PET_VOICE_PACK_HEADER_BYTES + 10] = 'z';
  TEST_ASSERT_FALSE(loads(junk));
}

void test_a_failed_load_leaves_the_index_empty() {
  auto bytes = makePack({{"a", 100}});
  PackIndex index;
  TEST_ASSERT_TRUE(loads(bytes, &index));
  TEST_ASSERT_EQUAL_INT(1, index.count());
  bytes[0] = 'Z';
  TEST_ASSERT_FALSE(loads(bytes, &index));
  TEST_ASSERT_EQUAL_INT(0, index.count());
  TEST_ASSERT_NULL(index.find("a"));
}

void test_a_full_pack_of_every_line_loads() {
  std::vector<ClipSpec> clips;
  for (int i = 0; i < PET_LINE_COUNT; ++i) {
    clips.push_back({PET_LINE_IDS[i], 200});
  }
  PackIndex index;
  TEST_ASSERT_TRUE(loads(makePack(clips), &index));
  TEST_ASSERT_EQUAL_INT(PET_LINE_COUNT, index.count());
  for (int i = 0; i < PET_BOOT_LINE_COUNT; ++i) {
    TEST_ASSERT_NOT_NULL(index.find(PET_BOOT_LINE_IDS[i]));
  }
}

void test_memory_source_reads_pieces_and_stops_at_the_end() {
  const uint8_t data[] = {1, 2, 3, 4, 5};
  MemorySource source(data, sizeof(data));
  TEST_ASSERT_EQUAL_INT(5, source.size());
  uint8_t out[8] = {0};
  TEST_ASSERT_EQUAL_INT(3, source.read(0, out, 3));
  TEST_ASSERT_EQUAL_UINT8(3, out[2]);
  TEST_ASSERT_EQUAL_INT(2, source.read(3, out, 8));
  TEST_ASSERT_EQUAL_UINT8(5, out[1]);
  TEST_ASSERT_EQUAL_INT(0, source.read(5, out, 8));
  TEST_ASSERT_EQUAL_INT(0, source.read(100, out, 8));
  TEST_ASSERT_EQUAL_INT(0, source.read(0, nullptr, 8));
  MemorySource none(nullptr, 0);
  TEST_ASSERT_EQUAL_INT(0, none.read(0, out, 8));
}

void test_only_the_six_voices_are_voice_ids() {
  for (int i = 0; i < PET_VOICE_COUNT; ++i) {
    TEST_ASSERT_TRUE(isVoiceId(PET_VOICE_IDS[i]));
  }
  TEST_ASSERT_FALSE(isVoiceId(nullptr));
  TEST_ASSERT_FALSE(isVoiceId(""));
  TEST_ASSERT_FALSE(isVoiceId("Talia"));
  TEST_ASSERT_FALSE(isVoiceId("talia "));
  TEST_ASSERT_FALSE(isVoiceId("../talia"));
  TEST_ASSERT_FALSE(isVoiceId("talia/../../x"));
  TEST_ASSERT_FALSE(isVoiceId("talia.sfvp"));
  TEST_ASSERT_FALSE(isVoiceId("nobody"));
}

void test_pack_paths_are_made_only_for_voices() {
  char path[64];
  TEST_ASSERT_TRUE(packPath("talia", false, path, sizeof(path)));
  TEST_ASSERT_EQUAL_STRING("/voice/talia.sfvp", path);
  TEST_ASSERT_TRUE(packPath("darian", true, path, sizeof(path)));
  TEST_ASSERT_EQUAL_STRING("/voice/darian.sfvp.tmp", path);
  TEST_ASSERT_TRUE(packUrlPath("maisie", path, sizeof(path)));
  TEST_ASSERT_EQUAL_STRING("/pets/voice/maisie.sfvp", path);
  TEST_ASSERT_FALSE(packPath("../etc", false, path, sizeof(path)));
  TEST_ASSERT_FALSE(packUrlPath("x/y", path, sizeof(path)));
  TEST_ASSERT_FALSE(packPath(nullptr, false, path, sizeof(path)));
  // Too small a buffer is refused rather than cut.
  char tiny[10];
  TEST_ASSERT_FALSE(packPath("talia", false, tiny, sizeof(tiny)));
  TEST_ASSERT_FALSE(packUrlPath("talia", tiny, sizeof(tiny)));
  TEST_ASSERT_FALSE(packPath("talia", false, path, 0));
}

void test_every_alphabet_character_has_its_clip_and_nothing_else_does() {
  const char* alphabet = PET_CODE_ALPHABET;
  TEST_ASSERT_EQUAL_INT(31, std::strlen(alphabet));
  for (size_t i = 0; alphabet[i] != '\0'; ++i) {
    const char* clip = charClipId(alphabet[i]);
    TEST_ASSERT_NOT_NULL(clip);
    const std::string expected = std::string("char-") + alphabet[i];
    TEST_ASSERT_EQUAL_STRING(expected.c_str(), clip);
    // The clip is one the pack is known to hold.
    bool inLines = false;
    for (int k = 0; k < PET_BOOT_LINE_COUNT; ++k) {
      if (std::strcmp(PET_BOOT_LINE_IDS[k], clip) == 0) {
        inLines = true;
      }
    }
    TEST_ASSERT_TRUE(inLines);
  }
  TEST_ASSERT_NULL(charClipId('-'));
  TEST_ASSERT_NULL(charClipId(' '));
  TEST_ASSERT_NULL(charClipId('I'));
  TEST_ASSERT_NULL(charClipId('L'));
  TEST_ASSERT_NULL(charClipId('O'));
  TEST_ASSERT_NULL(charClipId('0'));
  TEST_ASSERT_NULL(charClipId('1'));
  TEST_ASSERT_NULL(charClipId('a'));
  TEST_ASSERT_NULL(charClipId('\0'));
}

void test_a_confirm_code_is_spelled_one_clip_per_character() {
  const char* clips[16];
  size_t n = spellCodeClips("ABCD-EFGH", clips, 16);
  TEST_ASSERT_EQUAL_INT(8, n);
  TEST_ASSERT_EQUAL_STRING("char-A", clips[0]);
  TEST_ASSERT_EQUAL_STRING("char-D", clips[3]);
  TEST_ASSERT_EQUAL_STRING("char-E", clips[4]);
  TEST_ASSERT_EQUAL_STRING("char-H", clips[7]);
  n = spellCodeClips("K7QX-2PA9", clips, 16);
  TEST_ASSERT_EQUAL_INT(8, n);
  TEST_ASSERT_EQUAL_STRING("char-7", clips[1]);
  TEST_ASSERT_EQUAL_STRING("char-9", clips[7]);
  // The cap is respected, and junk is skipped.
  n = spellCodeClips("ABCD-EFGH", clips, 3);
  TEST_ASSERT_EQUAL_INT(3, n);
  TEST_ASSERT_EQUAL_INT(0, spellCodeClips("---", clips, 16));
  TEST_ASSERT_EQUAL_INT(0, spellCodeClips("", clips, 16));
  TEST_ASSERT_EQUAL_INT(0, spellCodeClips(nullptr, clips, 16));
  TEST_ASSERT_EQUAL_INT(0, spellCodeClips("ABCD", nullptr, 16));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_a_valid_pack_loads_and_clips_are_found_by_id);
  RUN_TEST(test_a_clip_reads_back_as_the_samples_that_were_encoded);
  RUN_TEST(test_a_twenty_four_character_id_has_no_terminator);
  RUN_TEST(test_an_empty_clip_is_allowed);
  RUN_TEST(test_the_header_is_checked);
  RUN_TEST(test_a_table_or_clip_that_runs_past_the_end_is_refused);
  RUN_TEST(test_a_clip_that_is_not_whole_blocks_or_claims_too_many_samples_is_refused);
  RUN_TEST(test_clip_ids_must_be_printable_and_padded_with_nuls);
  RUN_TEST(test_a_failed_load_leaves_the_index_empty);
  RUN_TEST(test_a_full_pack_of_every_line_loads);
  RUN_TEST(test_memory_source_reads_pieces_and_stops_at_the_end);
  RUN_TEST(test_only_the_six_voices_are_voice_ids);
  RUN_TEST(test_pack_paths_are_made_only_for_voices);
  RUN_TEST(test_every_alphabet_character_has_its_clip_and_nothing_else_does);
  RUN_TEST(test_a_confirm_code_is_spelled_one_clip_per_character);
  return UNITY_END();
}
