#pragma once

#include <FS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "audio/speaker.h"
#include "core/adpcm.h"
#include "core/byte_source.h"
#include "core/voice_pack.h"

namespace pet {

// Where a clip's bytes are: which source, where in it, how long, how many samples.
struct ClipLocation {
  ByteSource* source = nullptr;
  uint32_t offset = 0;
  uint32_t length = 0;
  uint32_t samples = 0;
};

// The pet's saved voice. Two packs can answer for a clip id:
//   1. the downloaded pack of the pet's voice, /voice/<voice>.sfvp on LittleFS;
//   2. the boot pack compiled into the firmware (generated/boot_pack.h, made by
//      firmware/pet/tools/voice-pack): the setup lines, the characters of the
//      confirm code and the lines that must work before a pack was ever
//      downloaded, in one default voice. Without that header the firmware still
//      builds; a clip nobody has is then a short tone (ClipPlayer).
class VoicePackStore {
 public:
  VoicePackStore();
  ~VoicePackStore();

  // Reads the boot pack's table if there is one. mountFlash() must have run.
  void begin();

  // Opens /voice/<voice>.sfvp and reads its table. True when it is a pack this
  // firmware plays; the pack stays open for clips. A voice that is not one of
  // the six, a missing file or a damaged one leaves the boot pack as the only
  // source.
  bool loadVoice(const char* voice);

  // The voice whose pack is open ("" when none).
  std::string voice();

  // Where the clip is, in the downloaded pack first and then the boot pack.
  bool find(const char* id, ClipLocation& out);

  // Counts up whenever the open pack changes, so a clip that is being played
  // knows its file was swapped.
  uint32_t generation() const { return generation_.load(); }

  // Reads `len` bytes of a clip found by find(), from `offset` into the clip. Every
  // read of a pack goes through here: the network task closes and replaces the
  // pack's file under this lock (install, loadVoice, removeAll), and the audio task
  // must never read a file that is being closed. Returns 0 when the pack changed
  // since `generation` was read (the clip cannot be read on) or at the end.
  size_t readClip(const ClipLocation& at, uint32_t generation, size_t offset, uint8_t* out, size_t len);

  bool hasBootPack() const { return bootLoaded_; }

  // -- Downloading a pack (the network task drives this) --

  // Where the download goes and the checks it must pass before it replaces the
  // pack: a complete, well-formed pack for `voice`.
  bool tempPath(const char* voice, char* out, size_t cap) const;
  bool validateTemp(const char* voice);
  // Renames the checked file into place, removes the packs of other voices, and
  // opens it. Only call this when nothing is playing.
  bool install(const char* voice);
  // Deletes a failed download.
  void discardTemp(const char* voice);

  // Deletes every pack on flash (forgetting the pet keeps the boot pack only).
  void removeAll();

 private:
  class FileSource : public ByteSource {
   public:
    size_t size() const override { return size_; }
    size_t read(size_t offset, uint8_t* out, size_t len) override;
    void open(File file);
    void close();
    bool isOpen() const { return static_cast<bool>(file_); }

   private:
    File file_;
    size_t size_ = 0;
  };

  SemaphoreHandle_t mutex_ = nullptr;
  PackIndex packIndex_;
  FileSource packSource_;
  std::string voice_;
  PackIndex bootIndex_;
  MemorySource* bootSource_ = nullptr;
  bool bootLoaded_ = false;
  std::atomic<uint32_t> generation_{0};
};

// Plays clips of the voice pack through the speaker, one after the other as a
// single stream, decoding IMA-ADPCM piece by piece from flash. play() is called
// from any task; pump() runs in the audio task and does the work, so a long clip
// never blocks the caller. A new play() replaces the one in progress.
class ClipPlayer {
 public:
  // The longest sequence is the confirm code said three times: three lines and three
  // times its eight characters.
  static constexpr size_t kMaxClips = 32;
  // For a caller that decides for itself (the main loop, which also stops the
  // speaker): the line is played whatever the speaker's abort count is.
  static constexpr uint32_t kAnyEpoch = 0xFFFFFFFFu;

  void begin(Speaker& speaker, VoicePackStore& store);

  // The ids are copied. Unknown ids are skipped with a short tone, so the pet is
  // never silent about something it meant to say. Returns false if there are too
  // many ids or none.
  //
  // `epoch` is Speaker::epoch() as the caller read it when it was told to speak.
  // A caller on another task (the network task, after a request that took a while)
  // passes it so a line is not played if the owner stopped the pet in the meantime:
  // the stream is refused and nothing is said, nothing is reported.
  bool play(PlayTag tag, const char* const* ids, size_t count, uint32_t epoch = kAnyEpoch);
  bool play(PlayTag tag, const char* id);
  bool play(PlayTag tag, const char* first, const char* second);
  bool playEpoch(uint32_t epoch, PlayTag tag, const char* id);

  // Abandons a job (not the speaker: main.cpp aborts that itself).
  void cancel();

  // True while a job is waiting, being played or still feeding the speaker.
  bool active() const { return active_.load(); }

  // Audio task: moves the job along. True if it did something.
  bool pump();

 private:
  struct Job {
    PlayTag tag = PlayTag::Line;
    char ids[kMaxClips][kClipIdChars + 1] = {};
    size_t count = 0;
    uint32_t epoch = kAnyEpoch;
  };

  void startJob();
  bool produce();
  bool feedTone();

  Speaker* speaker_ = nullptr;
  VoicePackStore* store_ = nullptr;
  SemaphoreHandle_t mutex_ = nullptr;

  // The mailbox (play() writes, pump() takes).
  Job pending_;
  bool havePending_ = false;
  bool cancelled_ = false;

  // The job being played (only pump() touches these).
  Job job_;
  size_t next_ = 0;
  uint32_t stream_ = 0;
  bool running_ = false;
  std::atomic<bool> active_{false};

  bool clipOpen_ = false;
  ClipLocation clip_;
  uint32_t clipPos_ = 0;
  uint32_t packGeneration_ = 0;
  AdpcmBlockDecoder decoder_{PET_ADPCM_BLOCK_ALIGN};
  uint8_t block_[PET_ADPCM_BLOCK_ALIGN] = {};
  int16_t pcm_[PET_ADPCM_SAMPLES_PER_BLOCK + 8] = {};
  size_t gapSamples_ = 0;
  size_t toneSamples_ = 0;
  uint32_t tonePhase_ = 0;
};

}  // namespace pet
