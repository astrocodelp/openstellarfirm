#include "store/secrets.h"

#include <Preferences.h>
#include <esp_random.h>
#include <mbedtls/sha256.h>

#include <cstring>
#include <vector>

#include "core/base64url.h"
#include "core/setup_access.h"

namespace pet {

namespace {

// NVS key names are at most 15 characters.
constexpr const char* kNamespace = "pet";
constexpr const char* kSsid = "ssid";
constexpr const char* kWifiPass = "wpass";
constexpr const char* kToken = "token";
constexpr const char* kDeviceId = "devid";
constexpr const char* kSecret = "dsecret";
constexpr const char* kPaused = "paused";
constexpr const char* kSpeak = "speak";
constexpr const char* kVolume = "volume";
constexpr const char* kVoice = "voice";
constexpr const char* kPackVoice = "packvoice";
constexpr const char* kNoteSeq = "noteseq";
constexpr const char* kInboxAfter = "inboxafter";
constexpr const char* kSetupPass = "setuppass";
constexpr const char* kServerAddress = "srvaddr";
constexpr const char* kServerPort = "srvport";
constexpr const char* kServerPin = "srvpin";
constexpr const char* kServerName = "srvname";

// Long enough for the longest value we store (a 63 character Wi-Fi password).
constexpr size_t kStringMax = 96;

}  // namespace

Secrets::Secrets() : prefs_(new Preferences()) {}

Secrets::~Secrets() { delete prefs_; }

void Secrets::lock() {
  if (mutex_ != nullptr) {
    xSemaphoreTake(mutex_, portMAX_DELAY);
  }
}

void Secrets::unlock() {
  if (mutex_ != nullptr) {
    xSemaphoreGive(mutex_);
  }
}

bool Secrets::begin() {
  mutex_ = xSemaphoreCreateMutex();
  open_ = prefs_->begin(kNamespace, false);
  return open_;
}

std::string Secrets::readString(const char* key) {
  if (!open_ || !prefs_->isKey(key)) {
    return std::string();
  }
  char buffer[kStringMax];
  buffer[0] = '\0';
  prefs_->getString(key, buffer, sizeof(buffer));
  buffer[sizeof(buffer) - 1] = '\0';
  return std::string(buffer);
}

void Secrets::writeString(const char* key, const std::string& value) {
  if (!open_) {
    return;
  }
  if (value.empty()) {
    prefs_->remove(key);
  } else {
    prefs_->putString(key, value.c_str());
  }
}

bool Secrets::hasWifi() {
  lock();
  const bool has = !readString(kSsid).empty();
  unlock();
  return has;
}

std::string Secrets::wifiSsid() {
  lock();
  std::string value = readString(kSsid);
  unlock();
  return value;
}

std::string Secrets::wifiPassword() {
  lock();
  std::string value = readString(kWifiPass);
  unlock();
  return value;
}

bool Secrets::setWifi(const std::string& ssid, const std::string& password) {
  if (ssid.empty() || ssid.size() >= kStringMax || password.size() >= kStringMax) {
    return false;
  }
  lock();
  writeString(kSsid, ssid);
  writeString(kWifiPass, password);
  unlock();
  return true;
}

bool Secrets::paired() {
  lock();
  const bool has = !readString(kToken).empty();
  unlock();
  return has;
}

std::string Secrets::token() {
  lock();
  std::string value = readString(kToken);
  unlock();
  return value;
}

std::string Secrets::deviceId() {
  lock();
  std::string value = readString(kDeviceId);
  unlock();
  return value;
}

bool Secrets::setPaired(const std::string& token, const std::string& deviceId) {
  if (token.empty() || token.size() >= kStringMax || deviceId.size() >= kStringMax) {
    return false;
  }
  lock();
  writeString(kToken, token);
  writeString(kDeviceId, deviceId);
  // Rule 1: from now on the pet holds only its device token. The secret did its job
  // in the claim and is not kept next to the token.
  if (open_) {
    prefs_->remove(kSecret);
    // A pairing is a new inbox on the server, numbered from 1: a cursor kept from an
    // earlier one would ask after notices that do not exist yet.
    prefs_->remove(kInboxAfter);
  }
  unlock();
  return true;
}

void Secrets::clearDeviceSecret() {
  lock();
  if (open_) {
    prefs_->remove(kSecret);
  }
  unlock();
}

std::string Secrets::newDeviceSecret() {
  uint8_t raw[32];
  esp_fill_random(raw, sizeof(raw));
  const std::string secret = base64urlEncode(raw, sizeof(raw));
  std::memset(raw, 0, sizeof(raw));
  lock();
  writeString(kSecret, secret);
  unlock();
  return secret;
}

std::string Secrets::deviceSecret() {
  lock();
  std::string secret = readString(kSecret);
  unlock();
  if (secret.empty()) {
    return newDeviceSecret();
  }
  return secret;
}

std::string Secrets::deviceKey() {
  for (int attempt = 0; attempt < 2; ++attempt) {
    // A secret that does not decode to 32 bytes is damaged: it is replaced by a
    // new one on the second try rather than hashed as text.
    const std::string secret = attempt == 0 ? deviceSecret() : newDeviceSecret();
    std::vector<uint8_t> raw;
    if (base64urlDecode(secret, raw) && raw.size() == 32) {
      uint8_t digest[32];
      mbedtls_sha256(raw.data(), raw.size(), digest, 0);
      return base64urlEncode(digest, sizeof(digest));
    }
  }
  return std::string();
}

bool Secrets::hasServer() {
  ServerRecord record;
  return server(record);
}

bool Secrets::server(ServerRecord& out) {
  out = ServerRecord();
  lock();
  ServerRecord found;
  bool good = open_ && prefs_->isKey(kServerPin) && prefs_->isKey(kServerName) && prefs_->isKey(kServerPort);
  if (good) {
    found.address = readString(kServerAddress);  // absent when the computer gave none
    found.name = readString(kServerName);
    found.port = static_cast<uint16_t>(prefs_->getUShort(kServerPort, 0));
    const std::string pin = readString(kServerPin);
    good = parseFingerprint(pin.data(), pin.size(), found.fingerprint) && isUsableServer(found);
  }
  unlock();
  if (good) {
    out = found;
  }
  return good;
}

bool Secrets::setServer(const ServerRecord& record) {
  if (!isUsableServer(record)) {
    return false;
  }
  char pin[kPinHexChars + 1];
  fingerprintToHex(record.fingerprint, pin);
  lock();
  bool saved = open_;
  if (saved) {
    // The pin goes last: a power cut in the middle leaves no record at all, never a record
    // with the wrong pin.
    prefs_->remove(kServerPin);
    writeString(kServerAddress, record.address);
    writeString(kServerName, record.name);
    saved = prefs_->putUShort(kServerPort, record.port) == sizeof(uint16_t) && prefs_->putString(kServerPin, pin) == kPinHexChars;
  }
  unlock();
  return saved;
}

bool Secrets::setServerAddress(const std::string& address) {
  if (!isIpv4Address(address) && !isIpv6Address(address)) {
    return false;
  }
  lock();
  const bool stored = open_ && prefs_->isKey(kServerPin);
  if (stored) {
    writeString(kServerAddress, address);
  }
  unlock();
  return stored;
}

void Secrets::clearServer() {
  lock();
  if (open_) {
    prefs_->remove(kServerPin);  // first: with no pin there is no record
    prefs_->remove(kServerAddress);
    prefs_->remove(kServerPort);
    prefs_->remove(kServerName);
  }
  unlock();
}

StoredSettings Secrets::settings() {
  StoredSettings s;
  lock();
  if (open_) {
    s.paused = prefs_->getBool(kPaused, false);
    s.speakNotices = prefs_->getBool(kSpeak, true);
    const uint8_t percent = prefs_->getUChar(kVolume, 60);
    s.volumePercent = percent > 100 ? 100 : percent;
    const std::string voice = readString(kVoice);
    std::strncpy(s.voice, voice.c_str(), sizeof(s.voice) - 1);
    s.voice[sizeof(s.voice) - 1] = '\0';
  }
  unlock();
  return s;
}

void Secrets::saveSettings(const StoredSettings& settings) {
  lock();
  if (open_) {
    prefs_->putBool(kPaused, settings.paused);
    prefs_->putBool(kSpeak, settings.speakNotices);
    prefs_->putUChar(kVolume, settings.volumePercent > 100 ? 100 : settings.volumePercent);
    writeString(kVoice, settings.voice);
  }
  unlock();
}

std::string Secrets::packVoice() {
  lock();
  std::string value = readString(kPackVoice);
  unlock();
  return value;
}

void Secrets::setPackVoice(const std::string& voice) {
  lock();
  writeString(kPackVoice, voice);
  unlock();
}

uint32_t Secrets::nextNoteSeq() {
  lock();
  const uint32_t value = open_ ? prefs_->getUInt(kNoteSeq, 0) : 0;
  unlock();
  return value;
}

void Secrets::setNextNoteSeq(uint32_t seq) {
  lock();
  if (open_) {
    prefs_->putUInt(kNoteSeq, seq);
  }
  unlock();
}

uint32_t Secrets::inboxAfter() {
  lock();
  const uint32_t value = open_ ? prefs_->getUInt(kInboxAfter, 0) : 0;
  unlock();
  return value;
}

void Secrets::setInboxAfter(uint32_t seq) {
  lock();
  if (open_) {
    prefs_->putUInt(kInboxAfter, seq);
  }
  unlock();
}

bool Secrets::hasSetupPassphrase() {
  lock();
  const bool has = isSetupPassphrase(readString(kSetupPass));
  unlock();
  return has;
}

std::string Secrets::setupPassphrase() {
  lock();
  std::string value = readString(kSetupPass);
  if (!isSetupPassphrase(value)) {
    // Missing, or damaged: made again from fresh bytes. A few tries, since a try
    // can in theory run out of bytes below the alphabet's limit.
    value.clear();
    uint8_t raw[64];
    for (int attempt = 0; attempt < 8 && value.empty(); ++attempt) {
      esp_fill_random(raw, sizeof(raw));
      makeSetupPassphrase(raw, sizeof(raw), value);
    }
    std::memset(raw, 0, sizeof(raw));
    if (!value.empty()) {
      writeString(kSetupPass, value);
    }
  }
  unlock();
  return value;
}

void Secrets::clearAll() {
  lock();
  if (open_) {
    prefs_->clear();
  }
  unlock();
}

}  // namespace pet
