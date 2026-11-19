#ifdef PET_DEVBOARD

#include "devboard/bridge.h"

#include <Arduino.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <atomic>
#include <cstdio>
#include <cstring>
#include <new>
#include <string>
#include <vector>

#include "core/adpcm.h"
#include "core/base64url.h"
#include "hw/log.h"

namespace pet {
namespace devboard {

namespace {

// The Nano ESP32's own RGB LED, active low (GPIO numbers: the build uses them).
constexpr int kLedRed = 46;
constexpr int kLedGreen = 0;
constexpr int kLedBlue = 45;

constexpr char kPrefix[] = "@dev1 ";
constexpr size_t kPrefixLen = sizeof(kPrefix) - 1;
// The longest line the page sends: a microphone piece of 320 samples is 854
// characters of base64url, with room to spare.
constexpr size_t kLineMax = 1400;

// A small ring of T, guarded by one spinlock (each use is a few copies).
template <typename T, size_t N>
class Ring {
 public:
  // All of it or nothing, so a line is never cut in two.
  bool pushAll(const T* data, size_t n) {
    bool ok = false;
    portENTER_CRITICAL(&lock_);
    if (N - size_ >= n) {
      for (size_t i = 0; i < n; ++i) {
        buf_[(head_ + size_ + i) % N] = data[i];
      }
      size_ += n;
      ok = true;
    }
    portEXIT_CRITICAL(&lock_);
    return ok;
  }
  // As much as fits, dropping the rest.
  void pushSome(const T* data, size_t n) {
    portENTER_CRITICAL(&lock_);
    for (size_t i = 0; i < n && size_ < N; ++i) {
      buf_[(head_ + size_) % N] = data[i];
      ++size_;
    }
    portEXIT_CRITICAL(&lock_);
  }
  size_t take(T* out, size_t n) {
    portENTER_CRITICAL(&lock_);
    size_t k = 0;
    for (; k < n && size_ > 0; ++k) {
      out[k] = buf_[head_];
      head_ = (head_ + 1) % N;
      --size_;
    }
    portEXIT_CRITICAL(&lock_);
    return k;
  }
  size_t size() const { return size_; }
  void clear() {
    portENTER_CRITICAL(&lock_);
    head_ = 0;
    size_ = 0;
    portEXIT_CRITICAL(&lock_);
  }

 private:
  T buf_[N] = {};
  size_t head_ = 0;
  volatile size_t size_ = 0;
  portMUX_TYPE lock_ = portMUX_INITIALIZER_UNLOCKED;
};

Ring<uint8_t, 2048> setupBytes;    // pet-usb lines for net/usb_setup.cpp
// One second of the laptop's microphone. Made in begin(), in PSRAM: as a static object
// its 32 KB came out of internal RAM, which TLS needs (see hw/log.cpp).
using MicRing = Ring<int16_t, 16000>;
MicRing* micSamples = nullptr;

std::atomic<bool> micOn{false};
std::atomic<bool> button{false};
std::atomic<bool> micSwitch{true};
const char* kind = "astronaut";

// The speaker copy: pairs averaged to 11025 Hz, one IMA-ADPCM block of 132 bytes
// (257 samples) a line. Raw PCM16 at that rate is about 30 KB a second of text,
// more than the port drains through its 64-byte USB buffer (half the lines were
// dropped); ADPCM is a quarter of it.
constexpr uint16_t kSpkBlockAlign = 132;
constexpr size_t kSpkSamples = (kSpkBlockAlign - 4) * 2 + 1;
int16_t spk[kSpkSamples];
AdpcmState spkState;
size_t spkCount = 0;
int32_t spkCarry = 0;
bool spkHalf = false;

// Counters for "@dev1 stats", to see where audio stops.
std::atomic<uint32_t> spkIn{0};      // samples the speaker played
std::atomic<uint32_t> spkSent{0};    // speaker lines queued
std::atomic<uint32_t> spkDropped{0}; // speaker lines the queue had no room for
std::atomic<uint32_t> spkNoConn{0};
std::atomic<uint32_t> portFalse{0};   // reader passes that saw the port as not connected
std::atomic<uint32_t> portPasses{0};  // speaker lines dropped because no computer had the port
std::atomic<uint32_t> micIn{0};      // microphone samples the page sent
std::atomic<uint32_t> micTaken{0};   // microphone samples the firmware took

struct NamedCommand {
  const char* name;
  Command fn;
};
NamedCommand commands[4];
int commandCount = 0;

struct Fact {
  const char* key;
  int value;
};
Fact facts[12];
std::atomic<int> factCount{0};

Rgb lastLed{0, 0, 0};
bool lastLedValid = false;

SerialSend sendLine(const std::string& line) {
  return serialSendLine(reinterpret_cast<const uint8_t*>(line.data()), line.size());
}

void sendHello() { sendLine(std::string(kPrefix) + "hello " + kind + "\n"); }

void handleDevLine(const char* body, size_t len) {
  const std::string text(body, len);
  if (text == "hello") {
    sendHello();
  } else if (text == "stats") {
    char line[160];
    std::snprintf(line, sizeof(line), "%sstats spk-in %lu spk-sent %lu spk-dropped %lu spk-noconn %lu mic-in %lu mic-taken %lu\n",
                  kPrefix, static_cast<unsigned long>(spkIn.load()), static_cast<unsigned long>(spkSent.load()),
                  static_cast<unsigned long>(spkDropped.load()), static_cast<unsigned long>(spkNoConn.load()), static_cast<unsigned long>(micIn.load()),
                  static_cast<unsigned long>(micTaken.load()));
    sendLine(line);
    std::snprintf(line, sizeof(line), "%sport passes %lu not-connected %lu\n", kPrefix,
                  static_cast<unsigned long>(portPasses.load()), static_cast<unsigned long>(portFalse.load()));
    sendLine(line);
    std::string list = std::string(kPrefix) + "facts";
    for (int i = 0; i < factCount.load(); ++i) {
      list += ' ';
      list += facts[i].key;
      list += '=';
      list += std::to_string(facts[i].value);
    }
    sendLine(list + "\n");
  } else if (const Command registered = [&]() -> Command {
               for (int i = 0; i < commandCount; ++i) {
                 if (text == commands[i].name) {
                   return commands[i].fn;
                 }
               }
               return nullptr;
             }()) {
    registered();
  } else if (text == "restart") {
    ESP.restart();
  } else if (text == "btn 1" || text == "btn 0") {
    button.store(text == "btn 1");
  } else if (text == "micsw 1" || text == "micsw 0") {
    micSwitch.store(text == "micsw 1");
  } else if (text.rfind("mic ", 0) == 0) {
    if (!micOn.load()) {
      return;  // nothing is taken while the board is not listening
    }
    std::vector<uint8_t> bytes;
    if (!base64urlDecode(text.substr(4), bytes)) {
      return;
    }
    const size_t n = bytes.size() / 2;
    int16_t samples[700];
    const size_t count = n < 700 ? n : 700;
    for (size_t i = 0; i < count; ++i) {
      samples[i] = static_cast<int16_t>(bytes[2 * i] | (bytes[2 * i + 1] << 8));
    }
    if (micSamples != nullptr) {
      micSamples->pushSome(samples, count);
    }
    micIn.fetch_add(static_cast<uint32_t>(count));
  }
}

void readerTask(void*) {
  static char line[kLineMax + 2];
  size_t len = 0;
  bool overflow = false;
  for (;;) {
    bool worked = false;
    for (int budget = 4096; budget > 0 && Serial.available() > 0; --budget) {
      const int c = Serial.read();
      if (c < 0) {
        break;
      }
      worked = true;
      if (c == '\n') {
        if (!overflow) {
          if (len >= kPrefixLen && std::memcmp(line, kPrefix, kPrefixLen) == 0) {
            size_t end = len;
            if (end > 0 && line[end - 1] == '\r') {
              --end;
            }
            handleDevLine(line + kPrefixLen, end - kPrefixLen);
          } else {
            line[len] = '\n';
            setupBytes.pushAll(reinterpret_cast<const uint8_t*>(line), len + 1);
          }
        }
        len = 0;
        overflow = false;
      } else if (len < kLineMax) {
        line[len++] = static_cast<char>(c);
      } else {
        overflow = true;
      }
    }
    portPasses.fetch_add(1);
    if (!Serial) {
      portFalse.fetch_add(1);
    }
    serialPump();
    if (!worked) {
      vTaskDelay(1);
    }
  }
}

}  // namespace

void begin(const char* kindName) {
  kind = kindName;
  if (micSamples == nullptr) {
    void* room = heap_caps_malloc(sizeof(MicRing), MALLOC_CAP_SPIRAM);
    micSamples = room != nullptr ? new (room) MicRing() : new MicRing();
  }
  pinMode(kLedRed, OUTPUT);
  pinMode(kLedGreen, OUTPUT);
  pinMode(kLedBlue, OUTPUT);
  lightTee(Rgb{0, 0, 0});
  xTaskCreatePinnedToCore(readerTask, "devboard", 6144, nullptr, 4, nullptr, 0);
  sendHello();
  PET_LOG("devboard: this is the development board build, never a pet to pair for real");
}

int setupAvailable() { return static_cast<int>(setupBytes.size()); }

int setupRead() {
  uint8_t b = 0;
  return setupBytes.take(&b, 1) == 1 ? b : -1;
}

size_t micTake(int16_t* out, size_t n) {
  const size_t got = micSamples != nullptr ? micSamples->take(out, n) : 0;
  micTaken.fetch_add(static_cast<uint32_t>(got));
  return got;
}

void micLive(bool on) {
  if (micSamples != nullptr) {
    micSamples->clear();
  }
  micOn.store(on);
  sendLine(std::string(kPrefix) + (on ? "mic on\n" : "mic off\n"));
}

void speakerTee(const int16_t* mono, size_t n) {
  spkIn.fetch_add(static_cast<uint32_t>(n));
  for (size_t i = 0; i < n; ++i) {
    if (!spkHalf) {
      spkCarry = mono[i];
      spkHalf = true;
      continue;
    }
    spkHalf = false;
    spk[spkCount++] = static_cast<int16_t>((spkCarry + mono[i]) / 2);
    if (spkCount == kSpkSamples) {
      uint8_t bytes[kSpkBlockAlign];
      adpcmEncodeBlock(spk, kSpkSamples, spkState, bytes, kSpkBlockAlign);
      const SerialSend sent = sendLine(std::string(kPrefix) + "spk " + base64urlEncode(bytes, sizeof(bytes)) + "\n");
      (sent == SerialSend::Queued ? spkSent : sent == SerialSend::NotConnected ? spkNoConn : spkDropped).fetch_add(1);
      spkCount = 0;
    }
  }
}

void lightTee(const Rgb& led0) {
  if (lastLedValid && led0 == lastLed) {
    return;
  }
  lastLed = led0;
  lastLedValid = true;
  analogWrite(kLedRed, 255 - led0.r);
  analogWrite(kLedGreen, 255 - led0.g);
  analogWrite(kLedBlue, 255 - led0.b);
  char line[32];
  std::snprintf(line, sizeof(line), "%sled %02x%02x%02x\n", kPrefix, led0.r, led0.g, led0.b);
  sendLine(line);
}

void clipTee(const char* const* ids, size_t count) {
  std::string line = std::string(kPrefix) + "clip";
  for (size_t i = 0; i < count; ++i) {
    if (ids[i] != nullptr) {
      line += ' ';
      line += ids[i];
    }
  }
  line += '\n';
  sendLine(line);
}

void onCommand(const char* name, Command fn) {
  if (commandCount < 4) {
    commands[commandCount++] = NamedCommand{name, fn};
  }
}

void note(const char* key, int value) {
  const int i = factCount.load();
  if (i < 12) {
    facts[i] = Fact{key, value};
    factCount.store(i + 1);
  }
}

bool buttonDown() { return button.load(); }

bool micSwitchOn() { return micSwitch.load(); }

}  // namespace devboard
}  // namespace pet

#endif  // PET_DEVBOARD
