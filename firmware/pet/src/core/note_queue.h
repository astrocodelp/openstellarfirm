#pragma once

// Saved notes: what the pet records while it is offline, kept until OpenStellarFirm
// confirms them (rule 6 of docs/desk-pets-plan.md). This is the logic over an
// abstract NoteStore; the hardware adapter (store/note_store_fs.cpp) puts the
// notes on LittleFS, the tests keep them in memory.
//
// A note is the finished upload, a WAV file of IMA-ADPCM, plus a small JSON
// record with its turn id and the time it was recorded:
//
//   {"turn":"<uuid>","recordedAt":"<iso 8601>"}
//
// When OpenStellarFirm refuses a note for its content (a silent or damaged recording,
// too long) the record gets the status as well, {"turn":..,"recordedAt":..,
// "refused":422}. The note stays (rule 6: only a 200 or 208 deletes it) but is
// never sent again, so it is not transcribed again on every boot, and it does not
// count as waiting.
//
// Notes are named by an 8-digit zero-padded sequence number ("00000042"). The
// queue hands them out lowest first, so they reach OpenStellarFirm in the order
// they were spoken. The caller keeps `nextSeq()` in NVS so a number is never
// used twice, even after a note was confirmed and deleted.
//
// A note is deleted only by confirm(), and the caller calls that only after
// OpenStellarFirm answered 200 or 208 for its turn id.

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "generated/protocol.h"

namespace pet {

class NoteStore {
 public:
  virtual ~NoteStore() = default;

  // All note names present (each one has both its audio and its record).
  virtual bool list(std::vector<std::string>& names) = 0;
  // Stores the audio and the record under `name`, replacing nothing that exists.
  // False when it could not be written (the adapter removes a half-written note).
  virtual bool writeNote(const std::string& name, const uint8_t* wavBytes, size_t len, const std::string& metaJson) = 0;
  virtual bool readMeta(const std::string& name, std::string& metaJson) = 0;
  // Replaces the record of a note that exists, leaving the audio alone. All or
  // nothing: when it returns false the old record is still there, so a power cut
  // can never leave a note without its record (which would lose it).
  virtual bool writeMeta(const std::string& name, const std::string& metaJson) = 0;
  // Deletes both parts. True when the note is gone.
  virtual bool remove(const std::string& name) = 0;
  virtual size_t freeBytes() = 0;
  // The audio's length in bytes, or -1 when the note does not exist.
  virtual long sizeOf(const std::string& name) = 0;
  // Reads up to `len` bytes of the audio from `offset`; returns how many were read.
  virtual size_t readNote(const std::string& name, size_t offset, uint8_t* out, size_t len) = 0;
};

enum class AddResult : uint8_t {
  Saved,
  // PET_SAVED_NOTES_MAX notes are waiting already ("my memory is full").
  Full,
  // The audio plus the reserve does not fit in the free space, the store could
  // not write it, or there was nothing to store.
  NoSpace,
};

// What the sync needs to send the oldest note.
struct NoteInfo {
  std::string name;
  uint32_t seq = 0;
  // The turn id to send as X-Pet-Turn. Empty when the record could not be read:
  // the caller then makes a new id (a duplicate is possible but the note is not lost).
  std::string turn;
  // The time it was recorded (ISO 8601) for X-Pet-Recorded-At, or empty.
  std::string recordedAt;
  // The audio's size in bytes (the upload's Content-Length), 0 if unknown.
  size_t bytes = 0;
  // The status OpenStellarFirm refused this note with (400, 413, 415, 422...), or 0.
  // A refused note is not sent again.
  int refused = 0;
};

// What a note's record holds.
struct NoteMeta {
  std::string turn;
  std::string recordedAt;
  int refused = 0;  // 0 when the note was never refused
};

class NoteQueue {
 public:
  // The largest sequence number the 8-digit name holds.
  static constexpr uint32_t kMaxSeq = 99999999;
  // Free space that must stay after a note is stored, so the voice pack and the
  // settings never run out of room.
  static constexpr size_t kReserveBytes = 64 * 1024;

  explicit NoteQueue(NoteStore& store, uint32_t nextSeq = 0);

  // Reads the notes already on the store (after a reboot). Returns false when
  // the store could not be listed; the queue is empty then. Moves nextSeq past
  // any note found, so a stale saved counter cannot reuse a number.
  bool load();

  // Stores a finished upload. See AddResult. `recordedAtIso` may be empty (the
  // clock was not set yet).
  AddResult add(const std::string& turnId, const std::string& recordedAtIso, const uint8_t* wavBytes, size_t len);

  // Every note on the store, refused ones included: the limit of 50 and the room
  // in flash are about all of them.
  size_t count() const { return seqs_.size(); }
  bool empty() const { return seqs_.empty(); }
  // The notes still to send: those OpenStellarFirm has not refused. This is what the
  // heartbeat reports and what makes the pet sync.
  size_t pending() const { return seqs_.size() - refused_.size(); }

  // The note with the lowest sequence number. False when there are none.
  bool oldest(NoteInfo& out);

  // The note with the lowest sequence number above `afterSeq`. The sync uses it
  // to go on to the next note when OpenStellarFirm refused one note's content, so one
  // bad note does not hold up the rest. False when there is no such note.
  bool next(uint32_t afterSeq, NoteInfo& out);

  // Deletes a note OpenStellarFirm confirmed. False if it is not in the queue or the
  // store could not remove it (it stays, and is sent again with the same turn id).
  bool confirm(const std::string& name);

  // OpenStellarFirm refused this note's content with `status`: keep it, and never send
  // it again, not even after a restart. Nothing is deleted (rule 6). The refusal
  // holds for this run in any case; the return value says whether it was also
  // written to the note's record (false: the record could not be read or written,
  // so after a restart the note is tried once more).
  bool markRefused(const std::string& name, int status);
  bool isRefused(uint32_t seq) const;

  uint32_t nextSeq() const { return nextSeq_; }

  static std::string nameFor(uint32_t seq);
  static bool parseName(const std::string& name, uint32_t& seq);
  static std::string makeMeta(const std::string& turn, const std::string& recordedAt, int refused = 0);
  // Reads the fields from a record. False when it is not a JSON object of strings
  // (and the one number "refused") or has no "turn".
  static bool parseMeta(const std::string& json, NoteMeta& out);
  static bool parseMeta(const std::string& json, std::string& turn, std::string& recordedAt);

 private:
  void describe(uint32_t seq, NoteInfo& out);

  NoteStore& store_;
  uint32_t nextSeq_;
  std::vector<uint32_t> seqs_;     // ascending
  std::vector<uint32_t> refused_;  // ascending, a subset of seqs_
};

}  // namespace pet
