#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "core/byte_source.h"
#include "core/server_pin.h"
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

// The pet's HTTPS client for /api/pets/*, on ESP-IDF's esp_http_client, talking to the one
// computer it was set up with (core/server_pin.h).
//
// Rule 7 of docs/desk-pets-plan.md: HTTPS only, and a redirect is never followed.
//   * There is no server address in the build. The computer's address, port, mDNS name and
//     certificate fingerprint come from the cable (pet-usb v2), are used for the pairing
//     try (useServer), and are kept on the pet when the claim worked (keepServer). Every
//     URL is "https://<address>:<port>" and a fixed path (numbers and validated voice ids
//     only), so the device token can only be sent to that one computer.
//   * The pet trusts no certificate authority for it. Every connection, whatever the call
//     (pairing, claim, heartbeat, turn, say, inbox, voice pack), is held inside the TLS
//     handshake to the pin: the SHA-256 of the DER certificate the computer shows must be
//     the stored fingerprint (net/api.cpp, attachPin), or the handshake fails and not one
//     byte of the request is written. The token goes out in the request's headers, which
//     esp_http_client writes only after the handshake, so it can never reach a computer
//     that is not the pinned one. A pet with no record connects to nothing.
//   * Redirects are turned off in the client, and any 3xx answer is an error: the
//     Location it names is never fetched, so the token never follows it.
//   * When the address that worked before does not connect (the computer got another one
//     from the router), the pet asks mDNS for the computer's name, tries what answers
//     (the pin still decides) and remembers the address that worked. An answer from
//     another device is just a connection the pin refuses.
//   * The token is sent only as "Authorization: Bearer", only on the calls that
//     need it (not on pairing and not on the public voice pack download), and is
//     never logged.
//   * The only clock the pet has is the computer's: the `Date` header of an answer sets it
//     (core/api_rules.h, parseHttpDate), so a saved note has a time and the pet reaches no
//     time server.
//
// Each call makes its own connection and its own client, so the network task and
// the inbox task can call at the same time.
class Api {
 public:
  // Reads the computer the pet was paired with, if any. False only when the client could
  // not be made (no memory). A pet that is not paired has no computer yet, and every call
  // it tries fails with -1 until useServer.
  bool begin(Secrets& secrets);

  // The computer for a pairing try, as the cable gave it: the pet pins this certificate
  // for pair and claim. Not stored. False (and nothing used) for a record the pet
  // would not use. A try that did not pair calls dropServer; one that did calls keepServer.
  bool useServer(const ServerRecord& record);
  // Stores the record in use (with the address that worked) with the token, so the pet
  // finds the computer again after a restart. False when it could not be saved.
  bool keepServer();
  // Forgets the computer in use, stored or not: a try that failed, a forgetting. The next
  // call connects to nothing.
  void dropServer();
  bool hasServer();

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
  struct Attempt;
  ApiResult perform(const Call& call, Receiver* receiver);
  Attempt performAt(const Call& call, Receiver* receiver, const std::string& address, uint16_t port, const std::string& token);
  void rememberAddress(const std::string& address);
  bool snapshot(ServerRecord& out);

  Secrets* secrets_ = nullptr;
  // The computer in use, guarded by lock_ (both network tasks call). `stored_` says the
  // record in use is the one on flash, so a new address is written there too.
  SemaphoreHandle_t lock_ = nullptr;
  ServerRecord server_;
  bool have_ = false;
  bool stored_ = false;
};

}  // namespace pet
