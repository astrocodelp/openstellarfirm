#include "audio/mic.h"

#include <Arduino.h>
#include <esp_heap_caps.h>

#include <algorithm>

#include "hw/internal_alloc.h"
#include "hw/log.h"
#include "pins.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

namespace pet {

namespace {

// The microphone wakes up with a pop and the DC filter needs a moment to settle:
// the first 100 ms (1600 samples) are thrown away. The voice detector never sees
// them either, so the pop is not taken for speech.
constexpr uint32_t kWarmupSamples = PET_UP_SAMPLE_RATE / 10;

// Without PSRAM one smaller buffer in internal RAM (about 12 seconds) keeps the
// pet usable.
constexpr size_t kFallbackBytes = 96 * 1024;

}  // namespace

Mic::Mic() = default;

Mic::~Mic() {
  if (rx_ != nullptr) {
    i2s_del_channel(rx_);
  }
  for (uint8_t* buffer : buffers_) {
    if (buffer != nullptr) {
      heap_caps_free(buffer);
    }
  }
}

bool Mic::begin() {
  mutex_ = xSemaphoreCreateMutex();
  if (mutex_ == nullptr) {
    return false;
  }

  // A slot is the whole upload for the longest recording: the 60-byte header and
  // 120 seconds of ADPCM blocks, 966,716 bytes (core/recording_plan.h). Two of them
  // when the PSRAM has the room, one when it is short.
  bufferBytes_ = kRecordSlotBytes;
  const size_t freePsram = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
  const int wanted = std::min(recordingSlotsFor(freePsram), kSlots);
  int made = 0;
  for (int i = 0; i < wanted; ++i) {
    buffers_[i] = static_cast<uint8_t*>(heap_caps_malloc(bufferBytes_, MALLOC_CAP_SPIRAM));
    if (buffers_[i] != nullptr) {
      ++made;
    }
  }
  if (made == 0) {
    // No PSRAM (or too little): one shorter buffer in internal RAM.
    bufferBytes_ = kFallbackBytes;
    buffers_[0] = static_cast<uint8_t*>(heap_caps_malloc(bufferBytes_, MALLOC_CAP_8BIT));
    if (buffers_[0] == nullptr) {
      return false;
    }
    PET_LOG("mic: %u bytes of PSRAM free, recordings are limited to a few seconds", static_cast<unsigned>(freePsram));
  } else if (made < kSlots) {
    // One buffer fits and the other did not (or was not asked for): use the one we
    // have, and never promise a second slot.
    PET_LOG("mic: only one recording buffer (%u bytes of PSRAM were free)", static_cast<unsigned>(freePsram));
  }
  storeLimitSamples_ = recordingSamplesFor(bufferBytes_);

  // The receive channel, made now and left disabled: the receiver itself is not
  // started here (rule 4), start() enables it and stop() disables it. 24-bit samples
  // in 32-bit slots, left channel (the L/R pin is to ground). The microphone only
  // sends: no data-out pin, no master clock.
  const esp_err_t channel = withPsramHeld([this]() {
    i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
    esp_err_t err = i2s_new_channel(&chan, nullptr, &rx_);
    if (err != ESP_OK) {
      return err;
    }
    // Field by field: the IDF's clock macro lists its designators out of the
    // struct's order, which C++ refuses.
    i2s_std_config_t config = {};
    config.clk_cfg.sample_rate_hz = PET_UP_SAMPLE_RATE;
    config.clk_cfg.clk_src = I2S_CLK_SRC_DEFAULT;
    config.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
    config.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO);
    config.gpio_cfg.mclk = I2S_GPIO_UNUSED;
    config.gpio_cfg.bclk = static_cast<gpio_num_t>(PIN_MIC_SCK);
    config.gpio_cfg.ws = static_cast<gpio_num_t>(PIN_MIC_WS);
    config.gpio_cfg.dout = I2S_GPIO_UNUSED;
    config.gpio_cfg.din = static_cast<gpio_num_t>(PIN_MIC_SD);
    config.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
    err = i2s_channel_init_std_mode(rx_, &config);
    if (err != ESP_OK) {
      i2s_del_channel(rx_);
      rx_ = nullptr;
    }
    return err;
  });
  if (channel != ESP_OK) {
    PET_LOG("mic: the receive channel could not be made (%d)", static_cast<int>(channel));
    return false;
  }
  return true;
}

void Mic::setIndicator(IndicatorFn fn, void* context) {
  indicator_ = fn;
  indicatorContext_ = context;
}

bool Mic::switchOn() {
#ifdef PET_DEVBOARD
  return devboard::micSwitchOn();
#else
  return digitalRead(PIN_MIC_SWITCH) == HIGH;
#endif
}

Mic::Heard Mic::heard() const {
  Heard heard;
  heard.speechStarted = speechStarted_.load(std::memory_order_relaxed);
  heard.silenceMs = silenceMs_.load(std::memory_order_relaxed);
  heard.full = full_.load(std::memory_order_relaxed);
  return heard;
}

void Mic::publishHeard() {
  speechStarted_.store(vad_.speechStarted(), std::memory_order_relaxed);
  silenceMs_.store(vad_.silenceMs(), std::memory_order_relaxed);
  full_.store(writer_.full(), std::memory_order_relaxed);
}

bool Mic::start(int slot) {
  if (mutex_ == nullptr || rx_ == nullptr || slot < 0 || slot >= kSlots || buffers_[slot] == nullptr) {
    return false;
  }
  if (recording()) {
    return false;
  }
  // The MIC slide switch cuts the microphone's power. With it off there is nothing
  // to record, and the pet says so instead of showing the lime light.
  if (!switchOn()) {
    return false;
  }

  xSemaphoreTake(mutex_, portMAX_DELAY);
  if (!writer_.begin(buffers_[slot], bufferBytes_)) {
    xSemaphoreGive(mutex_);
    PET_LOG("mic: the slot is too small to record into");
    return false;
  }
  slot_ = slot;
  discard_ = kWarmupSamples;
  samples_.store(0, std::memory_order_relaxed);
  vad_.reset();
  publishHeard();
  dc_.reset();

  // The lime light first, then the receiver.
  if (indicator_ != nullptr) {
    indicator_(true, indicatorContext_);
  }
  const bool started = i2s_channel_enable(rx_) == ESP_OK;
  if (!started) {
    if (indicator_ != nullptr) {
      indicator_(false, indicatorContext_);
    }
    writer_.finish();  // nothing was recorded: lets the writer go
    slot_ = -1;
    xSemaphoreGive(mutex_);
    PET_LOG("mic: the receiver would not start");
    return false;
  }
#ifdef PET_DEVBOARD
  // The laptop is the microphone: it sends only from here until stop().
  devboard::micLive(true);
#endif
  recording_.store(true, std::memory_order_release);
  xSemaphoreGive(mutex_);
  return true;
}

bool Mic::pump() {
  if (!recording_.load(std::memory_order_acquire)) {
    return false;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  if (!recording_.load(std::memory_order_acquire)) {
    xSemaphoreGive(mutex_);
    return false;
  }
  size_t got = 0;
  if (i2s_channel_read(rx_, raw_, sizeof(raw_), &got, 100) != ESP_OK && got == 0) {
    xSemaphoreGive(mutex_);
    return false;
  }
  const size_t count = got / sizeof(raw_[0]);
#ifdef PET_DEVBOARD
  // Nothing is wired to the microphone pins: the receiver only keeps the time (it
  // delivers 16 kHz), and the samples are the laptop's, silence where it is behind.
  int16_t laptop[256] = {};
  devboard::micTake(laptop, count);
#endif
  size_t kept = 0;
  for (size_t i = 0; i < count; ++i) {
#ifdef PET_DEVBOARD
    const int16_t sample = dc_.process(laptop[i]);
#else
    const int16_t sample = dc_.process(pcm16FromI2s32(raw_[i]));
#endif
    if (discard_ > 0) {
      --discard_;
      continue;
    }
    pcm_[kept++] = sample;
  }
  if (kept > 0) {
    // The voice detector hears everything, even after the slot is full, so the state
    // machine can still see silence; the slot keeps what fits, as ADPCM, block by block.
    vad_.feed(pcm_, kept);
    writer_.push(pcm_, kept);
    samples_.store(writer_.samples(), std::memory_order_relaxed);
    publishHeard();
  }
  xSemaphoreGive(mutex_);
  return count > 0;
}

Recording Mic::stop() {
  Recording result;
  // The flag goes down BEFORE the lock is asked for. pump() runs on the audio task
  // (priority 6) and holds the lock while it waits for the receiver; it took the lock
  // straight back after each read, so this call (the main loop, priority 1, the same
  // core) waited for ever: the main loop froze with the microphone still on, outside
  // Listening (found on a bare Nano ESP32 with the devboard build). pump() looks at
  // the flag before it takes the lock, so now it lets go and the audio task sleeps.
  if (mutex_ == nullptr || !recording_.exchange(false, std::memory_order_acq_rel)) {
    return result;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  // The receiver stops first, and only then does the light go out.
  i2s_channel_disable(rx_);
#ifdef PET_DEVBOARD
  devboard::micLive(false);
#endif
  if (indicator_ != nullptr) {
    indicator_(false, indicatorContext_);
  }

  const uint32_t samples = writer_.samples();
  const uint16_t peak = writer_.peak();
  const size_t bytes = writer_.finish();  // the last block, zero padded, and the WAV header
  if (slot_ >= 0 && bytes > 0) {
    result.slot = slot_;
    result.wav = buffers_[slot_];
    result.bytes = bytes;
    result.samples = samples;
    result.peak = peak;
  }
  slot_ = -1;
  xSemaphoreGive(mutex_);
  return result;
}

}  // namespace pet
