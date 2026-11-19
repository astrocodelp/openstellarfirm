#include "store/note_store_fs.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <cstring>

#include "core/note_queue.h"
#include "hw/log.h"

namespace pet {

namespace {

constexpr const char* kNotesDir = "/notes";
constexpr size_t kWriteChunk = 4096;

bool g_mounted = false;

std::string audioPath(const std::string& name) { return std::string(kNotesDir) + "/" + name + ".wav"; }
std::string metaPath(const std::string& name) { return std::string(kNotesDir) + "/" + name + ".json"; }
std::string tempPath(const std::string& name) { return std::string(kNotesDir) + "/" + name + ".tmp"; }

// The part of a path after the last "/": File::name() is already that in
// Arduino-ESP32 3.x, but a full path would break the matching below.
std::string baseName(const char* path) {
  const char* slash = std::strrchr(path, '/');
  return std::string(slash == nullptr ? path : slash + 1);
}

bool endsWith(const std::string& text, const char* suffix) {
  const size_t n = std::strlen(suffix);
  return text.size() >= n && text.compare(text.size() - n, n, suffix) == 0;
}

// Every file name in /notes.
std::vector<std::string> notesDirectory() {
  std::vector<std::string> names;
  File dir = LittleFS.open(kNotesDir);
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

bool mountFlash() {
  if (g_mounted) {
    return true;
  }
  // The partition table calls the partition "littlefs" (partitions_pet.csv).
  if (!LittleFS.begin(false, "/littlefs", 10, "littlefs")) {
    PET_LOG("flash: mount failed, formatting");
    if (!LittleFS.begin(true, "/littlefs", 10, "littlefs")) {
      return false;
    }
  }
  if (!LittleFS.exists(kNotesDir)) {
    LittleFS.mkdir(kNotesDir);
  }
  if (!LittleFS.exists("/voice")) {
    LittleFS.mkdir("/voice");
  }
  g_mounted = true;
  return true;
}

size_t flashFreeBytes() {
  const size_t total = LittleFS.totalBytes();
  const size_t used = LittleFS.usedBytes();
  return used >= total ? 0 : total - used;
}

void NoteStoreFs::begin() {
  // A .wav with no .json never finished; a .tmp is a record that never got its
  // final name. Neither is a note.
  const std::vector<std::string> names = notesDirectory();
  for (const std::string& file : names) {
    if (endsWith(file, ".tmp")) {
      LittleFS.remove((std::string(kNotesDir) + "/" + file).c_str());
    } else if (endsWith(file, ".wav")) {
      const std::string name = file.substr(0, file.size() - 4);
      if (!LittleFS.exists(metaPath(name).c_str())) {
        LittleFS.remove(audioPath(name).c_str());
      }
    }
  }
}

void NoteStoreFs::closeRead() {
  if (readFile_) {
    readFile_.close();
  }
  readName_.clear();
}

bool NoteStoreFs::list(std::vector<std::string>& names) {
  names.clear();
  if (!g_mounted) {
    return false;
  }
  const std::vector<std::string> files = notesDirectory();
  for (const std::string& file : files) {
    if (endsWith(file, ".json")) {
      const std::string name = file.substr(0, file.size() - 5);
      if (LittleFS.exists(audioPath(name).c_str())) {
        names.push_back(name);
      }
    }
  }
  return true;
}

bool NoteStoreFs::writeNote(const std::string& name, const uint8_t* wavBytes, size_t len, const std::string& metaJson) {
  if (!g_mounted || wavBytes == nullptr || len == 0) {
    return false;
  }
  closeRead();
  const std::string wav = audioPath(name);
  const std::string json = metaPath(name);
  const std::string temp = tempPath(name);
  if (LittleFS.exists(json.c_str())) {
    return false;  // "replacing nothing that exists"
  }

  bool ok = false;
  File file = LittleFS.open(wav.c_str(), FILE_WRITE);
  if (file) {
    ok = true;
    size_t done = 0;
    while (ok && done < len) {
      const size_t n = (len - done) < kWriteChunk ? (len - done) : kWriteChunk;
      ok = file.write(wavBytes + done, n) == n;
      done += n;
      // Let the audio and lights tasks run between chunks of a long write.
      vTaskDelay(1);
    }
    file.close();
  }
  if (ok) {
    // The record goes last and under a temporary name: the rename is what makes
    // the note exist.
    File meta = LittleFS.open(temp.c_str(), FILE_WRITE);
    ok = false;
    if (meta) {
      ok = meta.write(reinterpret_cast<const uint8_t*>(metaJson.data()), metaJson.size()) == metaJson.size();
      meta.close();
    }
    ok = ok && LittleFS.rename(temp.c_str(), json.c_str());
  }
  if (!ok) {
    LittleFS.remove(wav.c_str());
    LittleFS.remove(temp.c_str());
    LittleFS.remove(json.c_str());
  }
  return ok;
}

bool NoteStoreFs::readMeta(const std::string& name, std::string& metaJson) {
  metaJson.clear();
  File file = LittleFS.open(metaPath(name).c_str(), FILE_READ);
  if (!file) {
    return false;
  }
  char buffer[256];
  const size_t n = file.read(reinterpret_cast<uint8_t*>(buffer), sizeof(buffer));
  file.close();
  metaJson.assign(buffer, n);
  return n > 0;
}

bool NoteStoreFs::writeMeta(const std::string& name, const std::string& metaJson) {
  if (!g_mounted || !LittleFS.exists(metaPath(name).c_str())) {
    return false;  // only the record of a note that exists
  }
  closeRead();
  const std::string json = metaPath(name);
  const std::string temp = tempPath(name);
  bool ok = false;
  File meta = LittleFS.open(temp.c_str(), FILE_WRITE);
  if (meta) {
    ok = meta.write(reinterpret_cast<const uint8_t*>(metaJson.data()), metaJson.size()) == metaJson.size();
    meta.close();
  }
  // LittleFS renames over an existing file in one step, so a power cut leaves the old
  // record or the new one, never neither: a note with no record is deleted at the
  // next start (begin()), and that would lose it. The old record is never removed
  // first; if the rename is refused, it simply stays.
  ok = ok && LittleFS.rename(temp.c_str(), json.c_str());
  if (!ok) {
    LittleFS.remove(temp.c_str());
  }
  return ok;
}

bool NoteStoreFs::remove(const std::string& name) {
  if (readName_ == name) {
    closeRead();
  }
  // The record first: without it the note no longer exists, even if the audio
  // removal is interrupted (begin() clears the leftover audio).
  const bool metaGone = !LittleFS.exists(metaPath(name).c_str()) || LittleFS.remove(metaPath(name).c_str());
  const bool audioGone = !LittleFS.exists(audioPath(name).c_str()) || LittleFS.remove(audioPath(name).c_str());
  return metaGone && audioGone;
}

size_t NoteStoreFs::freeBytes() { return flashFreeBytes(); }

long NoteStoreFs::sizeOf(const std::string& name) {
  File file = LittleFS.open(audioPath(name).c_str(), FILE_READ);
  if (!file) {
    return -1;
  }
  const long size = static_cast<long>(file.size());
  file.close();
  return size;
}

size_t NoteStoreFs::readNote(const std::string& name, size_t offset, uint8_t* out, size_t len) {
  if (out == nullptr || len == 0) {
    return 0;
  }
  // An upload reads one note front to back in small pieces: keep it open.
  if (!readFile_ || readName_ != name) {
    closeRead();
    readFile_ = LittleFS.open(audioPath(name).c_str(), FILE_READ);
    if (!readFile_) {
      return 0;
    }
    readName_ = name;
  }
  if (readFile_.position() != offset && !readFile_.seek(static_cast<uint32_t>(offset))) {
    return 0;
  }
  return readFile_.read(out, len);
}

void NoteStoreFs::wipe() {
  closeRead();
  const std::vector<std::string> files = notesDirectory();
  for (const std::string& file : files) {
    LittleFS.remove((std::string(kNotesDir) + "/" + file).c_str());
  }
}

}  // namespace pet
