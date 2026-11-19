#pragma once

#include <FS.h>

#include <string>
#include <vector>

#include "core/note_queue.h"

namespace pet {

// Mounts the flash file system (LittleFS on the partition labelled "littlefs")
// and makes /notes and /voice. Safe to call again. If the partition cannot be
// mounted it is formatted once: its contents are saved notes and a voice pack, and
// a damaged file system holds neither in a usable way. False if it still fails.
bool mountFlash();

// Free bytes on that file system (the total minus what is used).
size_t flashFreeBytes();

// Saved notes on LittleFS: /notes/<name>.wav is the IMA-ADPCM WAV file as it will
// be uploaded, /notes/<name>.json the small record (turn id, time). The record is
// written last and is what makes a note exist: a power cut in the middle leaves a
// .wav with no record, which begin() deletes. Rule 6: remove() is the only way a
// note leaves the store, and the queue calls it only after a 200 or 208.
//
// Not thread safe: the network task owns it (it is the only one that adds, reads
// and confirms notes).
class NoteStoreFs : public NoteStore {
 public:
  // Removes what a power cut left half written. mountFlash() must have worked.
  void begin();

  bool list(std::vector<std::string>& names) override;
  bool writeNote(const std::string& name, const uint8_t* wavBytes, size_t len, const std::string& metaJson) override;
  bool readMeta(const std::string& name, std::string& metaJson) override;
  bool writeMeta(const std::string& name, const std::string& metaJson) override;
  bool remove(const std::string& name) override;
  size_t freeBytes() override;
  long sizeOf(const std::string& name) override;
  size_t readNote(const std::string& name, size_t offset, uint8_t* out, size_t len) override;

  // Forgetting the pet (never a sync): every note goes, confirmed or not.
  void wipe();

 private:
  void closeRead();

  File readFile_;
  std::string readName_;
};

}  // namespace pet
