#include "note_queue.h"

#include <algorithm>

namespace pet {

namespace {

constexpr size_t kNameDigits = 8;

void appendEscaped(std::string& out, const std::string& text) {
  static const char kHex[] = "0123456789abcdef";
  for (char ch : text) {
    const unsigned char c = static_cast<unsigned char>(ch);
    if (c == '"') {
      out += "\\\"";
    } else if (c == '\\') {
      out += "\\\\";
    } else if (c < 0x20) {
      out += "\\u00";
      out += kHex[c >> 4];
      out += kHex[c & 0x0f];
    } else {
      out += ch;
    }
  }
}

void skipSpace(const std::string& s, size_t& i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) {
    ++i;
  }
}

int hexDigit(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

// Reads a JSON string starting at the opening quote. Only the escapes our own
// writer makes and the simple ones are understood; a \u escape above 0x7f fails.
bool readString(const std::string& s, size_t& i, std::string& out) {
  if (i >= s.size() || s[i] != '"') {
    return false;
  }
  ++i;
  out.clear();
  while (i < s.size()) {
    const char c = s[i++];
    if (c == '"') {
      return true;
    }
    if (c != '\\') {
      out += c;
      continue;
    }
    if (i >= s.size()) {
      return false;
    }
    const char e = s[i++];
    switch (e) {
      case '"':
      case '\\':
      case '/':
        out += e;
        break;
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u': {
        if (i + 4 > s.size()) {
          return false;
        }
        int v = 0;
        for (int k = 0; k < 4; ++k) {
          const int d = hexDigit(s[i + static_cast<size_t>(k)]);
          if (d < 0) {
            return false;
          }
          v = (v << 4) | d;
        }
        i += 4;
        if (v > 0x7f) {
          return false;
        }
        out += static_cast<char>(v);
        break;
      }
      default:
        return false;
    }
  }
  return false;
}

}  // namespace

NoteQueue::NoteQueue(NoteStore& store, uint32_t nextSeq) : store_(store), nextSeq_(nextSeq) {}

std::string NoteQueue::nameFor(uint32_t seq) {
  std::string digits(kNameDigits, '0');
  for (size_t i = kNameDigits; i > 0; --i) {
    digits[i - 1] = static_cast<char>('0' + (seq % 10));
    seq /= 10;
  }
  return digits;
}

bool NoteQueue::parseName(const std::string& name, uint32_t& seq) {
  if (name.size() != kNameDigits) {
    return false;
  }
  uint32_t value = 0;
  for (char c : name) {
    if (c < '0' || c > '9') {
      return false;
    }
    value = value * 10 + static_cast<uint32_t>(c - '0');
  }
  seq = value;
  return true;
}

std::string NoteQueue::makeMeta(const std::string& turn, const std::string& recordedAt, int refused) {
  std::string json = "{\"turn\":\"";
  appendEscaped(json, turn);
  json += "\",\"recordedAt\":\"";
  appendEscaped(json, recordedAt);
  json += "\"";
  if (refused > 0) {
    json += ",\"refused\":" + std::to_string(refused);
  }
  json += "}";
  return json;
}

bool NoteQueue::parseMeta(const std::string& json, NoteMeta& out) {
  out = NoteMeta{};
  size_t i = 0;
  skipSpace(json, i);
  if (i >= json.size() || json[i] != '{') {
    return false;
  }
  ++i;
  bool haveTurn = false;
  skipSpace(json, i);
  if (i < json.size() && json[i] == '}') {
    return false;
  }
  while (true) {
    std::string key;
    std::string value;
    skipSpace(json, i);
    if (!readString(json, i, key)) {
      return false;
    }
    skipSpace(json, i);
    if (i >= json.size() || json[i] != ':') {
      return false;
    }
    ++i;
    skipSpace(json, i);
    if (key == "refused") {
      // The one number in a record: an HTTP status, so three digits.
      int status = 0;
      int digits = 0;
      while (i < json.size() && json[i] >= '0' && json[i] <= '9' && digits < 4) {
        status = status * 10 + (json[i] - '0');
        ++i;
        ++digits;
      }
      if (digits == 0 || digits > 3) {
        return false;
      }
      out.refused = status;
    } else {
      if (!readString(json, i, value)) {
        return false;
      }
      if (key == "turn") {
        out.turn = value;
        haveTurn = true;
      } else if (key == "recordedAt") {
        out.recordedAt = value;
      }
    }
    skipSpace(json, i);
    if (i >= json.size()) {
      return false;
    }
    if (json[i] == ',') {
      ++i;
      continue;
    }
    if (json[i] == '}') {
      break;
    }
    return false;
  }
  if (!haveTurn || out.turn.empty()) {
    out = NoteMeta{};
    return false;
  }
  return true;
}

bool NoteQueue::parseMeta(const std::string& json, std::string& turn, std::string& recordedAt) {
  NoteMeta meta;
  const bool ok = parseMeta(json, meta);
  turn = meta.turn;
  recordedAt = meta.recordedAt;
  return ok;
}

bool NoteQueue::load() {
  seqs_.clear();
  std::vector<std::string> names;
  if (!store_.list(names)) {
    return false;
  }
  for (const std::string& name : names) {
    uint32_t seq = 0;
    if (parseName(name, seq)) {
      seqs_.push_back(seq);
    }
  }
  std::sort(seqs_.begin(), seqs_.end());
  seqs_.erase(std::unique(seqs_.begin(), seqs_.end()), seqs_.end());
  if (!seqs_.empty() && seqs_.back() >= nextSeq_) {
    nextSeq_ = seqs_.back() + 1;
  }
  // Which notes OpenStellarFirm refused before this boot.
  refused_.clear();
  for (uint32_t seq : seqs_) {
    std::string json;
    NoteMeta meta;
    if (store_.readMeta(nameFor(seq), json) && parseMeta(json, meta) && meta.refused > 0) {
      refused_.push_back(seq);
    }
  }
  return true;
}

AddResult NoteQueue::add(const std::string& turnId, const std::string& recordedAtIso, const uint8_t* wavBytes,
                         size_t len) {
  if (seqs_.size() >= PET_SAVED_NOTES_MAX) {
    return AddResult::Full;
  }
  // Out of numbers is not reachable in practice (one note a second would take
  // three years); the safe answer is that the memory is full.
  if (nextSeq_ > kMaxSeq) {
    return AddResult::Full;
  }
  if (wavBytes == nullptr || len == 0 || turnId.empty()) {
    return AddResult::NoSpace;
  }
  const size_t freeBytes = store_.freeBytes();
  if (len > freeBytes || freeBytes - len < kReserveBytes) {
    return AddResult::NoSpace;
  }
  const std::string name = nameFor(nextSeq_);
  if (!store_.writeNote(name, wavBytes, len, makeMeta(turnId, recordedAtIso))) {
    return AddResult::NoSpace;
  }
  seqs_.push_back(nextSeq_);
  ++nextSeq_;
  return AddResult::Saved;
}

void NoteQueue::describe(uint32_t seq, NoteInfo& out) {
  out = NoteInfo{};
  out.seq = seq;
  out.name = nameFor(seq);
  std::string json;
  if (store_.readMeta(out.name, json)) {
    NoteMeta meta;
    if (parseMeta(json, meta)) {
      out.turn = meta.turn;
      out.recordedAt = meta.recordedAt;
      out.refused = meta.refused;
    }
  }
  // A refusal that could not be written to the record still holds for this run.
  if (isRefused(seq) && out.refused == 0) {
    out.refused = 1;
  }
  const long size = store_.sizeOf(out.name);
  out.bytes = size > 0 ? static_cast<size_t>(size) : 0;
}

bool NoteQueue::oldest(NoteInfo& out) {
  out = NoteInfo{};
  if (seqs_.empty()) {
    return false;
  }
  describe(seqs_.front(), out);
  return true;
}

bool NoteQueue::next(uint32_t afterSeq, NoteInfo& out) {
  out = NoteInfo{};
  // seqs_ is ascending, so the first one above afterSeq is the next note.
  const auto it = std::upper_bound(seqs_.begin(), seqs_.end(), afterSeq);
  if (it == seqs_.end()) {
    return false;
  }
  describe(*it, out);
  return true;
}

bool NoteQueue::confirm(const std::string& name) {
  uint32_t seq = 0;
  if (!parseName(name, seq)) {
    return false;
  }
  const auto it = std::find(seqs_.begin(), seqs_.end(), seq);
  if (it == seqs_.end()) {
    return false;
  }
  if (!store_.remove(name)) {
    return false;
  }
  seqs_.erase(it);
  const auto refused = std::find(refused_.begin(), refused_.end(), seq);
  if (refused != refused_.end()) {
    refused_.erase(refused);
  }
  return true;
}

bool NoteQueue::isRefused(uint32_t seq) const { return std::binary_search(refused_.begin(), refused_.end(), seq); }

bool NoteQueue::markRefused(const std::string& name, int status) {
  uint32_t seq = 0;
  if (status <= 0 || status > 999 || !parseName(name, seq)) {
    return false;
  }
  if (!std::binary_search(seqs_.begin(), seqs_.end(), seq)) {
    return false;
  }
  if (!isRefused(seq)) {
    refused_.insert(std::upper_bound(refused_.begin(), refused_.end(), seq), seq);
  }
  // Written to the record too, so the refusal survives a restart. The turn id and
  // the time are kept as they were; a record that cannot be read is left alone (the
  // note is then tried once more after a restart, never lost).
  std::string json;
  NoteMeta meta;
  if (!store_.readMeta(name, json) || !parseMeta(json, meta)) {
    return false;
  }
  return store_.writeMeta(name, makeMeta(meta.turn, meta.recordedAt, status));
}

}  // namespace pet
