#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "core/byte_source.h"
#include "generated/protocol.h"

namespace pet {

class Secrets;

// The answer to one call. `status` is the HTTP status, or 0 or below when there
// was no answer (-1 a network or TLS error, -2 a timeout). `error` and `line` are
// the JSON error body's "error" and "line" on a failure (docs/desk-pets-plan.md,
// "Errors everywhere"), empty otherwise.
struct ApiResult {
  int status = 0;
  char error[24] = {0};
  // Long enough for any clip id of the pack (the longest, "role-mechanical-engineer", is 24 characters).
  char line[32] = {0};
  // The body ended early (the connection broke while it was being read).
  bool truncated = false;

  bool ok() const { return status >= 200 && status < 300; }
};

// What the owner set in Settings, as the server sends it (the claim answer and the
// heartbeat answer). The quiet hours themselves stay on the server: it tells the
// pet only whether they are on now, so the pet needs no time zone database.
struct ServerSettings {
  bool valid = false;
  bool paused = false;
  bool speakNotices = true;
  float volume = 0.6f;
  char voice[16] = {0};  // one of PET_VOICE_IDS, or empty
};

struct PairOut {
  std::string requestId;
  std::string confirmCode;  // "ABCD-EFGH"
};

struct ClaimOut {
  std::string deviceId;
  std::string token;
  PetKind kind = PET_DEFAULT_KIND;
  ServerSettings settings;
};

struct HeartbeatIn {
  float battery = 0.0f;  // 0..1
  bool charging = false;
  int rssi = -100;  // dBm
  uint8_t queue = 0;
  const char* skin = "none";  // PET_KIND_IDS[...] or "none"
  uint32_t uptimeSeconds = 0;
};

struct HeartbeatOut {
  ServerSettings settings;
  bool quiet = false;
};

struct Notice {
  uint32_t seq = 0;
  PetNoticeKind kind = PET_NOTICE_KIND_MESSAGE;
  std::string line;  // what the server would say; the pet says its own clips for most kinds
  bool hasTitle = false;
  std::string role;  // a canonical persona id, or empty
  // idKey() of the chat and the run the notice is about (0 when it names none), so
  // the state machine can tell a notice that only repeats what the last turn said.
  uint32_t chatKey = 0;
  uint32_t runKey = 0;
};

struct InboxOut {
  std::vector<Notice> notices;
  uint32_t next = 0;
  bool quiet = false;
};

// Receives a spoken answer as it arrives (a turn's reply, a notice read aloud).
// Both calls run in the task that made the request.
class ReplySink {
 public:
  virtual ~ReplySink() = default;
  // The headers, before any audio. `hasState` is false for a notice read aloud
  // (no X-Pet-State). `line` is the decoded X-Pet-Line. `chatKey` and `runKey` are
  // idKey() of X-Pet-Chat and X-Pet-Run (0 when the answer names none).
  // `contentLength` is 0 when the length is not known or the body is empty (an
  // answer whose speech failed after the run started). Return false to stop.
  virtual bool onStart(bool hasState, PetTurnState state, const std::string& line, uint32_t chatKey, uint32_t runKey,
                       int64_t contentLength) = 0;
  // Raw PCM16 little-endian mono at 22050 Hz, in pieces of any size (an odd byte
  // count is possible). Return false to stop reading.
  virtual bool onAudio(const uint8_t* bytes, size_t len) = 0;
};

// Receives a downloaded file. Return false to stop.
class ByteSink {
 public:
  virtual ~ByteSink() = default;
  virtual bool write(const uint8_t* bytes, size_t len) = 0;
};

// The pet's HTTPS client for /api/pets/*, on ESP-IDF's esp_http_client.
//
// Rule 7 of docs/desk-pets-plan.md: HTTPS only, and a redirect is never followed.
//   * PET_API_BASE must be an https:// address: a build with another one does not
//     compile, and begin() checks the rest (no user name, no space) at run time.
//   * Every URL is the base plus a fixed path (numbers and validated voice ids
//     only), so the device token can only be sent to the configured host.
//   * Redirects are turned off in the client, and any 3xx answer is an error: the
//     Location it names is never fetched, so the token never follows it.
//   * The token is sent only as "Authorization: Bearer", only on the calls that
//     need it (not on pairing and not on the public voice pack download), and is
//     never logged.
// The server's certificate is checked against the ESP-IDF certificate bundle.
//
// Each call makes its own connection and its own client, so the network task and
// the inbox task can call at the same time.
class Api {
 public:
  bool begin(Secrets& secrets);

  ApiResult pair(const std::string& setupCode, PetKind kind, PairOut& out);
  ApiResult claim(const std::string& requestId, ClaimOut& out);

  // Uploads `wav` (an IMA-ADPCM WAV) as a turn. With `offline` it is a saved note
  // (X-Pet-Offline: 1): the answer is JSON with no audio and `sink` is not called.
  // Otherwise the reply's audio goes to `sink` while it arrives. A 208 means the
  // server already has this turn id. `recordedAtIso` may be empty.
  ApiResult turn(ByteSource& wav, const std::string& turnId, const std::string& recordedAtIso, bool offline, ReplySink* sink);

  // Long poll: the server holds the call up to waitSeconds for a notice.
  ApiResult inbox(uint32_t after, int waitSeconds, InboxOut& out);

  ApiResult heartbeat(const HeartbeatIn& in, HeartbeatOut& out);

  // A notice read aloud.
  ApiResult say(uint32_t seq, ReplySink& sink);

  // A public file under the base address (the voice pack). No token is sent. At
  // most maxBytes are accepted; more is an error (status 413 locally).
  ApiResult download(const char* urlPath, ByteSink& sink, size_t maxBytes);

 // Internals of one call, public only so api.cpp's receivers can name them.
  struct Call;
  class Receiver;
  struct Captured;

 private:
  ApiResult perform(const Call& call, Receiver* receiver);
  std::string url(const std::string& path) const;

  Secrets* secrets_ = nullptr;
  std::string base_;
};

}  // namespace pet
