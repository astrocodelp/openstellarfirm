#include "server_pin.h"

#include <cstring>

namespace pet {

namespace {

bool isLowerHex(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  return -1;
}

// The groups of one half of an IPv6 address ("fd12:3456" or ""): how many there are, or -1
// when one is not one to four hex digits.
int ipv6Groups(const std::string& part) {
  if (part.empty()) {
    return 0;
  }
  int groups = 0;
  size_t digits = 0;
  for (size_t i = 0; i <= part.size(); ++i) {
    if (i == part.size() || part[i] == ':') {
      if (digits == 0 || digits > 4) {
        return -1;
      }
      ++groups;
      digits = 0;
    } else if (isLowerHex(part[i])) {
      ++digits;
    } else {
      return -1;
    }
  }
  return groups;
}

}  // namespace

bool isIpv4Address(const std::string& text) {
  int parts = 0;
  size_t i = 0;
  while (i <= text.size()) {
    const size_t start = i;
    int value = 0;
    while (i < text.size() && text[i] >= '0' && text[i] <= '9') {
      value = value * 10 + (text[i] - '0');
      if (i - start >= 3) {
        return false;  // four digits
      }
      ++i;
    }
    const size_t length = i - start;
    if (length == 0 || (length > 1 && text[start] == '0') || value > 255) {
      return false;
    }
    ++parts;
    if (i == text.size()) {
      break;
    }
    if (text[i] != '.') {
      return false;
    }
    ++i;
  }
  return parts == 4;
}

bool isIpv6Address(const std::string& text) {
  if (text.size() < 2 || text.size() > 39) {
    return false;
  }
  for (char c : text) {
    if (!isLowerHex(c) && c != ':') {
      return false;
    }
  }
  if (text.find(":::") != std::string::npos) {
    return false;
  }
  // Split on "::" the way String.split does, left to right and not overlapping.
  const size_t first = text.find("::");
  if (first == std::string::npos) {
    return ipv6Groups(text) == 8;
  }
  if (text.find("::", first + 2) != std::string::npos) {
    return false;  // a second "::"
  }
  const int head = ipv6Groups(text.substr(0, first));
  const int tail = ipv6Groups(text.substr(first + 2));
  return head >= 0 && tail >= 0 && head + tail <= 7;
}

bool isServerName(const std::string& text) {
  static const char kPrefix[] = "osf-";
  static const char kSuffix[] = ".local";
  constexpr size_t kLabel = 8;
  constexpr size_t kPrefixLen = sizeof(kPrefix) - 1;
  constexpr size_t kSuffixLen = sizeof(kSuffix) - 1;
  if (text.size() != kPrefixLen + kLabel + kSuffixLen) {
    return false;
  }
  if (text.compare(0, kPrefixLen, kPrefix) != 0 || text.compare(kPrefixLen + kLabel, kSuffixLen, kSuffix) != 0) {
    return false;
  }
  for (size_t i = 0; i < kLabel; ++i) {
    if (!isLowerHex(text[kPrefixLen + i])) {
      return false;
    }
  }
  return true;
}

bool parseServerPort(const std::string& text, uint16_t& out) {
  if (text.empty() || text.size() > 5 || text[0] == '0') {
    return false;
  }
  uint32_t value = 0;
  for (char c : text) {
    if (c < '0' || c > '9') {
      return false;
    }
    value = value * 10 + static_cast<uint32_t>(c - '0');
  }
  if (value < 1 || value > 65535) {
    return false;
  }
  out = static_cast<uint16_t>(value);
  return true;
}

bool isFingerprintHex(const std::string& text) {
  if (text.size() != kPinHexChars) {
    return false;
  }
  for (char c : text) {
    if (!isLowerHex(c)) {
      return false;
    }
  }
  return true;
}

bool ServerRecord::operator==(const ServerRecord& other) const {
  return address == other.address && port == other.port && name == other.name &&
         std::memcmp(fingerprint, other.fingerprint, kPinBytes) == 0;
}

bool isUsableServer(const ServerRecord& record) {
  if (record.port == 0 || !isServerName(record.name)) {
    return false;
  }
  return record.address.empty() || isIpv4Address(record.address) || isIpv6Address(record.address);
}

bool parseFingerprint(const char* text, size_t length, uint8_t out[kPinBytes]) {
  std::memset(out, 0, kPinBytes);
  if (text == nullptr || length != kPinHexChars) {
    return false;
  }
  uint8_t parsed[kPinBytes];
  for (size_t i = 0; i < kPinBytes; ++i) {
    const int high = hexValue(text[2 * i]);
    const int low = hexValue(text[2 * i + 1]);
    if (high < 0 || low < 0) {
      return false;
    }
    parsed[i] = static_cast<uint8_t>(high * 16 + low);
  }
  std::memcpy(out, parsed, kPinBytes);
  return true;
}

void fingerprintToHex(const uint8_t fingerprint[kPinBytes], char out[kPinHexChars + 1]) {
  static const char kDigits[] = "0123456789abcdef";
  for (size_t i = 0; i < kPinBytes; ++i) {
    out[2 * i] = kDigits[fingerprint[i] >> 4];
    out[2 * i + 1] = kDigits[fingerprint[i] & 15];
  }
  out[kPinHexChars] = '\0';
}

bool pinEqual(const uint8_t* a, const uint8_t* b) {
  if (a == nullptr || b == nullptr) {
    return false;
  }
  // Every byte is looked at, whatever the first difference was.
  uint8_t difference = 0;
  for (size_t i = 0; i < kPinBytes; ++i) {
    difference = static_cast<uint8_t>(difference | (a[i] ^ b[i]));
  }
  return difference == 0;
}

PinAction pinAction(int depth, bool pinKnown, const uint8_t* expected, const uint8_t* leafDigest) {
  if (depth > 0) {
    return PinAction::Pass;
  }
  if (depth < 0 || !pinKnown || expected == nullptr || leafDigest == nullptr) {
    return PinAction::Reject;
  }
  return pinEqual(expected, leafDigest) ? PinAction::Accept : PinAction::Reject;
}

std::string serverBaseUrl(const std::string& address, uint16_t port) {
  if (port == 0) {
    return std::string();
  }
  std::string host;
  if (isIpv4Address(address)) {
    host = address;
  } else if (isIpv6Address(address)) {
    host = "[" + address + "]";
  } else {
    return std::string();
  }
  return "https://" + host + ":" + std::to_string(port);
}

std::string mdnsHostOf(const std::string& name) {
  if (!isServerName(name)) {
    return std::string();
  }
  return name.substr(0, name.size() - (sizeof(".local") - 1));
}

std::string ipv4Text(const uint8_t bytes[4]) {
  return std::to_string(bytes[0]) + "." + std::to_string(bytes[1]) + "." + std::to_string(bytes[2]) + "." +
         std::to_string(bytes[3]);
}

bool shouldAskName(const ServerRecord& record, bool triedAddress) {
  if (record.name.empty()) {
    return false;
  }
  return record.address.empty() || triedAddress;
}

}  // namespace pet
