#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <cstdint>
#include <string>

#include "generated/protocol.h"

class Preferences;

namespace pet {

// What the owner sets in Settings and the pet keeps between power-ups. The server
// is the truth; the heartbeat answer rewrites these, and the copy here only lets
// a pet that starts offline have its volume and voice right.
struct StoredSettings {
  bool paused = false;
  bool speakNotices = true;
  uint8_t volumePercent = 60;
  char voice[16] = {0};  // a voice id, or empty until the first answer
};

// The pet's non-volatile store (NVS, namespace "pet"): the Wi-Fi it joined, the
// device secret and the device token, the settings, and the counters the notes and
// the inbox need. One reader and writer at a time (a mutex inside); the values
// are copied out, never pointed into.
//
// Rule 1: the pet holds only its device token (the device secret lives only from a
// pair request until its claim ends, either way). Rule 2: the token is only ever a
// base64url string here and in the Authorization header of a request to the one
// configured address; it is never logged. On production units NVS is encrypted
// (flash encryption, phase 4); a development unit keeps it in the clear.
class Secrets {
 public:
  Secrets();
  ~Secrets();
  Secrets(const Secrets&) = delete;
  Secrets& operator=(const Secrets&) = delete;

  bool begin();

  // -- Wi-Fi
  bool hasWifi();
  std::string wifiSsid();
  std::string wifiPassword();
  bool setWifi(const std::string& ssid, const std::string& password);

  // -- Pairing
  // Paired means a device token is stored.
  bool paired();
  std::string token();
  std::string deviceId();
  bool setPaired(const std::string& token, const std::string& deviceId);

  // The 256-bit secret only this pet knows, as base64url, made on first use. The
  // claim sends it; the pair request sends only its SHA-256.
  std::string deviceSecret();
  // base64url(SHA-256(the secret's 32 bytes)): the `deviceKey` of a pair request.
  std::string deviceKey();
  // A new secret for a new pairing attempt, so a request from an earlier try can
  // never be claimed by this one.
  std::string newDeviceSecret();
  // Forgets the secret. A claim that was refused, expired or never came leaves it
  // with no use, and the pet must not keep a second credential next to its token
  // (rule 1); setPaired() does the same when the claim worked.
  void clearDeviceSecret();

  // -- Settings and counters
  StoredSettings settings();
  void saveSettings(const StoredSettings& settings);
  // The voice whose pack file is on flash ("" for none).
  std::string packVoice();
  void setPackVoice(const std::string& voice);
  uint32_t nextNoteSeq();
  void setNextNoteSeq(uint32_t seq);
  // The last inbox notice the pet has handled, so a restart does not replay
  // notices the server still holds for a day.
  uint32_t inboxAfter();
  void setInboxAfter(uint32_t seq);

  // -- The setup network's passphrase (core/setup_access.h)
  // The WPA2 passphrase of the pet's own setup network, made on first use and kept
  // until the pet is forgotten. Only the pet's voice tells it. Empty only when no
  // valid one could be made, and then the setup network must not start (it would
  // be open). The hardware random numbers are true random only while the radio is
  // on, so the caller makes sure it is (main.cpp at boot, doForget()).
  bool hasSetupPassphrase();
  std::string setupPassphrase();

  // Forget: the token, the secret, the Wi-Fi, the settings, the counters and the
  // setup network's passphrase.
  void clearAll();

 private:
  std::string readString(const char* key);
  void writeString(const char* key, const std::string& value);
  void lock();
  void unlock();

  Preferences* prefs_ = nullptr;
  SemaphoreHandle_t mutex_ = nullptr;
  bool open_ = false;
};

}  // namespace pet
