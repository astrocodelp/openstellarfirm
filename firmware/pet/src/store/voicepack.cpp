#include "store/voicepack.h"

#include <Arduino.h>
#include <LittleFS.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "hw/log.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

// The boot pack: a whole .sfvp file as a byte array, written by the voice pack
// tool (tools/voice-pack/README.md) and not kept in the repository. The header
// defines
//     static const unsigned char PET_BOOT_PACK[] = { ... };
//     static const unsigned int PET_BOOT_PACK_SIZE = sizeof(PET_BOOT_PACK);
// Without it the firmware builds and runs, but a unit cannot be set up: a line
// nobody can say is a tone, and the setup network's password is told only by voice.
#if defined(__has_include)
#if __has_include("generated/boot_pack.h")
#include "generated/boot_pack.h"
#define PET_HAVE_BOOT_PACK 1
#endif
#endif
#ifndef PET_HAVE_BOOT_PACK
#warning "No generated/boot_pack.h: this unit cannot be set up, because the setup network's password is told only by voice and every character would be the same tone. Render the boot pack first (see firmware/pet/tools/voice-pack/README.md)"
#endif

namespace pet {

namespace {

constexpr const char* kVoiceDir = "/voice";
constexpr size_t kGapMs = 60;
// After a spelled character (a confirm code, the setup network's password): long enough
// to type it before the next one.
constexpr size_t kCharGapMs = 700;

std::string baseName(const char* path) {
  const char* slash = std::strrchr(path, '/');
  return std::string(slash == nullptr ? path : slash + 1);
}

std::vector<std::string> voiceDirectory() {
  std::vector<std::string> names;
  File dir = LittleFS.open(kVoiceDir);
  if (!dir || !dir.isDirectory()) {
    return names;
  }
  File entry = dir.openNextFile();
  while (entry) {
    if (!entry.isDirectory()) {
      names.push_back(baseName(entry.name()));
    }
    entry.close();
    entry = dir.openNextFile();
  }
  dir.close();
  return names;
}

}  // namespace

// -- The file behind the downloaded pack -----------------------------------------

void VoicePackStore::FileSource::open(File file) {
  file_ = file;
  size_ = file_ ? file_.size() : 0;
}

void VoicePackStore::FileSource::close() {
  if (file_) {
    file_.close();
  }
  size_ = 0;
}

size_t VoicePackStore::FileSource::read(size_t offset, uint8_t* out, size_t len) {
  if (!file_ || out == nullptr || offset >= size_) {
    return 0;
  }
  if (file_.position() != offset && !file_.seek(static_cast<uint32_t>(offset))) {
    return 0;
  }
  return file_.read(out, std::min(len, size_ - offset));
}

// -- VoicePackStore -------------------------------------------------------------

VoicePackStore::VoicePackStore() = default;

VoicePackStore::~VoicePackStore() { delete bootSource_; }

void VoicePackStore::begin() {
  mutex_ = xSemaphoreCreateMutex();
#ifdef PET_HAVE_BOOT_PACK
  bootSource_ = new MemorySource(PET_BOOT_PACK, PET_BOOT_PACK_SIZE);
  bootLoaded_ = bootIndex_.load(*bootSource_);
  if (!bootLoaded_) {
    PET_LOG("voice: the boot pack in the firmware is not a pack this firmware reads");
  }
#else
  PET_LOG("voice: no boot pack in this build, missing lines are tones");
#endif
}

bool VoicePackStore::loadVoice(const char* voice) {
  char path[40];
  if (mutex_ == nullptr || !packPath(voice, false, path, sizeof(path))) {
    return false;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  packSource_.close();
  packIndex_.clear();
  voice_.clear();
  generation_.fetch_add(1);

  bool ok = false;
  File file = LittleFS.open(path, FILE_READ);
  if (file) {
    packSource_.open(file);
    ok = packIndex_.load(packSource_);
    if (ok) {
      voice_ = voice;
    } else {
      packSource_.close();
      packIndex_.clear();
    }
  }
  xSemaphoreGive(mutex_);
  return ok;
}

std::string VoicePackStore::voice() {
  if (mutex_ == nullptr) {
    return std::string();
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  std::string value = voice_;
  xSemaphoreGive(mutex_);
  return value;
}

bool VoicePackStore::find(const char* id, ClipLocation& out) {
  out = ClipLocation{};
  if (mutex_ == nullptr) {
    return false;
  }
  bool found = false;
  xSemaphoreTake(mutex_, portMAX_DELAY);
  if (packSource_.isOpen()) {
    const PackEntry* entry = packIndex_.find(id);
    if (entry != nullptr) {
      out.source = &packSource_;
      out.offset = entry->offset;
      out.length = entry->length;
      out.samples = entry->samples;
      found = true;
    }
  }
  if (!found && bootLoaded_) {
    const PackEntry* entry = bootIndex_.find(id);
    if (entry != nullptr) {
      out.source = bootSource_;
      out.offset = entry->offset;
      out.length = entry->length;
      out.samples = entry->samples;
      found = true;
    }
  }
  xSemaphoreGive(mutex_);
  return found;
}

size_t VoicePackStore::readClip(const ClipLocation& at, uint32_t generation, size_t offset, uint8_t* out, size_t len) {
  if (mutex_ == nullptr || at.source == nullptr) {
    return 0;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  // The generation is checked under the lock that every change of the file also
  // takes, so a file closed or replaced since the clip was found is never read.
  const size_t got = generation_.load() == generation ? at.source->read(static_cast<size_t>(at.offset) + offset, out, len) : 0;
  xSemaphoreGive(mutex_);
  return got;
}

bool VoicePackStore::tempPath(const char* voice, char* out, size_t cap) const { return packPath(voice, true, out, cap); }

bool VoicePackStore::validateTemp(const char* voice) {
  char path[40];
  if (!packPath(voice, true, path, sizeof(path))) {
    return false;
  }
  FileSource source;
  source.open(LittleFS.open(path, FILE_READ));
  PackIndex index;
  bool ok = source.isOpen() && index.load(source);
  // A pack that cannot say the basic lines would leave the pet worse off than
  // the boot pack does.
  for (int i = 0; ok && i < PET_BOOT_LINE_COUNT; ++i) {
    ok = index.find(PET_BOOT_LINE_IDS[i]) != nullptr;
  }
  source.close();
  return ok;
}

bool VoicePackStore::install(const char* voice) {
  char temp[40];
  char target[40];
  if (!packPath(voice, true, temp, sizeof(temp)) || !packPath(voice, false, target, sizeof(target))) {
    return false;
  }
  if (mutex_ != nullptr) {
    xSemaphoreTake(mutex_, portMAX_DELAY);
    packSource_.close();
    packIndex_.clear();
    voice_.clear();
    generation_.fetch_add(1);
    xSemaphoreGive(mutex_);
  }
  if (LittleFS.exists(target)) {
    LittleFS.remove(target);
  }
  if (!LittleFS.rename(temp, target)) {
    LittleFS.remove(temp);
    return false;
  }
  // The packs of other voices and leftovers of other downloads go.
  const std::string keep = baseName(target);
  for (const std::string& name : voiceDirectory()) {
    if (name != keep) {
      LittleFS.remove((std::string(kVoiceDir) + "/" + name).c_str());
    }
  }
  return loadVoice(voice);
}

void VoicePackStore::discardTemp(const char* voice) {
  char path[40];
  if (packPath(voice, true, path, sizeof(path)) && LittleFS.exists(path)) {
    LittleFS.remove(path);
  }
}

void VoicePackStore::removeAll() {
  if (mutex_ != nullptr) {
    xSemaphoreTake(mutex_, portMAX_DELAY);
    packSource_.close();
    packIndex_.clear();
    voice_.clear();
    generation_.fetch_add(1);
    xSemaphoreGive(mutex_);
  }
  for (const std::string& name : voiceDirectory()) {
    LittleFS.remove((std::string(kVoiceDir) + "/" + name).c_str());
  }
}

// -- ClipPlayer -----------------------------------------------------------------

void ClipPlayer::begin(Speaker& speaker, VoicePackStore& store) {
  speaker_ = &speaker;
  store_ = &store;
  mutex_ = xSemaphoreCreateMutex();
}

bool ClipPlayer::play(PlayTag tag, const char* const* ids, size_t count, uint32_t epoch) {
#ifdef PET_DEVBOARD
  // The laptop says the clips (there may be no boot pack on a bare board).
  if (ids != nullptr && count > 0) {
    devboard::clipTee(ids, count);
  }
#endif
  if (mutex_ == nullptr || ids == nullptr || count == 0 || count > kMaxClips) {
    return false;
  }
  Job job;
  job.tag = tag;
  job.epoch = epoch;
  for (size_t i = 0; i < count; ++i) {
    if (ids[i] == nullptr || ids[i][0] == '\0' || std::strlen(ids[i]) > kClipIdChars) {
      return false;
    }
    std::strncpy(job.ids[i], ids[i], kClipIdChars);
    job.ids[i][kClipIdChars] = '\0';
  }
  job.count = count;
  xSemaphoreTake(mutex_, portMAX_DELAY);
  pending_ = job;
  havePending_ = true;
  cancelled_ = false;
  active_.store(true);
  xSemaphoreGive(mutex_);
  return true;
}

bool ClipPlayer::play(PlayTag tag, const char* id) { return play(tag, &id, 1); }

bool ClipPlayer::playEpoch(uint32_t epoch, PlayTag tag, const char* id) { return play(tag, &id, 1, epoch); }

bool ClipPlayer::play(PlayTag tag, const char* first, const char* second) {
  if (second == nullptr || second[0] == '\0') {
    return play(tag, first);
  }
  const char* ids[2] = {first, second};
  return play(tag, ids, 2);
}

void ClipPlayer::cancel() {
  if (mutex_ == nullptr) {
    return;
  }
  xSemaphoreTake(mutex_, portMAX_DELAY);
  havePending_ = false;
  cancelled_ = true;
  xSemaphoreGive(mutex_);
}

bool ClipPlayer::pump() {
  if (mutex_ == nullptr) {
    return false;
  }
  bool did = false;
  bool take = false;
  Job incoming;
  xSemaphoreTake(mutex_, portMAX_DELAY);
  if (cancelled_) {
    cancelled_ = false;
    if (running_) {
      running_ = false;
      clipOpen_ = false;
      did = true;
    }
  }
  if (havePending_) {
    incoming = pending_;
    havePending_ = false;
    take = true;
  }
  xSemaphoreGive(mutex_);

  if (take) {
    job_ = incoming;
    next_ = 0;
    clipOpen_ = false;
    gapSamples_ = 0;
    toneSamples_ = 0;
    running_ = true;
    // Opening the stream replaces anything else that was playing.
    stream_ = job_.epoch == kAnyEpoch ? speaker_->open(job_.tag) : speaker_->open(job_.tag, job_.epoch);
    if (stream_ == 0) {
      running_ = false;
      if (job_.epoch == kAnyEpoch || speaker_->epoch() == job_.epoch) {
        // No speaker: the line is "played" at once, so whatever waits for it goes on.
        speaker_->notifyDrained(job_.tag);
      }
      // Otherwise the owner stopped the pet while this line was on its way: it is
      // dropped without a word, and nothing waits for it any more.
    }
    did = true;
  }
  if (running_) {
    did = produce() || did;
  }

  xSemaphoreTake(mutex_, portMAX_DELAY);
  active_.store(running_ || havePending_);
  xSemaphoreGive(mutex_);
  return did;
}

bool ClipPlayer::feedTone() {
  // 880 Hz at the pack's rate, a quarter of full scale: the stand-in for a clip
  // that no pack has.
  constexpr size_t kPiece = 256;
  if (speaker_->room() < kPiece) {
    return false;
  }
  const size_t n = std::min(toneSamples_, kPiece);
  int16_t piece[kPiece];
  for (size_t i = 0; i < n; ++i) {
    const float t = static_cast<float>(tonePhase_ + i) / static_cast<float>(PET_DOWN_SAMPLE_RATE);
    piece[i] = static_cast<int16_t>(8000.0f * std::sin(6.2831853f * 880.0f * t));
  }
  tonePhase_ += static_cast<uint32_t>(n);
  toneSamples_ -= n;
  if (!speaker_->feed(stream_, piece, n, 0)) {
    running_ = false;
  }
  return true;
}

bool ClipPlayer::produce() {
  constexpr size_t kPiece = 256;

  if (gapSamples_ > 0) {
    if (speaker_->room() < kPiece) {
      return false;
    }
    int16_t zeros[kPiece] = {};
    const size_t n = std::min(gapSamples_, kPiece);
    gapSamples_ -= n;
    if (!speaker_->feed(stream_, zeros, n, 0)) {
      running_ = false;
    }
    return true;
  }
  if (toneSamples_ > 0) {
    return feedTone();
  }

  if (!clipOpen_) {
    if (next_ >= job_.count) {
      speaker_->close(stream_);
      running_ = false;
      return true;
    }
    const char* id = job_.ids[next_++];
    ClipLocation location;
    if (store_->find(id, location) && location.length > 0 && location.samples > 0) {
      clip_ = location;
      clipPos_ = 0;
      decoder_.reset(location.samples);
      packGeneration_ = store_->generation();
      clipOpen_ = true;
    } else {
      PET_LOG("voice: no clip for a line, playing a tone");
      toneSamples_ = static_cast<size_t>(PET_DOWN_SAMPLE_RATE) * 150 / 1000;
      tonePhase_ = 0;
    }
    return true;
  }

  // A pack that was replaced while this clip played cannot be read on: go to the
  // next clip.
  if (store_->generation() != packGeneration_) {
    clipOpen_ = false;
    return true;
  }
  if (speaker_->room() < PET_ADPCM_SAMPLES_PER_BLOCK + 8) {
    return false;
  }
  if (clipPos_ >= clip_.length || decoder_.done()) {
    clipOpen_ = false;
    // The clip that just ended is job_.ids[next_ - 1].
    const bool spelled = next_ > 0 && std::strncmp(job_.ids[next_ - 1], "char-", 5) == 0;
    gapSamples_ = static_cast<size_t>(PET_DOWN_SAMPLE_RATE) * (spelled ? kCharGapMs : kGapMs) / 1000;
    return true;
  }
  const size_t want = std::min<size_t>(sizeof(block_), clip_.length - clipPos_);
  const size_t got = store_->readClip(clip_, packGeneration_, clipPos_, block_, want);
  if (got == 0) {
    clipOpen_ = false;
    return true;
  }
  size_t consumed = 0;
  const size_t n = decoder_.decode(block_, got, consumed, pcm_, sizeof(pcm_) / sizeof(pcm_[0]));
  if (decoder_.corrupt() || consumed == 0) {
    clipOpen_ = false;
    return true;
  }
  clipPos_ += static_cast<uint32_t>(consumed);
  if (n > 0 && !speaker_->feed(stream_, pcm_, n, 0)) {
    running_ = false;
  }
  return true;
}

}  // namespace pet
