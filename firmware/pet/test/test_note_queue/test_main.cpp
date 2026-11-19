// Saved notes: the queue over an in-memory store. Rule 6: a note leaves the
// store only through confirm().
#include <unity.h>

#include <algorithm>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "core/byte_source.h"
#include "core/note_queue.h"
#include "core/recording_plan.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

// A store that keeps notes in memory, with a size limit and a switch to make the
// next write fail.
class MemoryStore : public NoteStore {
 public:
  explicit MemoryStore(size_t capacity = 4 * 1024 * 1024) : capacity_(capacity) {}

  bool list(std::vector<std::string>& names) override {
    if (failList) {
      return false;
    }
    names.clear();
    // The order a file system gives is not sorted; use a reversed one on purpose.
    for (auto it = notes_.rbegin(); it != notes_.rend(); ++it) {
      names.push_back(it->first);
    }
    return true;
  }

  bool writeNote(const std::string& name, const uint8_t* wavBytes, size_t len, const std::string& metaJson) override {
    if (failWrites || notes_.count(name) != 0) {
      return false;
    }
    Note n;
    n.audio.assign(wavBytes, wavBytes + len);
    n.meta = metaJson;
    notes_[name] = n;
    ++writes;
    return true;
  }

  bool readMeta(const std::string& name, std::string& metaJson) override {
    auto it = notes_.find(name);
    if (it == notes_.end()) {
      return false;
    }
    metaJson = it->second.meta;
    return true;
  }

  bool writeMeta(const std::string& name, const std::string& metaJson) override {
    auto it = notes_.find(name);
    if (failMetaWrites || it == notes_.end()) {
      return false;
    }
    it->second.meta = metaJson;
    ++metaWrites;
    return true;
  }

  bool remove(const std::string& name) override {
    if (failRemove) {
      return false;
    }
    return notes_.erase(name) == 1;
  }

  size_t freeBytes() override {
    size_t used = 0;
    for (const auto& kv : notes_) {
      used += kv.second.audio.size() + kv.second.meta.size();
    }
    return used >= capacity_ ? 0 : capacity_ - used;
  }

  long sizeOf(const std::string& name) override {
    auto it = notes_.find(name);
    return it == notes_.end() ? -1 : static_cast<long>(it->second.audio.size());
  }

  size_t readNote(const std::string& name, size_t offset, uint8_t* out, size_t len) override {
    auto it = notes_.find(name);
    if (it == notes_.end() || offset >= it->second.audio.size()) {
      return 0;
    }
    size_t n = std::min(len, it->second.audio.size() - offset);
    std::copy(it->second.audio.begin() + static_cast<long>(offset), it->second.audio.begin() + static_cast<long>(offset + n), out);
    return n;
  }

  void putRaw(const std::string& name, const std::string& meta, size_t audioBytes = 10) {
    Note n;
    n.audio.assign(audioBytes, 0x5A);
    n.meta = meta;
    notes_[name] = n;
  }

  bool has(const std::string& name) const { return notes_.count(name) != 0; }
  size_t size() const { return notes_.size(); }

  bool failWrites = false;
  bool failMetaWrites = false;
  bool failRemove = false;
  bool failList = false;
  int writes = 0;
  int metaWrites = 0;

 private:
  struct Note {
    std::vector<uint8_t> audio;
    std::string meta;
  };
  std::map<std::string, Note> notes_;
  size_t capacity_;
};

std::vector<uint8_t> audio(size_t n, uint8_t fill = 0x42) { return std::vector<uint8_t>(n, fill); }

const char* kTurn1 = "11111111-1111-4111-8111-111111111111";
const char* kTurn2 = "22222222-2222-4222-8222-222222222222";
const char* kTurn3 = "33333333-3333-4333-8333-333333333333";
const char* kIso = "2026-10-21T08:15:30Z";

}  // namespace

void test_names_are_eight_digits() {
  TEST_ASSERT_EQUAL_STRING("00000000", NoteQueue::nameFor(0).c_str());
  TEST_ASSERT_EQUAL_STRING("00000042", NoteQueue::nameFor(42).c_str());
  TEST_ASSERT_EQUAL_STRING("99999999", NoteQueue::nameFor(99999999).c_str());
  uint32_t seq = 7;
  TEST_ASSERT_TRUE(NoteQueue::parseName("00000042", seq));
  TEST_ASSERT_EQUAL_UINT32(42, seq);
  TEST_ASSERT_FALSE(NoteQueue::parseName("42", seq));
  TEST_ASSERT_FALSE(NoteQueue::parseName("0000004x", seq));
  TEST_ASSERT_FALSE(NoteQueue::parseName("000000421", seq));
  TEST_ASSERT_FALSE(NoteQueue::parseName("", seq));
  TEST_ASSERT_FALSE(NoteQueue::parseName("0000 042", seq));
  TEST_ASSERT_EQUAL_UINT32(42, seq);
}

void test_add_saves_a_note_with_its_record() {
  MemoryStore store;
  NoteQueue q(store, 42);
  auto wav = audio(1000);
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, wav.data(), wav.size()));
  TEST_ASSERT_EQUAL_INT(1, q.count());
  TEST_ASSERT_TRUE(store.has("00000042"));
  TEST_ASSERT_EQUAL_UINT32(43, q.nextSeq());
  std::string meta;
  TEST_ASSERT_TRUE(store.readMeta("00000042", meta));
  TEST_ASSERT_EQUAL_STRING("{\"turn\":\"11111111-1111-4111-8111-111111111111\",\"recordedAt\":\"2026-10-21T08:15:30Z\"}", meta.c_str());
  uint8_t back[1000];
  TEST_ASSERT_EQUAL_INT(1000, store.readNote("00000042", 0, back, sizeof(back)));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(wav.data(), back, 1000);
}

void test_oldest_is_the_lowest_sequence_number() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(500);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  q.add(kTurn2, "", wav.data(), wav.size());
  q.add(kTurn3, kIso, wav.data(), 321);
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_STRING("00000000", info.name.c_str());
  TEST_ASSERT_EQUAL_UINT32(0, info.seq);
  TEST_ASSERT_EQUAL_STRING(kTurn1, info.turn.c_str());
  TEST_ASSERT_EQUAL_STRING(kIso, info.recordedAt.c_str());
  TEST_ASSERT_EQUAL_INT(500, info.bytes);
  // Confirm the first; the next one is the second, with no recording time.
  TEST_ASSERT_TRUE(q.confirm(info.name));
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_STRING("00000001", info.name.c_str());
  TEST_ASSERT_EQUAL_STRING(kTurn2, info.turn.c_str());
  TEST_ASSERT_EQUAL_STRING("", info.recordedAt.c_str());
  TEST_ASSERT_TRUE(q.confirm(info.name));
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_INT(321, info.bytes);
  TEST_ASSERT_TRUE(q.confirm(info.name));
  TEST_ASSERT_FALSE(q.oldest(info));
  TEST_ASSERT_TRUE(q.empty());
}

void test_a_note_stays_until_it_is_confirmed() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  NoteInfo info;
  // Asking for the oldest, again and again, deletes nothing (a retry after a
  // timeout must find the same note with the same turn id).
  for (int i = 0; i < 5; ++i) {
    TEST_ASSERT_TRUE(q.oldest(info));
    TEST_ASSERT_EQUAL_STRING(kTurn1, info.turn.c_str());
  }
  TEST_ASSERT_EQUAL_INT(1, q.count());
  TEST_ASSERT_TRUE(store.has("00000000"));
  TEST_ASSERT_TRUE(q.confirm("00000000"));
  TEST_ASSERT_FALSE(store.has("00000000"));
  TEST_ASSERT_EQUAL_INT(0, q.count());
}

void test_confirm_of_an_unknown_note_changes_nothing() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  TEST_ASSERT_FALSE(q.confirm("00000009"));
  TEST_ASSERT_FALSE(q.confirm("nope"));
  TEST_ASSERT_FALSE(q.confirm(""));
  TEST_ASSERT_EQUAL_INT(1, q.count());
  TEST_ASSERT_TRUE(store.has("00000000"));
}

void test_a_failed_removal_keeps_the_note_for_a_retry() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  store.failRemove = true;
  TEST_ASSERT_FALSE(q.confirm("00000000"));
  TEST_ASSERT_EQUAL_INT(1, q.count());
  store.failRemove = false;
  TEST_ASSERT_TRUE(q.confirm("00000000"));
  TEST_ASSERT_EQUAL_INT(0, q.count());
}

void test_at_most_fifty_notes() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(200);
  for (int i = 0; i < PET_SAVED_NOTES_MAX; ++i) {
    TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, wav.data(), wav.size()));
  }
  TEST_ASSERT_EQUAL_INT(50, q.count());
  TEST_ASSERT_EQUAL_INT(50, PET_SAVED_NOTES_MAX);
  TEST_ASSERT_EQUAL_INT(AddResult::Full, q.add(kTurn2, kIso, wav.data(), wav.size()));
  TEST_ASSERT_EQUAL_INT(50, q.count());
  TEST_ASSERT_EQUAL_INT(50, store.size());
  TEST_ASSERT_EQUAL_UINT32(50, q.nextSeq());
  // Confirming one makes room again, and the new note gets the next number.
  TEST_ASSERT_TRUE(q.confirm("00000000"));
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn3, kIso, wav.data(), wav.size()));
  TEST_ASSERT_TRUE(store.has("00000050"));
}

void test_refuses_when_the_reserve_would_not_be_left() {
  // 200 KB of room; the reserve is 64 KB.
  MemoryStore store(200 * 1024);
  NoteQueue q(store, 0);
  auto big = audio(100 * 1024);
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, big.data(), big.size()));
  // About 100 KB free now; another 100 KB would leave less than 64 KB.
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn2, kIso, big.data(), big.size()));
  auto small = audio(30 * 1024);
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn2, kIso, small.data(), small.size()));
  TEST_ASSERT_EQUAL_INT(2, q.count());
  TEST_ASSERT_EQUAL_UINT32(2, q.nextSeq());
}

void test_exact_reserve_edge() {
  const size_t reserve = NoteQueue::kReserveBytes;
  // Free space is exactly len + reserve: allowed. One byte less: refused.
  {
    MemoryStore store(10000 + reserve + 100);  // the record takes 80 to 90 bytes; leave slack
    NoteQueue q(store, 0);
    auto a = audio(10000);
    TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, a.data(), a.size()));
  }
  {
    MemoryStore store(10000 + reserve);  // exactly the reserve is left: allowed
    NoteQueue q(store, 0);
    auto a = audio(10000);
    TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, a.data(), a.size()));
  }
  {
    MemoryStore store(10000 + reserve - 1);
    NoteQueue q(store, 0);
    auto a = audio(10000);
    TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn1, kIso, a.data(), a.size()));
    TEST_ASSERT_EQUAL_INT(0, q.count());
    TEST_ASSERT_EQUAL_UINT32(0, q.nextSeq());
  }
  {
    // A note bigger than all the free space cannot underflow the check.
    MemoryStore store(1000);
    NoteQueue q(store, 0);
    auto a = audio(5000);
    TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn1, kIso, a.data(), a.size()));
  }
}

// A saved note can be a whole two-minute recording, 966,716 bytes. The reserve stays
// the same; when the flash has no room for a note and the reserve the queue says
// NoSpace, which the state machine turns into "my memory is full".
void test_notes_of_two_minutes_fill_the_flash_and_then_say_it_is_full() {
  // About what the file system partition holds: 9.4 MB.
  MemoryStore store(9400000);
  NoteQueue q(store, 0);
  auto note = audio(kRecordSlotBytes);
  int saved = 0;
  while (q.add(std::string("turn-") + std::to_string(saved), kIso, note.data(), note.size()) == AddResult::Saved) {
    ++saved;
    TEST_ASSERT_TRUE(saved < 20);
  }
  // Nine whole recordings fit (8.7 MB); a tenth would not leave the reserve.
  TEST_ASSERT_EQUAL_INT(9, saved);
  TEST_ASSERT_EQUAL_INT(9, q.count());
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn2, kIso, note.data(), note.size()));
  TEST_ASSERT_TRUE(store.freeBytes() >= NoteQueue::kReserveBytes);
  // The refusal used no number and kept every note.
  TEST_ASSERT_EQUAL_UINT32(9, q.nextSeq());
  // Shorter notes still go in, down to the reserve.
  auto brief = audio(60 * 1024);
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn2, kIso, brief.data(), brief.size()));
}

// The voice pack shares the flash: the biggest pack the pet will download is 3 MiB
// (kPackMaxBytes in net/net_worker.cpp), and what is left holds six whole recordings.
void test_six_whole_recordings_fit_beside_the_biggest_voice_pack() {
  MemoryStore store(9400000 - 3u * 1024u * 1024u);
  NoteQueue q(store, 0);
  auto note = audio(kRecordSlotBytes);
  int saved = 0;
  while (q.add(std::string("turn-") + std::to_string(saved), kIso, note.data(), note.size()) == AddResult::Saved) {
    ++saved;
    TEST_ASSERT_TRUE(saved < 20);
  }
  TEST_ASSERT_EQUAL_INT(6, saved);
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn2, kIso, note.data(), note.size()));
}

void test_a_note_of_the_largest_upload_is_read_back_whole_in_pieces() {
  MemoryStore store;
  NoteQueue q(store, 0);
  std::vector<uint8_t> wav(PET_UPLOAD_MAX_BYTES);
  for (size_t i = 0; i < wav.size(); ++i) {
    wav[i] = static_cast<uint8_t>((i * 31) ^ (i >> 9));
  }
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, wav.data(), wav.size()));
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_UINT32(PET_UPLOAD_MAX_BYTES, info.bytes);
  NoteSource source(store, info.name, info.bytes);
  TEST_ASSERT_EQUAL_UINT32(PET_UPLOAD_MAX_BYTES, source.size());
  std::vector<uint8_t> chunk(4096);
  size_t offset = 0;
  for (;;) {
    const size_t n = source.read(offset, chunk.data(), chunk.size());
    if (n == 0) {
      break;
    }
    TEST_ASSERT_EQUAL_MEMORY(wav.data() + offset, chunk.data(), n);
    offset += n;
  }
  TEST_ASSERT_EQUAL_UINT32(PET_UPLOAD_MAX_BYTES, offset);
}

void test_a_failed_write_uses_no_number_and_leaves_no_note() {
  MemoryStore store;
  NoteQueue q(store, 5);
  auto wav = audio(100);
  store.failWrites = true;
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn1, kIso, wav.data(), wav.size()));
  TEST_ASSERT_EQUAL_INT(0, q.count());
  TEST_ASSERT_EQUAL_UINT32(5, q.nextSeq());
  store.failWrites = false;
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, wav.data(), wav.size()));
  TEST_ASSERT_TRUE(store.has("00000005"));
}

void test_nothing_to_store_is_not_saved() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn1, kIso, nullptr, 100));
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add(kTurn1, kIso, wav.data(), 0));
  TEST_ASSERT_EQUAL_INT(AddResult::NoSpace, q.add("", kIso, wav.data(), wav.size()));
  TEST_ASSERT_EQUAL_INT(0, q.count());
  TEST_ASSERT_EQUAL_INT(0, store.size());
}

void test_load_finds_the_notes_after_a_reboot_in_order() {
  MemoryStore store;
  {
    NoteQueue q(store, 0);
    auto wav = audio(100);
    q.add(kTurn1, kIso, wav.data(), wav.size());
    q.add(kTurn2, kIso, wav.data(), wav.size());
    q.add(kTurn3, kIso, wav.data(), wav.size());
    TEST_ASSERT_TRUE(q.confirm("00000000"));
  }
  // A new queue, with a counter that was not saved (0): it learns from the notes.
  NoteQueue again(store, 0);
  TEST_ASSERT_EQUAL_INT(0, again.count());
  TEST_ASSERT_TRUE(again.load());
  TEST_ASSERT_EQUAL_INT(2, again.count());
  TEST_ASSERT_EQUAL_UINT32(3, again.nextSeq());
  NoteInfo info;
  TEST_ASSERT_TRUE(again.oldest(info));
  TEST_ASSERT_EQUAL_STRING("00000001", info.name.c_str());
  TEST_ASSERT_EQUAL_STRING(kTurn2, info.turn.c_str());
  // The saved counter, when it is ahead, is kept: numbers of confirmed notes are not reused.
  NoteQueue ahead(store, 10);
  TEST_ASSERT_TRUE(ahead.load());
  TEST_ASSERT_EQUAL_UINT32(10, ahead.nextSeq());
}

void test_load_ignores_files_that_are_not_notes() {
  MemoryStore store;
  store.putRaw("00000003", "{\"turn\":\"t\",\"recordedAt\":\"\"}");
  store.putRaw("junk", "{}");
  store.putRaw("0000000a", "{}");
  store.putRaw("000000004", "{}");
  NoteQueue q(store, 0);
  TEST_ASSERT_TRUE(q.load());
  TEST_ASSERT_EQUAL_INT(1, q.count());
  TEST_ASSERT_EQUAL_UINT32(4, q.nextSeq());
}

void test_load_reports_a_store_that_cannot_be_listed() {
  MemoryStore store;
  store.failList = true;
  NoteQueue q(store, 3);
  TEST_ASSERT_FALSE(q.load());
  TEST_ASSERT_EQUAL_INT(0, q.count());
  TEST_ASSERT_EQUAL_UINT32(3, q.nextSeq());
}

void test_a_note_with_a_broken_record_is_still_handed_out() {
  MemoryStore store;
  store.putRaw("00000000", "this is not json", 77);
  store.putRaw("00000001", "{\"turn\":\"\",\"recordedAt\":\"x\"}", 5);
  store.putRaw("00000002", "{\"recordedAt\":\"x\"}", 5);
  NoteQueue q(store, 0);
  TEST_ASSERT_TRUE(q.load());
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  // The caller sees an empty turn id and makes a new one; the audio is not lost.
  TEST_ASSERT_EQUAL_STRING("", info.turn.c_str());
  TEST_ASSERT_EQUAL_INT(77, info.bytes);
  TEST_ASSERT_TRUE(q.confirm(info.name));
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_STRING("", info.turn.c_str());
  TEST_ASSERT_TRUE(q.confirm(info.name));
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_STRING("", info.turn.c_str());
}

void test_meta_round_trip_and_escaping() {
  const std::string turn = "a\"b\\c\nd";
  const std::string at = "2026-10-21T08:15:30Z";
  const std::string json = NoteQueue::makeMeta(turn, at);
  TEST_ASSERT_TRUE(json.find('\n') == std::string::npos);
  std::string t2;
  std::string a2;
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(json, t2, a2));
  TEST_ASSERT_EQUAL_STRING(turn.c_str(), t2.c_str());
  TEST_ASSERT_EQUAL_STRING(at.c_str(), a2.c_str());
  // No recording time.
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(NoteQueue::makeMeta("x", ""), t2, a2));
  TEST_ASSERT_EQUAL_STRING("x", t2.c_str());
  TEST_ASSERT_EQUAL_STRING("", a2.c_str());
}

void test_meta_parser_reads_other_layouts_and_refuses_junk() {
  std::string turn;
  std::string at;
  // Whitespace, key order, an extra key.
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(" { \"recordedAt\" : \"R\" , \"extra\":\"e\", \"turn\" : \"T\" } ", turn, at));
  TEST_ASSERT_EQUAL_STRING("T", turn.c_str());
  TEST_ASSERT_EQUAL_STRING("R", at.c_str());
  // A \u escape for a plain character, and a slash escape.
  TEST_ASSERT_TRUE(NoteQueue::parseMeta("{\"turn\":\"a\\u0041\\/b\"}", turn, at));
  TEST_ASSERT_EQUAL_STRING("aA/b", turn.c_str());
  // A key name inside a value is not a key.
  TEST_ASSERT_TRUE(NoteQueue::parseMeta("{\"recordedAt\":\"\\\"turn\\\":\\\"evil\\\"\",\"turn\":\"real\"}", turn, at));
  TEST_ASSERT_EQUAL_STRING("real", turn.c_str());

  TEST_ASSERT_FALSE(NoteQueue::parseMeta("", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{}", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("[]", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\"", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":5}", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\" \"a\":\"b\"}", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\\q\"}", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"\\u00e9\"}", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\",}", turn, at));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"unterminated", turn, at));
  TEST_ASSERT_EQUAL_STRING("", turn.c_str());
}

void test_meta_escapes_control_characters_and_reads_them_back() {
  const std::string turn = std::string("a\x01") + "b\x1f" + "c\t\r";
  const std::string json = NoteQueue::makeMeta(turn, "x");
  TEST_ASSERT_TRUE(json.find("\\u0001") != std::string::npos);
  TEST_ASSERT_TRUE(json.find("\\u001f") != std::string::npos);
  std::string t2;
  std::string a2;
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(json, t2, a2));
  TEST_ASSERT_EQUAL_STRING(turn.c_str(), t2.c_str());
  // Upper and lower case hex digits and every short escape.
  TEST_ASSERT_TRUE(NoteQueue::parseMeta("{\"turn\":\"\\u004A\\u004a\\n\\t\\r\\b\\f\"}", t2, a2));
  TEST_ASSERT_EQUAL_STRING("JJ\n\t\r\b\f", t2.c_str());
}

void test_meta_parser_refuses_broken_escapes() {
  std::string t;
  std::string a;
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"\\u00zz\"}", t, a));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"\\u00\"}", t, a));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"\\u00G1\"}", t, a));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"abc\\", t, a));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\" \"x\"}", t, a));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{turn:\"x\"}", t, a));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\"", t, a));
}

void test_the_sequence_does_not_run_past_eight_digits() {
  MemoryStore store;
  NoteQueue q(store, NoteQueue::kMaxSeq);
  auto wav = audio(100);
  TEST_ASSERT_EQUAL_INT(AddResult::Saved, q.add(kTurn1, kIso, wav.data(), wav.size()));
  TEST_ASSERT_TRUE(store.has("99999999"));
  TEST_ASSERT_EQUAL_INT(AddResult::Full, q.add(kTurn2, kIso, wav.data(), wav.size()));
  TEST_ASSERT_EQUAL_INT(1, store.size());
}

void test_streaming_a_note_back_in_pieces() {
  MemoryStore store;
  NoteQueue q(store, 0);
  std::vector<uint8_t> wav(1500);
  for (size_t i = 0; i < wav.size(); ++i) {
    wav[i] = static_cast<uint8_t>(i * 7);
  }
  q.add(kTurn1, kIso, wav.data(), wav.size());
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  std::vector<uint8_t> got;
  uint8_t chunk[512];
  size_t offset = 0;
  while (offset < info.bytes) {
    size_t n = store.readNote(info.name, offset, chunk, sizeof(chunk));
    TEST_ASSERT_TRUE(n > 0);
    got.insert(got.end(), chunk, chunk + n);
    offset += n;
  }
  TEST_ASSERT_EQUAL_INT(1500, got.size());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(wav.data(), got.data(), 1500);
}

void test_next_goes_on_past_a_note_that_stays() {
  MemoryStore store;
  NoteQueue q(store, 5);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());  // 5
  q.add(kTurn2, kIso, wav.data(), wav.size());  // 6
  q.add(kTurn3, kIso, wav.data(), wav.size());  // 7
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_UINT32(5, info.seq);
  // The first one is refused by the server and is left alone: the sync asks for
  // the one after it, and nothing was deleted.
  TEST_ASSERT_TRUE(q.next(info.seq, info));
  TEST_ASSERT_EQUAL_UINT32(6, info.seq);
  TEST_ASSERT_EQUAL_STRING(kTurn2, info.turn.c_str());
  TEST_ASSERT_EQUAL_STRING("00000006", info.name.c_str());
  TEST_ASSERT_EQUAL_INT(100, info.bytes);
  TEST_ASSERT_TRUE(q.next(6, info));
  TEST_ASSERT_EQUAL_UINT32(7, info.seq);
  TEST_ASSERT_FALSE(q.next(7, info));
  TEST_ASSERT_FALSE(q.next(100, info));
  TEST_ASSERT_EQUAL_INT(3, q.count());
  TEST_ASSERT_TRUE(store.has("00000005"));
}

void test_next_from_before_the_first_note_is_the_oldest() {
  MemoryStore store;
  NoteQueue q(store, 10);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  NoteInfo info;
  TEST_ASSERT_TRUE(q.next(0, info));
  TEST_ASSERT_EQUAL_UINT32(10, info.seq);
  NoteQueue empty(store, 0);
  TEST_ASSERT_FALSE(empty.next(0, info));
  TEST_ASSERT_EQUAL_STRING("", info.name.c_str());
}

void test_next_skips_over_a_gap_left_by_a_confirmed_note() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());  // 0
  q.add(kTurn2, kIso, wav.data(), wav.size());  // 1
  q.add(kTurn3, kIso, wav.data(), wav.size());  // 2
  TEST_ASSERT_TRUE(q.confirm("00000001"));
  NoteInfo info;
  TEST_ASSERT_TRUE(q.next(0, info));
  TEST_ASSERT_EQUAL_UINT32(2, info.seq);
}

void test_a_note_source_streams_the_audio_in_pieces() {
  MemoryStore store;
  NoteQueue q(store, 0);
  std::vector<uint8_t> wav(1500);
  for (size_t i = 0; i < wav.size(); ++i) {
    wav[i] = static_cast<uint8_t>(i * 7);
  }
  q.add(kTurn1, kIso, wav.data(), wav.size());
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  NoteSource source(store, info.name, info.bytes);
  TEST_ASSERT_EQUAL_INT(1500, source.size());
  std::vector<uint8_t> got;
  uint8_t chunk[400];
  size_t offset = 0;
  for (;;) {
    const size_t n = source.read(offset, chunk, sizeof(chunk));
    if (n == 0) {
      break;
    }
    got.insert(got.end(), chunk, chunk + n);
    offset += n;
  }
  TEST_ASSERT_EQUAL_INT(1500, got.size());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(wav.data(), got.data(), 1500);
  TEST_ASSERT_EQUAL_INT(0, source.read(1500, chunk, sizeof(chunk)));
}

// -- Notes OpenStellarFirm refused ---------------------------------------------------------

void test_a_refused_note_stays_but_is_no_longer_pending() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());  // 0
  q.add(kTurn2, kIso, wav.data(), wav.size());  // 1
  TEST_ASSERT_EQUAL_INT(2, q.pending());
  TEST_ASSERT_TRUE(q.markRefused("00000000", 422));
  // Rule 6: nothing is deleted on a refusal.
  TEST_ASSERT_TRUE(store.has("00000000"));
  TEST_ASSERT_EQUAL_INT(2, q.count());
  TEST_ASSERT_EQUAL_INT(1, q.pending());
  TEST_ASSERT_TRUE(q.isRefused(0));
  TEST_ASSERT_FALSE(q.isRefused(1));
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_EQUAL_INT(422, info.refused);
  TEST_ASSERT_EQUAL_STRING(kTurn1, info.turn.c_str());  // the same turn id, so nothing else changes
  TEST_ASSERT_EQUAL_STRING(kIso, info.recordedAt.c_str());
  TEST_ASSERT_TRUE(q.next(0, info));
  TEST_ASSERT_EQUAL_INT(0, info.refused);
}

void test_a_refusal_survives_a_restart() {
  MemoryStore store;
  {
    NoteQueue q(store, 0);
    auto wav = audio(100);
    q.add(kTurn1, kIso, wav.data(), wav.size());
    q.add(kTurn2, "", wav.data(), wav.size());
    TEST_ASSERT_TRUE(q.markRefused("00000001", 415));
  }
  NoteQueue again(store, 0);
  TEST_ASSERT_TRUE(again.load());
  TEST_ASSERT_EQUAL_INT(2, again.count());
  TEST_ASSERT_EQUAL_INT(1, again.pending());
  TEST_ASSERT_FALSE(again.isRefused(0));
  TEST_ASSERT_TRUE(again.isRefused(1));
  NoteInfo info;
  TEST_ASSERT_TRUE(again.next(0, info));
  TEST_ASSERT_EQUAL_INT(415, info.refused);
  TEST_ASSERT_EQUAL_STRING(kTurn2, info.turn.c_str());
}

void test_a_refusal_that_cannot_be_written_still_holds_for_this_run() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  store.failMetaWrites = true;
  TEST_ASSERT_FALSE(q.markRefused("00000000", 422));
  TEST_ASSERT_TRUE(q.isRefused(0));
  TEST_ASSERT_EQUAL_INT(0, q.pending());
  NoteInfo info;
  TEST_ASSERT_TRUE(q.oldest(info));
  TEST_ASSERT_TRUE(info.refused != 0);
  // The old record is untouched, so after a restart the note is tried once more.
  NoteQueue again(store, 0);
  again.load();
  TEST_ASSERT_EQUAL_INT(1, again.pending());
}

void test_a_note_with_an_unreadable_record_is_not_rewritten() {
  MemoryStore store;
  store.putRaw("00000003", "{broken");
  NoteQueue q(store, 0);
  q.load();
  TEST_ASSERT_FALSE(q.markRefused("00000003", 422));
  TEST_ASSERT_EQUAL_INT(0, store.metaWrites);  // never a record with a made-up turn id
  TEST_ASSERT_TRUE(q.isRefused(3));            // but not sent again in this run
}

void test_marking_something_that_is_not_a_note_does_nothing() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  TEST_ASSERT_FALSE(q.markRefused("00000009", 422));
  TEST_ASSERT_FALSE(q.markRefused("junk", 422));
  TEST_ASSERT_FALSE(q.markRefused("00000000", 0));
  TEST_ASSERT_EQUAL_INT(1, q.pending());
}

void test_a_refused_note_that_is_confirmed_later_leaves_the_count_right() {
  MemoryStore store;
  NoteQueue q(store, 0);
  auto wav = audio(100);
  q.add(kTurn1, kIso, wav.data(), wav.size());
  q.add(kTurn2, kIso, wav.data(), wav.size());
  q.markRefused("00000000", 422);
  TEST_ASSERT_TRUE(q.confirm("00000000"));  // e.g. a newer firmware that learns the server accepts it
  TEST_ASSERT_EQUAL_INT(1, q.count());
  TEST_ASSERT_EQUAL_INT(1, q.pending());
  TEST_ASSERT_FALSE(q.isRefused(0));
}

void test_the_record_with_a_refusal_round_trips() {
  const std::string json = NoteQueue::makeMeta("t", "r", 422);
  TEST_ASSERT_TRUE(json.find("\"refused\":422") != std::string::npos);
  NoteMeta meta;
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(json, meta));
  TEST_ASSERT_EQUAL_STRING("t", meta.turn.c_str());
  TEST_ASSERT_EQUAL_STRING("r", meta.recordedAt.c_str());
  TEST_ASSERT_EQUAL_INT(422, meta.refused);
  // No refusal: the field is not written, so an older firmware reads the record too.
  TEST_ASSERT_TRUE(NoteQueue::makeMeta("t", "r").find("refused") == std::string::npos);
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(NoteQueue::makeMeta("t", "r"), meta));
  TEST_ASSERT_EQUAL_INT(0, meta.refused);
  // The two-argument form still reads a record that has the field.
  std::string t;
  std::string a;
  TEST_ASSERT_TRUE(NoteQueue::parseMeta(json, t, a));
  TEST_ASSERT_EQUAL_STRING("t", t.c_str());
}

void test_the_refusal_field_is_a_short_number_and_nothing_else_may_be_one() {
  NoteMeta meta;
  TEST_ASSERT_TRUE(NoteQueue::parseMeta("{\"refused\":413,\"turn\":\"x\"}", meta));
  TEST_ASSERT_EQUAL_INT(413, meta.refused);
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\",\"refused\":}", meta));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\",\"refused\":\"422\"}", meta));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\",\"refused\":12345}", meta));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"turn\":\"x\",\"recordedAt\":5}", meta));
  TEST_ASSERT_FALSE(NoteQueue::parseMeta("{\"refused\":422}", meta));  // still needs its turn
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_names_are_eight_digits);
  RUN_TEST(test_add_saves_a_note_with_its_record);
  RUN_TEST(test_oldest_is_the_lowest_sequence_number);
  RUN_TEST(test_a_note_stays_until_it_is_confirmed);
  RUN_TEST(test_confirm_of_an_unknown_note_changes_nothing);
  RUN_TEST(test_a_failed_removal_keeps_the_note_for_a_retry);
  RUN_TEST(test_at_most_fifty_notes);
  RUN_TEST(test_refuses_when_the_reserve_would_not_be_left);
  RUN_TEST(test_exact_reserve_edge);
  RUN_TEST(test_notes_of_two_minutes_fill_the_flash_and_then_say_it_is_full);
  RUN_TEST(test_six_whole_recordings_fit_beside_the_biggest_voice_pack);
  RUN_TEST(test_a_note_of_the_largest_upload_is_read_back_whole_in_pieces);
  RUN_TEST(test_a_failed_write_uses_no_number_and_leaves_no_note);
  RUN_TEST(test_nothing_to_store_is_not_saved);
  RUN_TEST(test_load_finds_the_notes_after_a_reboot_in_order);
  RUN_TEST(test_load_ignores_files_that_are_not_notes);
  RUN_TEST(test_load_reports_a_store_that_cannot_be_listed);
  RUN_TEST(test_a_note_with_a_broken_record_is_still_handed_out);
  RUN_TEST(test_meta_round_trip_and_escaping);
  RUN_TEST(test_meta_parser_reads_other_layouts_and_refuses_junk);
  RUN_TEST(test_meta_escapes_control_characters_and_reads_them_back);
  RUN_TEST(test_meta_parser_refuses_broken_escapes);
  RUN_TEST(test_the_sequence_does_not_run_past_eight_digits);
  RUN_TEST(test_streaming_a_note_back_in_pieces);
  RUN_TEST(test_next_goes_on_past_a_note_that_stays);
  RUN_TEST(test_next_from_before_the_first_note_is_the_oldest);
  RUN_TEST(test_next_skips_over_a_gap_left_by_a_confirmed_note);
  RUN_TEST(test_a_note_source_streams_the_audio_in_pieces);
  RUN_TEST(test_a_refused_note_stays_but_is_no_longer_pending);
  RUN_TEST(test_a_refusal_survives_a_restart);
  RUN_TEST(test_a_refusal_that_cannot_be_written_still_holds_for_this_run);
  RUN_TEST(test_a_note_with_an_unreadable_record_is_not_rewritten);
  RUN_TEST(test_marking_something_that_is_not_a_note_does_nothing);
  RUN_TEST(test_a_refused_note_that_is_confirmed_later_leaves_the_count_right);
  RUN_TEST(test_the_record_with_a_refusal_round_trips);
  RUN_TEST(test_the_refusal_field_is_a_short_number_and_nothing_else_may_be_one);
  return UNITY_END();
}
