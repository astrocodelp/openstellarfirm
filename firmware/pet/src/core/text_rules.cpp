#include "text_rules.h"

#include <cstdio>
#include <cstring>

namespace pet {

namespace {

bool inAlphabet(char c) {
  for (const char* p = PET_CODE_ALPHABET; *p != '\0'; ++p) {
    if (*p == c) {
      return true;
    }
  }
  return false;
}

bool isHexDigit(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }

bool endsWith(const std::string& text, const char* suffix) {
  const size_t n = std::strlen(suffix);
  return text.size() >= n && text.compare(text.size() - n, n, suffix) == 0;
}

}  // namespace

std::string htmlEscape(const std::string& text) {
  std::string out;
  out.reserve(text.size() + text.size() / 8);
  for (char ch : text) {
    const unsigned char c = static_cast<unsigned char>(ch);
    switch (c) {
      case '&':
        out += "&amp;";
        break;
      case '<':
        out += "&lt;";
        break;
      case '>':
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case '\'':
        out += "&#39;";
        break;
      default:
        if (c < 0x20 || c == 0x7f) {
          // A control character has no place in a name; show it as a numeric
          // reference rather than let it reach the page raw.
          char ref[8];
          std::snprintf(ref, sizeof(ref), "&#%u;", static_cast<unsigned>(c));
          out += ref;
        } else {
          out += ch;
        }
    }
  }
  return out;
}

bool normalizeSetupCode(const std::string& typed, std::string& out) {
  out.clear();
  for (char ch : typed) {
    char c = ch;
    if (c >= 'a' && c <= 'z') {
      c = static_cast<char>(c - 'a' + 'A');
    }
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
      out += c;
    }
  }
  if (out.size() != PET_SETUP_CODE_LENGTH) {
    out.clear();
    return false;
  }
  for (char c : out) {
    if (!inAlphabet(c)) {
      out.clear();
      return false;
    }
  }
  return true;
}

bool isPlausibleSsid(const std::string& ssid) {
  if (ssid.empty() || ssid.size() > 32) {
    return false;
  }
  for (char ch : ssid) {
    const unsigned char c = static_cast<unsigned char>(ch);
    if (c < 0x20 || c == 0x7f) {
      return false;
    }
  }
  return true;
}

bool isPlausiblePassword(const std::string& password) {
  if (password.empty()) {
    return true;
  }
  if (password.size() == 64) {
    for (char c : password) {
      if (!isHexDigit(c)) {
        return false;
      }
    }
    return true;
  }
  if (password.size() < 8 || password.size() > 63) {
    return false;
  }
  for (char ch : password) {
    const unsigned char c = static_cast<unsigned char>(ch);
    if (c < 0x20 || c > 0x7e) {
      return false;
    }
  }
  return true;
}

std::string apName(PetKind kind, uint8_t macByteFive, uint8_t macByteSix) {
  const int asInt = static_cast<int>(kind);
  const int index = (asInt >= 0 && asInt < PET_KIND_COUNT) ? asInt : static_cast<int>(PET_DEFAULT_KIND);
  char name[48];
  std::snprintf(name, sizeof(name), "OpenStellarFirm %s %02X%02X", PET_KIND_NAMES[index], static_cast<unsigned>(macByteFive),
                static_cast<unsigned>(macByteSix));
  return name;
}

bool formatIsoUtc(int year, int month, int day, int hour, int minute, int second, char out[21]) {
  out[0] = '\0';
  if (year < 2024 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 ||
      minute < 0 || minute > 59 || second < 0 || second > 60) {
    return false;
  }
  std::snprintf(out, 21, "%04d-%02d-%02dT%02d:%02d:%02dZ", year, month, day, hour, minute, second);
  return true;
}

uint32_t idKey(const char* id) {
  if (id == nullptr || id[0] == '\0') {
    return 0;
  }
  constexpr size_t kIdMax = 64;
  uint32_t hash = 2166136261u;
  size_t length = 0;
  for (const unsigned char* p = reinterpret_cast<const unsigned char*>(id); *p != '\0'; ++p, ++length) {
    if (length >= kIdMax) {
      return 0;
    }
    hash = (hash ^ *p) * 16777619u;
  }
  return hash == 0 ? 1u : hash;
}

bool isPairingHello(const char* line) {
  if (line == nullptr) {
    return false;
  }
  const std::string text(line);
  static const char kStart[] = "Hi, I'm ";
  static const char kEnd[] = ". Hold my lime light and talk to me.";
  if (text.size() <= std::strlen(kStart) + std::strlen(kEnd)) {
    return false;
  }
  return text.compare(0, std::strlen(kStart), kStart) == 0 && endsWith(text, kEnd);
}

}  // namespace pet
