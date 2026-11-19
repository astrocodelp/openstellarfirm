#include "base64url.h"

namespace pet {

namespace {

const char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

int valueOf(char c) {
  if (c >= 'A' && c <= 'Z') {
    return c - 'A';
  }
  if (c >= 'a' && c <= 'z') {
    return c - 'a' + 26;
  }
  if (c >= '0' && c <= '9') {
    return c - '0' + 52;
  }
  if (c == '-') {
    return 62;
  }
  if (c == '_') {
    return 63;
  }
  return -1;
}

}  // namespace

size_t base64urlEncodedLength(size_t bytes) {
  return (bytes / 3) * 4 + (bytes % 3 == 0 ? 0 : (bytes % 3) + 1);
}

std::string base64urlEncode(const uint8_t* data, size_t len) {
  std::string out;
  out.reserve(base64urlEncodedLength(len));
  size_t i = 0;
  for (; i + 3 <= len; i += 3) {
    const uint32_t v = (static_cast<uint32_t>(data[i]) << 16) | (static_cast<uint32_t>(data[i + 1]) << 8) | data[i + 2];
    out.push_back(kAlphabet[(v >> 18) & 63]);
    out.push_back(kAlphabet[(v >> 12) & 63]);
    out.push_back(kAlphabet[(v >> 6) & 63]);
    out.push_back(kAlphabet[v & 63]);
  }
  if (len - i == 1) {
    const uint32_t v = static_cast<uint32_t>(data[i]) << 16;
    out.push_back(kAlphabet[(v >> 18) & 63]);
    out.push_back(kAlphabet[(v >> 12) & 63]);
  } else if (len - i == 2) {
    const uint32_t v = (static_cast<uint32_t>(data[i]) << 16) | (static_cast<uint32_t>(data[i + 1]) << 8);
    out.push_back(kAlphabet[(v >> 18) & 63]);
    out.push_back(kAlphabet[(v >> 12) & 63]);
    out.push_back(kAlphabet[(v >> 6) & 63]);
  }
  return out;
}

bool base64urlDecode(const std::string& text, std::vector<uint8_t>& out) {
  out.clear();
  if (text.size() % 4 == 1) {
    return false;
  }
  uint32_t acc = 0;
  int bits = 0;
  for (char c : text) {
    const int v = valueOf(c);
    if (v < 0) {
      out.clear();
      return false;
    }
    acc = (acc << 6) | static_cast<uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>((acc >> bits) & 0xff));
    }
  }
  // What is left over must be zero bits, or two spellings would mean the same bytes.
  if (bits > 0 && (acc & ((1u << bits) - 1)) != 0) {
    out.clear();
    return false;
  }
  return true;
}

}  // namespace pet
