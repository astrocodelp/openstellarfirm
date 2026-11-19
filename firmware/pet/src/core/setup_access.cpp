#include "setup_access.h"

#include <cstring>

#include "generated/protocol.h"
#include "voice_pack.h"

namespace pet {

namespace {

size_t alphabetSize() { return std::strlen(PET_CODE_ALPHABET); }

char lower(char c) { return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c; }
char upper(char c) { return (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c; }

bool equalIgnoringCase(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (size_t i = 0; i < a.size(); ++i) {
    if (lower(a[i]) != lower(b[i])) {
      return false;
    }
  }
  return true;
}

}  // namespace

bool makeSetupPassphrase(const uint8_t* random, size_t count, std::string& out) {
  out.clear();
  if (random == nullptr) {
    return false;
  }
  const size_t size = alphabetSize();
  const unsigned limit = static_cast<unsigned>(256 / size * size);  // 248 for 31 characters
  std::string made;
  for (size_t i = 0; i < count && made.size() < kSetupPassphraseLength; ++i) {
    if (random[i] < limit) {
      made.push_back(lower(PET_CODE_ALPHABET[random[i] % size]));
    }
  }
  if (made.size() != kSetupPassphraseLength) {
    return false;
  }
  out = made;
  return true;
}

bool isSetupPassphrase(const std::string& text) {
  if (text.size() != kSetupPassphraseLength) {
    return false;
  }
  for (char c : text) {
    // Lower case only: the alphabet itself is upper case, so a lower-case letter is
    // looked up by its upper-case twin, and a digit is itself.
    if (c >= 'A' && c <= 'Z') {
      return false;
    }
    if (std::strchr(PET_CODE_ALPHABET, upper(c)) == nullptr || c == '\0') {
      return false;
    }
  }
  return true;
}

size_t spellSetupPassphrase(const std::string& passphrase, const char** out, size_t cap) {
  std::string spoken;
  spoken.reserve(passphrase.size());
  for (char c : passphrase) {
    spoken.push_back(upper(c));
  }
  return spellCodeClips(spoken.c_str(), out, cap);
}

bool setupHostIsAccessPoint(const std::string& host, const std::string& apHost) {
  return !apHost.empty() && equalIgnoringCase(host, apHost);
}

std::string setupPortalUrl(const std::string& apHost) { return "http://" + apHost + "/"; }

bool setupRequestAllowed(const std::string& setupHeader, const std::string& origin, const std::string& host,
                         const std::string& apHost) {
  if (setupHeader != "1" || !setupHostIsAccessPoint(host, apHost)) {
    return false;
  }
  if (origin.empty()) {
    return true;  // a request from the page itself to its own address carries none
  }
  return equalIgnoringCase(origin, "http://" + apHost);
}

}  // namespace pet
