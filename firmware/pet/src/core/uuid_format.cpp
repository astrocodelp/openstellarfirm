#include "uuid_format.h"

namespace pet {

void formatUuidV4(const uint8_t random16[16], char out[kUuidTextLength + 1]) {
  static const char kHex[] = "0123456789abcdef";
  uint8_t b[16];
  for (int i = 0; i < 16; ++i) {
    b[i] = random16[i];
  }
  b[6] = static_cast<uint8_t>((b[6] & 0x0f) | 0x40);  // version 4
  b[8] = static_cast<uint8_t>((b[8] & 0x3f) | 0x80);  // variant 10
  size_t at = 0;
  for (int i = 0; i < 16; ++i) {
    if (i == 4 || i == 6 || i == 8 || i == 10) {
      out[at++] = '-';
    }
    out[at++] = kHex[b[i] >> 4];
    out[at++] = kHex[b[i] & 0x0f];
  }
  out[at] = '\0';
}

std::string uuidV4(const uint8_t random16[16]) {
  char text[kUuidTextLength + 1];
  formatUuidV4(random16, text);
  return std::string(text);
}

bool isUuidText(const char* text) {
  if (text == nullptr) {
    return false;
  }
  for (size_t i = 0; i < kUuidTextLength; ++i) {
    const char c = text[i];
    if (c == '\0') {
      return false;
    }
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') {
        return false;
      }
    } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
      return false;
    }
  }
  return text[kUuidTextLength] == '\0';
}

}  // namespace pet
