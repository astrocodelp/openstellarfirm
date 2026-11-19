#include "usb_setup_rules.h"

#include <cstring>
#include <utility>

#include "text_rules.h"

namespace pet {

namespace {

constexpr uint32_t kRateWindowMs = 1000;
// The most tokens a line is cut into: join has four. A line with more is bad_line.
constexpr size_t kMaxKnownTokens = 4;

struct Token {
  const char* at = nullptr;
  size_t size = 0;
};

bool sameWord(const Token& token, const char* word) {
  const size_t n = std::strlen(word);
  return token.size == n && std::memcmp(token.at, word, n) == 0;
}

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  return -1;  // an upper case digit is not hex here: the page and the pet read the same lines
}

// Lower case hex, two characters a byte, at least one byte. Anything else is refused.
bool decodeHex(const Token& token, std::string& out) {
  out.clear();
  if (token.size == 0 || token.size % 2 != 0) {
    return false;
  }
  out.reserve(token.size / 2);
  for (size_t i = 0; i < token.size; i += 2) {
    const int high = hexValue(token.at[i]);
    const int low = hexValue(token.at[i + 1]);
    if (high < 0 || low < 0) {
      out.clear();
      return false;
    }
    out.push_back(static_cast<char>(high * 16 + low));
  }
  return true;
}

UsbParse refusedParse(PetUsbRefusal reason) {
  UsbParse parse;
  parse.kind = UsbParseKind::Refused;
  parse.refusal = reason;
  return parse;
}

// Writes one reply into a caller's buffer. Every put is checked against the room, so
// a line that does not fit is not written at all (finish() returns 0).
class LineWriter {
 public:
  LineWriter(char* out, size_t cap) : out_(out), cap_(cap) { text(PET_USB_PREFIX); }

  void text(const char* word) {
    for (; *word != '\0'; ++word) {
      put(*word);
    }
  }

  void space() { put(' '); }

  void number(int value) {
    if (value < 0) {
      put('-');
      value = -value;
    }
    char digits[12];
    size_t n = 0;
    do {
      digits[n++] = static_cast<char>('0' + value % 10);
      value /= 10;
    } while (value > 0 && n < sizeof(digits));
    while (n > 0) {
      put(digits[--n]);
    }
  }

  void hex(const uint8_t* bytes, size_t length) {
    static const char kDigits[] = "0123456789abcdef";
    for (size_t i = 0; i < length; ++i) {
      put(kDigits[bytes[i] >> 4]);
      put(kDigits[bytes[i] & 15]);
    }
  }

  // The newline and a closing zero byte. 0 when anything did not fit.
  size_t finish() {
    put('\n');
    if (!ok_ || out_ == nullptr || cap_ == 0) {
      return 0;
    }
    out_[length_] = '\0';
    return length_;
  }

 private:
  void put(char c) {
    // Room is kept for the closing zero byte.
    if (out_ == nullptr || length_ + 1 >= cap_) {
      ok_ = false;
      return;
    }
    out_[length_++] = c;
  }

  char* out_;
  size_t cap_;
  size_t length_ = 0;
  bool ok_ = true;
};

bool isVersionChar(char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '.' || c == '-';
}

// "0.1.0" or "1.2.3-rc.1": three numbers and an optional "-" or "+" suffix, at most
// PET_USB_FIRMWARE_MAX_CHARS characters, the same shape the page accepts.
bool isVersionShaped(const char* text) {
  if (text == nullptr) {
    return false;
  }
  size_t length = 0;
  while (length <= PET_USB_FIRMWARE_MAX_CHARS && text[length] != '\0') {
    ++length;
  }
  if (length == 0 || length > PET_USB_FIRMWARE_MAX_CHARS) {
    return false;
  }
  size_t i = 0;
  for (int group = 0; group < 3; ++group) {
    if (group > 0) {
      if (text[i] != '.') {
        return false;
      }
      ++i;
    }
    const size_t start = i;
    while (text[i] >= '0' && text[i] <= '9') {
      ++i;
    }
    if (i == start) {
      return false;
    }
  }
  if (text[i] == '\0') {
    return true;
  }
  if (text[i] != '-' && text[i] != '+') {
    return false;
  }
  ++i;
  if (text[i] == '\0') {
    return false;
  }
  for (; text[i] != '\0'; ++i) {
    if (!isVersionChar(text[i])) {
      return false;
    }
  }
  return true;
}

}  // namespace

bool usbRefuses(PetUsbOp op, UsbPolicy policy, PetUsbRefusal& why) {
  if (policy.paired) {
    if (op == PET_USB_OP_HELLO) {
      return false;
    }
    why = PET_USB_REFUSAL_PAIRED;
    return true;
  }
  if (policy.busy && (op == PET_USB_OP_SCAN || op == PET_USB_OP_JOIN)) {
    why = PET_USB_REFUSAL_BUSY;
    return true;
  }
  return false;
}

// -- Lines in --------------------------------------------------------------------------

bool usbHasPrefix(const char* line, size_t length) {
  return line != nullptr && length >= PET_USB_PREFIX_LENGTH && std::memcmp(line, PET_USB_PREFIX, PET_USB_PREFIX_LENGTH) == 0;
}

UsbPush UsbLineAssembler::push(uint8_t byte) {
  if (byte == '\n') {
    if (discarding_) {
      discarding_ = false;
      held_ = 0;
      return UsbPush::Overflow;
    }
    size_t end = held_;
    if (end > 0 && buffer_[end - 1] == '\r') {
      --end;
    }
    buffer_[end] = '\0';
    lineLength_ = end;
    held_ = 0;
    return UsbPush::Line;
  }
  if (discarding_) {
    return UsbPush::Nothing;  // thrown away up to the newline
  }
  if (held_ < PET_USB_MAX_LINE) {
    buffer_[held_++] = static_cast<char>(byte);
    return UsbPush::Nothing;
  }
  discarding_ = true;
  overflowPrefixed_ = usbHasPrefix(buffer_, held_);
  return UsbPush::Nothing;
}

void UsbLineAssembler::reset() {
  held_ = 0;
  lineLength_ = 0;
  discarding_ = false;
  overflowPrefixed_ = false;
}

void UsbLineAssembler::wipe() { std::memset(buffer_, 0, sizeof(buffer_)); }

UsbParse parseUsbLine(const char* line, size_t length, UsbPolicy policy) {
  if (!usbHasPrefix(line, length)) {
    return UsbParse();  // Ignored
  }
  if (length > PET_USB_MAX_LINE || length == PET_USB_PREFIX_LENGTH) {
    return refusedParse(PET_USB_REFUSAL_BAD_LINE);
  }

  // The shape: printable ASCII only, tokens cut at single spaces, no empty token.
  Token tokens[kMaxKnownTokens];
  size_t count = 0;
  size_t start = PET_USB_PREFIX_LENGTH;
  for (size_t i = PET_USB_PREFIX_LENGTH; i <= length; ++i) {
    const bool end = i == length;
    if (!end) {
      const unsigned char c = static_cast<unsigned char>(line[i]);
      if (c < 0x20 || c > 0x7e) {
        return refusedParse(PET_USB_REFUSAL_BAD_LINE);
      }
    }
    if (end || line[i] == ' ') {
      if (i == start) {
        return refusedParse(PET_USB_REFUSAL_BAD_LINE);  // an empty token: two spaces, or one at an end
      }
      if (count < kMaxKnownTokens) {
        tokens[count].at = line + start;
        tokens[count].size = i - start;
      }
      ++count;
      start = i + 1;
    }
  }

  // The op, then how many tokens it takes.
  int opIndex = -1;
  for (int i = 0; i < PET_USB_OP_COUNT; ++i) {
    if (sameWord(tokens[0], PET_USB_OP_IDS[i])) {
      opIndex = i;
      break;
    }
  }
  if (opIndex < 0) {
    return refusedParse(PET_USB_REFUSAL_UNKNOWN_OP);
  }
  const PetUsbOp op = static_cast<PetUsbOp>(opIndex);
  if (count != (op == PET_USB_OP_JOIN ? 4u : 1u)) {
    return refusedParse(PET_USB_REFUSAL_BAD_LINE);
  }

  // The state, before any value is read: a paired pet never looks at a join's values.
  PetUsbRefusal why = PET_USB_REFUSAL_PAIRED;
  if (usbRefuses(op, policy, why)) {
    return refusedParse(why);
  }

  UsbParse parse;
  parse.kind = UsbParseKind::Request;
  parse.request.op = op;
  if (op != PET_USB_OP_JOIN) {
    return parse;
  }

  // The values, with the setup page's own rules.
  UsbJoin& join = parse.request.join;
  if (!decodeHex(tokens[1], join.ssid) || !isPlausibleSsid(join.ssid)) {
    return refusedParse(PET_USB_REFUSAL_BAD_VALUE);
  }
  if (!sameWord(tokens[2], PET_USB_OPEN_PASSWORD)) {
    if (!decodeHex(tokens[2], join.password) || !isPlausiblePassword(join.password)) {
      return refusedParse(PET_USB_REFUSAL_BAD_VALUE);
    }
  }
  if (!normalizeSetupCode(std::string(tokens[3].at, tokens[3].size), join.code)) {
    return refusedParse(PET_USB_REFUSAL_BAD_VALUE);
  }
  return parse;
}

bool UsbRateLimit::allow(uint32_t nowMs) {
  constexpr uint8_t kSlots = PET_USB_MAX_LINES_PER_SECOND;
  if (count_ < kSlots) {
    taken_[(next_ + count_) % kSlots] = nowMs;
    ++count_;
    return true;
  }
  if (static_cast<uint32_t>(nowMs - taken_[next_]) < kRateWindowMs) {
    return false;
  }
  taken_[next_] = nowMs;
  next_ = static_cast<uint8_t>((next_ + 1) % kSlots);
  return true;
}

bool UsbEndpoint::push(uint8_t byte, uint32_t nowMs, UsbPolicy policy, UsbInbound& out) {
  const UsbPush pushed = assembler_.push(byte);
  if (pushed == UsbPush::Nothing) {
    return false;
  }
  out.what = UsbWhat::Nothing;
  out.request = UsbRequest();

  if (pushed == UsbPush::Overflow) {
    const bool ours = assembler_.overflowPrefixed();
    assembler_.wipe();
    if (!ours) {
      return false;
    }
    out.what = UsbWhat::Refusal;
    out.refusal = limit_.allow(nowMs) ? PET_USB_REFUSAL_BAD_LINE : PET_USB_REFUSAL_RATE_LIMITED;
    return true;
  }

  // A whole line. The limit is applied once the line is known to be ours.
  const bool ours = usbHasPrefix(assembler_.line(), assembler_.length());
  if (!ours) {
    assembler_.wipe();
    return false;
  }
  if (!limit_.allow(nowMs)) {
    assembler_.wipe();
    out.what = UsbWhat::Refusal;
    out.refusal = PET_USB_REFUSAL_RATE_LIMITED;
    return true;
  }
  UsbParse parse = parseUsbLine(assembler_.line(), assembler_.length(), policy);
  assembler_.wipe();  // a join's line holds the Wi-Fi password in hex
  switch (parse.kind) {
    case UsbParseKind::Ignored:
      return false;
    case UsbParseKind::Refused:
      out.what = UsbWhat::Refusal;
      out.refusal = parse.refusal;
      return true;
    case UsbParseKind::Request:
      out.what = UsbWhat::Request;
      out.request = std::move(parse.request);
      return true;
  }
  return false;
}

// -- Lines out -------------------------------------------------------------------------

size_t usbHelloLine(char* out, size_t cap, PetKind kind, const char* firmware, bool paired, bool setupOpen) {
  const int figure = static_cast<int>(kind);
  if (figure < 0 || figure >= PET_KIND_COUNT || !isVersionShaped(firmware)) {
    return 0;
  }
  LineWriter line(out, cap);
  line.text("hello");
  line.space();
  line.number(PET_USB_VERSION);
  line.space();
  line.text(PET_KIND_IDS[figure]);
  line.space();
  line.text(firmware);
  line.space();
  line.text(paired ? PET_USB_WORD_PAIRED : PET_USB_WORD_UNPAIRED);
  line.space();
  line.text(setupOpen ? PET_USB_WORD_OPEN : PET_USB_WORD_CLOSED);
  return line.finish();
}

size_t usbNetLine(char* out, size_t cap, const uint8_t* ssid, size_t ssidLength, int rssi, bool locked) {
  if (ssid == nullptr || ssidLength > PET_USB_SSID_MAX_BYTES ||
      !isPlausibleSsid(std::string(reinterpret_cast<const char*>(ssid), ssidLength))) {
    return 0;
  }
  if (rssi > 0) {
    rssi = 0;
  } else if (rssi < -127) {
    rssi = -127;
  }
  LineWriter line(out, cap);
  line.text("net");
  line.space();
  line.hex(ssid, ssidLength);
  line.space();
  line.number(rssi);
  line.space();
  line.text(locked ? PET_USB_WORD_LOCKED : PET_USB_WORD_OPEN);
  return line.finish();
}

size_t usbScanDoneLine(char* out, size_t cap, size_t count) {
  if (count > PET_USB_MAX_NETWORKS) {
    return 0;
  }
  LineWriter line(out, cap);
  line.text("scan-done");
  line.space();
  line.number(static_cast<int>(count));
  return line.finish();
}

size_t usbStateLine(char* out, size_t cap, PetUsbState state, PetUsbError error) {
  const int stateIndex = static_cast<int>(state);
  if (stateIndex < 0 || stateIndex >= PET_USB_STATE_COUNT) {
    return 0;
  }
  LineWriter line(out, cap);
  line.text("state");
  line.space();
  line.text(PET_USB_STATE_IDS[stateIndex]);
  if (state == PET_USB_STATE_ERROR) {
    const int errorIndex = static_cast<int>(error);
    if (errorIndex < 0 || errorIndex >= PET_USB_ERROR_COUNT) {
      return 0;
    }
    line.space();
    line.text(PET_USB_ERROR_IDS[errorIndex]);
  }
  return line.finish();
}

size_t usbRefusedLine(char* out, size_t cap, PetUsbRefusal reason) {
  const int index = static_cast<int>(reason);
  if (index < 0 || index >= PET_USB_REFUSAL_COUNT) {
    return 0;
  }
  LineWriter line(out, cap);
  line.text("refused");
  line.space();
  line.text(PET_USB_REFUSAL_IDS[index]);
  return line.finish();
}

}  // namespace pet
