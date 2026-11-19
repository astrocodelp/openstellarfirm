#include "net/api.h"

#include <ArduinoJson.h>
#include <esp_crt_bundle.h>
#include <esp_heap_caps.h>
#include <esp_http_client.h>
#include <esp_system.h>
#include <mbedtls/sha256.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <mdns.h>
#include <strings.h>
#include <sys/time.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <memory>
#include <mutex>
#include <new>
#include <utility>

#include "config.h"
#include "core/api_rules.h"
#include "core/base64url.h"
#include "core/text_rules.h"
#include "core/voice_pack.h"
#include "hw/log.h"
#include "store/secrets.h"

namespace pet {

namespace {

// The connect phase of a call (the TCP connection and the TLS handshake with its pin check)
// is given this long, then the call's own timeout takes over for the writes and reads. A
// stale address then costs a few seconds before the name is asked, not a turn's whole
// minute and a half.
constexpr int kConnectTimeoutMs = 8000;
// How long mDNS is asked for the computer's name.
constexpr uint32_t kNameLookupMs = 2000;

constexpr size_t kChunk = 4096;
constexpr size_t kErrorBodyMax = 1024;
constexpr size_t kJsonBodyMax = 8 * 1024;
constexpr size_t kInboxBodyMax = 64 * 1024;

void copyText(char* dest, size_t cap, const char* text) {
  if (cap == 0) {
    return;
  }
  std::strncpy(dest, text == nullptr ? "" : text, cap - 1);
  dest[cap - 1] = '\0';
}

// The JSON text of a document, without relying on how ArduinoJson was built for
// std::string.
std::string toJson(const JsonDocument& doc) {
  const size_t n = measureJson(doc);
  std::string out(n, '\0');
  serializeJson(doc, &out[0], n + 1);
  return out;
}

bool parseJson(const std::string& body, JsonDocument& doc) {
  return !deserializeJson(doc, body.data(), body.size());
}

void parseSettings(JsonVariantConst v, ServerSettings& out) {
  out = ServerSettings{};
  if (!v.is<JsonObjectConst>()) {
    return;
  }
  out.valid = true;
  out.paused = v["paused"] | false;
  out.speakNotices = v["speakNotices"] | true;
  float volume = v["volume"] | 0.6f;
  if (!(volume >= 0.0f)) {
    volume = 0.0f;
  }
  if (volume > 1.0f) {
    volume = 1.0f;
  }
  out.volume = volume;
  // The voice id goes into a file name and a URL: only the six known ones count.
  const char* voice = v["voice"] | "";
  if (isVoiceId(voice)) {
    copyText(out.voice, sizeof(out.voice), voice);
  }
}

void parseError(const std::string& body, ApiResult& result) {
  if (body.empty()) {
    return;
  }
  JsonDocument doc;
  if (!parseJson(body, doc)) {
    return;
  }
  copyText(result.error, sizeof(result.error), doc["error"] | "");
  copyText(result.line, sizeof(result.line), doc["line"] | "");
}

// A local failure made to look like the server's answer, so the caller has one
// path for both.
ApiResult failure(int status, const char* error, const char* line) {
  ApiResult r;
  r.status = status;
  copyText(r.error, sizeof(r.error), error);
  copyText(r.line, sizeof(r.line), line);
  return r;
}

bool isConfirmCodeText(const std::string& code) {
  size_t chars = 0;
  for (char c : code) {
    if (c == '-') {
      continue;
    }
    if (charClipId(c) == nullptr) {
      return false;
    }
    ++chars;
  }
  return chars == PET_CONFIRM_CODE_LENGTH;
}

}  // namespace

// -- One call --------------------------------------------------------------------

struct Api::Captured {
  bool haveState = false;
  std::string state;
  std::string line;  // still percent-encoded
  std::string chat;
  std::string run;
  std::string date;  // the computer's own clock, "Fri, 20 Nov 2026 08:49:37 GMT"
};

struct Api::Attempt {
  ApiResult result;
  // The connection was made, the pin held and the request went out: the computer, and no
  // other, answered (or did not answer in time). False before that, and then nothing was
  // sent.
  bool connected = false;
};

struct Api::Call {
  esp_http_client_method_t method = HTTP_METHOD_GET;
  std::string path;
  bool auth = true;
  int timeoutMs = PET_HTTP_TIMEOUT_MS;
  const char* contentType = nullptr;
  const char* accept = nullptr;
  std::vector<std::pair<std::string, std::string>> headers;
  std::string jsonBody;      // the body, unless `body` is set
  ByteSource* body = nullptr;  // an upload read in pieces
};

class Api::Receiver {
 public:
  virtual ~Receiver() = default;
  // After the headers of a successful answer. False stops the transfer.
  virtual bool start(int /*status*/, const Api::Captured&, int64_t /*contentLength*/) { return true; }
  // A piece of the body. False stops the transfer.
  virtual bool data(const uint8_t* bytes, size_t len) = 0;
};

namespace {

class JsonReceiver : public Api::Receiver {
 public:
  explicit JsonReceiver(size_t cap) : cap_(cap) {}
  bool data(const uint8_t* bytes, size_t len) override {
    if (body.size() + len > cap_) {
      overflow = true;
      return false;
    }
    body.append(reinterpret_cast<const char*>(bytes), len);
    return true;
  }
  std::string body;
  bool overflow = false;

 private:
  size_t cap_;
};

class AudioReceiver : public Api::Receiver {
 public:
  explicit AudioReceiver(ReplySink& sink) : sink_(sink) {}
  bool start(int status, const Api::Captured& captured, int64_t contentLength) override {
    // Only a plain 200 carries speech. A 208 ("already received") or any other
    // success has nothing to play.
    if (status != 200) {
      return false;
    }
    PetTurnState state = PET_STATE_ANSWERED;
    const bool have = captured.haveState && turnStateFromWire(captured.state.c_str(), state);
    return sink_.onStart(have, state, percentDecode(captured.line), idKey(captured.chat.c_str()), idKey(captured.run.c_str()),
                         contentLength);
  }
  bool data(const uint8_t* bytes, size_t len) override { return sink_.onAudio(bytes, len); }

 private:
  ReplySink& sink_;
};

class FileReceiver : public Api::Receiver {
 public:
  FileReceiver(ByteSink& sink, size_t maxBytes) : sink_(sink), max_(maxBytes) {}
  bool data(const uint8_t* bytes, size_t len) override {
    total_ += len;
    if (total_ > max_) {
      tooBig = true;
      return false;
    }
    return sink_.write(bytes, len);
  }
  bool tooBig = false;

 private:
  ByteSink& sink_;
  size_t max_;
  size_t total_ = 0;
};

// Collects the headers the pet reads. Runs inside esp_http_client_fetch_headers,
// in the calling task. The strings it is given are only valid during the call.
esp_err_t onHttpEvent(esp_http_client_event_t* event) {
  if (event->event_id != HTTP_EVENT_ON_HEADER || event->user_data == nullptr || event->header_key == nullptr ||
      event->header_value == nullptr) {
    return ESP_OK;
  }
  Api::Captured* captured = static_cast<Api::Captured*>(event->user_data);
  if (strcasecmp(event->header_key, PET_HEADER_STATE) == 0) {
    captured->state.assign(event->header_value, std::min<size_t>(std::strlen(event->header_value), 32));
    captured->haveState = true;
  } else if (strcasecmp(event->header_key, PET_HEADER_LINE) == 0) {
    captured->line.assign(event->header_value, std::min<size_t>(std::strlen(event->header_value), 1500));
  } else if (strcasecmp(event->header_key, PET_HEADER_CHAT) == 0) {
    // Ids are at most 64 characters; idKey() takes a longer one for none.
    captured->chat.assign(event->header_value, std::min<size_t>(std::strlen(event->header_value), 80));
  } else if (strcasecmp(event->header_key, PET_HEADER_RUN) == 0) {
    captured->run.assign(event->header_value, std::min<size_t>(std::strlen(event->header_value), 80));
  } else if (strcasecmp(event->header_key, "Date") == 0) {
    captured->date.assign(event->header_value, std::min<size_t>(std::strlen(event->header_value), 40));
  }
  return ESP_OK;
}

// -- The pin -----------------------------------------------------------------------------
//
// One computer at a time, so one pin for the whole client. The handshakes of the network
// task and the inbox task can run together, so the pin is read and written under a
// spinlock that is held for the copy of 32 bytes and nothing else.
portMUX_TYPE gPinLock = portMUX_INITIALIZER_UNLOCKED;
uint8_t gPin[kPinBytes] = {0};
bool gPinKnown = false;

void setPin(const ServerRecord* record) {
  portENTER_CRITICAL(&gPinLock);
  if (record != nullptr) {
    std::memcpy(gPin, record->fingerprint, kPinBytes);
    gPinKnown = true;
  } else {
    std::memset(gPin, 0, kPinBytes);
    gPinKnown = false;
  }
  portEXIT_CRITICAL(&gPinLock);
}

// mbedtls calls this once for each certificate of the chain the computer showed, the top
// one first and the computer's own (depth 0) last, while the handshake is still going and
// before the pet writes anything. What it returns decides the handshake, because the
// connection is set to MBEDTLS_SSL_VERIFY_REQUIRED: a non-zero return, or flags left set
// at the end, abort it with a fatal alert.
//
// The chain is not what the pet trusts, so the flags mbedtls raised about it (an unknown
// authority, an expired or not yet valid certificate, a name that does not match: the
// app's certificate is self-signed and the pet has no clock to start with) are cleared at
// every depth. The one thing that decides is the computer's own certificate: its SHA-256
// must be the pin. A certificate that is not rejects the handshake here.
int verifyPin(void* /*context*/, mbedtls_x509_crt* crt, int depth, uint32_t* flags) {
  uint8_t digest[kPinBytes];
  const uint8_t* leaf = nullptr;
  if (depth == 0 && crt != nullptr && crt->raw.p != nullptr && crt->raw.len > 0 &&
      mbedtls_sha256(crt->raw.p, crt->raw.len, digest, 0) == 0) {
    leaf = digest;
  }
  uint8_t expected[kPinBytes];
  bool known = false;
  portENTER_CRITICAL(&gPinLock);
  std::memcpy(expected, gPin, kPinBytes);
  known = gPinKnown;
  portEXIT_CRITICAL(&gPinLock);

  const PinAction action = pinAction(depth, known, expected, leaf);
  std::memset(expected, 0, sizeof(expected));
  if (action == PinAction::Reject) {
    if (flags != nullptr) {
      *flags |= MBEDTLS_X509_BADCERT_NOT_TRUSTED;
    }
    return MBEDTLS_ERR_X509_CERT_VERIFY_FAILED;
  }
  if (flags != nullptr) {
    *flags = 0;
  }
  return 0;
}

// What esp_http_client calls to set up the connection's trust (config.crt_bundle_attach).
// The ESP-IDF bundle's own attach function does what MBEDTLS_SSL_VERIFY_REQUIRED needs to
// run the check at all, and is the only thing taken from it: its callback, the one that
// would look the computer's certificate up among the public authorities, is replaced here
// by verifyPin, so the bundle never decides anything for the app. Nothing is returned as
// success if the replacement could not be made.
esp_err_t attachPin(void* conf) {
  if (conf == nullptr) {
    return ESP_ERR_INVALID_ARG;
  }
  const esp_err_t attached = esp_crt_bundle_attach(conf);
  if (attached != ESP_OK) {
    return attached;
  }
  mbedtls_ssl_config* ssl = static_cast<mbedtls_ssl_config*>(conf);
  mbedtls_ssl_conf_authmode(ssl, MBEDTLS_SSL_VERIFY_REQUIRED);
  mbedtls_ssl_conf_verify(ssl, &verifyPin, nullptr);
  return ESP_OK;
}

// -- The computer's name ----------------------------------------------------------------

// Asks mDNS for `osf-<8 hex>.local`. Only the A question; the answer is four bytes, written
// back as a plain IPv4 address. The responder is started for the question and stopped after
// it, so the pet advertises nothing and holds no memory for it between falls back. False
// for no answer.
bool askName(const std::string& name, std::string& address) {
  static std::mutex lookup;  // one question at a time: the responder is started and stopped around it
  const std::string host = mdnsHostOf(name);
  if (host.empty()) {
    return false;
  }
  std::lock_guard<std::mutex> only(lookup);
  if (mdns_init() != ESP_OK) {
    return false;
  }
  esp_ip4_addr_t found = {};
  const esp_err_t asked = mdns_query_a(host.c_str(), kNameLookupMs, &found);
  mdns_free();
  if (asked != ESP_OK || found.addr == 0) {
    return false;
  }
  // The four bytes are in network order, the first number of the address first.
  const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&found.addr);
  address = ipv4Text(bytes);
  return true;
}

// The computer's clock, from the Date header of an answer that came over the pinned
// connection. The pet has no other: it asks no time server.
void adoptServerDate(const std::string& date) {
  int64_t at = 0;
  if (date.empty() || !parseHttpDate(date.c_str(), at)) {
    return;
  }
  if (!shouldSetClock(static_cast<int64_t>(time(nullptr)), at)) {
    return;
  }
  struct timeval now = {};
  now.tv_sec = static_cast<time_t>(at);
  settimeofday(&now, nullptr);
}

}  // namespace

bool Api::begin(Secrets& secrets) {
  secrets_ = &secrets;
  if (lock_ == nullptr) {
    lock_ = xSemaphoreCreateMutex();
    if (lock_ == nullptr) {
      return false;
    }
  }
  ServerRecord stored;
  const bool known = secrets.server(stored);
  xSemaphoreTake(lock_, portMAX_DELAY);
  have_ = known;
  stored_ = known;
  server_ = known ? stored : ServerRecord();
  xSemaphoreGive(lock_);
  setPin(known ? &stored : nullptr);
  if (!known) {
    PET_LOG("api: no computer is set up, no call will be made");
  }
  return true;
}

bool Api::useServer(const ServerRecord& record) {
  if (lock_ == nullptr || !isUsableServer(record)) {
    return false;
  }
  xSemaphoreTake(lock_, portMAX_DELAY);
  server_ = record;
  have_ = true;
  stored_ = false;
  xSemaphoreGive(lock_);
  setPin(&record);
  return true;
}

bool Api::keepServer() {
  if (lock_ == nullptr || secrets_ == nullptr) {
    return false;
  }
  xSemaphoreTake(lock_, portMAX_DELAY);
  const ServerRecord record = server_;
  const bool have = have_;
  xSemaphoreGive(lock_);
  if (!have || !secrets_->setServer(record)) {
    return false;
  }
  xSemaphoreTake(lock_, portMAX_DELAY);
  stored_ = server_ == record;
  xSemaphoreGive(lock_);
  return true;
}

void Api::dropServer() {
  if (lock_ == nullptr) {
    return;
  }
  setPin(nullptr);  // first, so no handshake from here on can be accepted
  xSemaphoreTake(lock_, portMAX_DELAY);
  server_ = ServerRecord();
  have_ = false;
  stored_ = false;
  xSemaphoreGive(lock_);
}

bool Api::hasServer() {
  if (lock_ == nullptr) {
    return false;
  }
  xSemaphoreTake(lock_, portMAX_DELAY);
  const bool have = have_;
  xSemaphoreGive(lock_);
  return have;
}

bool Api::snapshot(ServerRecord& out) {
  if (lock_ == nullptr) {
    return false;
  }
  xSemaphoreTake(lock_, portMAX_DELAY);
  const bool have = have_;
  if (have) {
    out = server_;
  }
  xSemaphoreGive(lock_);
  return have;
}

// A new address that worked is kept in memory and, when the record in use is the stored
// one, on flash too, so the next boot starts from it. Only a change is written.
void Api::rememberAddress(const std::string& address) {
  if (lock_ == nullptr) {
    return;
  }
  xSemaphoreTake(lock_, portMAX_DELAY);
  const bool changed = have_ && server_.address != address;
  if (changed) {
    server_.address = address;
  }
  const bool store = changed && stored_;
  xSemaphoreGive(lock_);
  if (store && secrets_ != nullptr) {
    secrets_->setServerAddress(address);
  }
}

// One call: to the computer's address, and, when that does not connect, to the address
// its name now has. The pin is checked on each connection; nothing is sent to a
// computer that fails it.
ApiResult Api::perform(const Call& call, Receiver* receiver) {
  ServerRecord server;
  if (!snapshot(server)) {
    return failure(-1, "", "");
  }

  std::string token;
  if (call.auth) {
    token = secrets_ != nullptr ? secrets_->token() : std::string();
    if (token.empty()) {
      // No token means this pet is not paired: the same as the server forgetting it.
      return failure(401, "forgotten", PET_LINE_DISCONNECTED);
    }
  }

  std::string address = server.address;
  Attempt attempt;
  attempt.result.status = -1;
  bool triedAddress = false;
  if (!address.empty()) {
    attempt = performAt(call, receiver, address, server.port, token);
    triedAddress = true;
  }
  if (!attempt.connected && shouldAskName(server, triedAddress)) {
    std::string found;
    if (askName(server.name, found) && found != address) {
      address = found;
      attempt = performAt(call, receiver, address, server.port, token);
    }
  }
  std::fill(token.begin(), token.end(), '\0');
  if (attempt.connected) {
    rememberAddress(address);
  }
  return attempt.result;
}

Api::Attempt Api::performAt(const Call& call, Receiver* receiver, const std::string& address, uint16_t port,
                            const std::string& token) {
  Attempt attempt;
  attempt.result.status = -1;
  // Always https, and always a plain address and a port: nothing from an answer or from
  // the call's own path can change where this goes.
  const std::string base = serverBaseUrl(address, port);
  if (!isHttpsBase(base.c_str())) {
    return attempt;
  }
  const std::string target = joinUrl(base, call.path);
  Captured captured;
  esp_http_client_config_t config = {};
  config.url = target.c_str();
  config.user_agent = "OpenStellarFirmPet/" PET_FIRMWARE_VERSION;
  config.method = call.method;
  config.timeout_ms = std::min(call.timeoutMs, kConnectTimeoutMs);  // raised once the connection is made
  config.transport_type = HTTP_TRANSPORT_OVER_SSL;
  // No public certificate authority is trusted for the app: the connection is held to the
  // pin inside the handshake (attachPin). The name in the certificate is not what is
  // trusted, so it is not checked.
  config.crt_bundle_attach = &attachPin;
  config.skip_cert_common_name_check = true;
  // Never follow a redirect: the token must not go anywhere else. A 3xx answer is
  // handled below as an error.
  config.disable_auto_redirect = true;
  config.event_handler = onHttpEvent;
  config.user_data = &captured;
  // A spoken line can come back as 900 characters of percent-encoded header.
  config.buffer_size = 4096;
  config.buffer_size_tx = 1024;

  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == nullptr) {
    return attempt;
  }
  if (call.contentType != nullptr) {
    esp_http_client_set_header(client, "Content-Type", call.contentType);
  }
  if (call.accept != nullptr) {
    esp_http_client_set_header(client, "Accept", call.accept);
  }
  for (const auto& header : call.headers) {
    esp_http_client_set_header(client, header.first.c_str(), header.second.c_str());
  }
  if (call.auth) {
    std::string bearer = "Bearer " + token;
    esp_http_client_set_header(client, "Authorization", bearer.c_str());
    std::fill(bearer.begin(), bearer.end(), '\0');
  }

  ApiResult& result = attempt.result;
  const size_t bodyLength = call.body != nullptr ? call.body->size() : call.jsonBody.size();

  const esp_err_t opened = esp_http_client_open(client, static_cast<int>(bodyLength));
  bool good = opened == ESP_OK;
  if (!good) {
    PET_LOG("api: %s could not connect: %s, errno %d, internal free %lu largest %lu, task stack left %lu", call.path.c_str(),
            esp_err_to_name(opened), esp_http_client_get_errno(client),
            static_cast<unsigned long>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
            static_cast<unsigned long>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)),
            static_cast<unsigned long>(uxTaskGetStackHighWaterMark(nullptr)));
  } else {
    // The handshake passed, so the certificate was the pinned one, and the request is out.
    // From here the call's own timeout counts, and the call is the computer's answer or
    // none: it is never tried on another address.
    esp_http_client_set_timeout_ms(client, call.timeoutMs);
    attempt.connected = true;
  }
  if (good && bodyLength > 0) {
    std::unique_ptr<uint8_t[]> piece;
    if (call.body != nullptr) {
      piece.reset(new (std::nothrow) uint8_t[kChunk]);
      good = piece != nullptr;
    }
    size_t sent = 0;
    while (good && sent < bodyLength) {
      const uint8_t* source = nullptr;
      size_t n = 0;
      if (call.body != nullptr) {
        n = call.body->read(sent, piece.get(), std::min(kChunk, bodyLength - sent));
        source = piece.get();
      } else {
        n = std::min(kChunk, bodyLength - sent);
        source = reinterpret_cast<const uint8_t*>(call.jsonBody.data()) + sent;
      }
      if (n == 0) {
        good = false;  // the source ran dry before its announced length
        break;
      }
      const int written = esp_http_client_write(client, reinterpret_cast<const char*>(source), static_cast<int>(n));
      if (written <= 0) {
        good = false;
        break;
      }
      sent += static_cast<size_t>(written);
    }
  }

  int64_t contentLength = -1;
  if (good) {
    const uint32_t askedAt = millis();
    contentLength = esp_http_client_fetch_headers(client);
    if (contentLength < 0) {
      PET_LOG("api: %s sent, then no headers after %lu ms (timeout %d)", call.path.c_str(),
              static_cast<unsigned long>(millis() - askedAt), call.timeoutMs);
    }
    good = contentLength >= 0;
  }
  if (!good) {
    result.status = contentLength == -ESP_ERR_HTTP_EAGAIN ? -2 : -1;
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return attempt;
  }

  const int status = esp_http_client_get_status_code(client);
  result.status = status;
  adoptServerDate(captured.date);
  if (isRedirect(status)) {
    // Not followed, not read, and nothing from the answer is used.
    copyText(result.error, sizeof(result.error), "redirect");
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return attempt;
  }

  const bool success = status >= 200 && status < 300;
  JsonReceiver errorBody(kErrorBodyMax);
  Receiver* reader = success ? receiver : &errorBody;
  if (reader != nullptr && success && !reader->start(status, captured, contentLength)) {
    reader = nullptr;  // the receiver has had enough
  }
  if (reader != nullptr) {
    std::unique_ptr<uint8_t[]> buffer(new (std::nothrow) uint8_t[2048]);
    while (buffer != nullptr) {
      const int n = esp_http_client_read(client, reinterpret_cast<char*>(buffer.get()), 2048);
      if (n > 0) {
        if (!reader->data(buffer.get(), static_cast<size_t>(n))) {
          break;
        }
        continue;
      }
      if (n < 0) {
        result.truncated = true;
        PET_LOG("api: %s body read stopped: %d, errno %d", call.path.c_str(), n, esp_http_client_get_errno(client));
      }
      break;
    }
  }
  esp_http_client_close(client);
  esp_http_client_cleanup(client);

  if (!success) {
    parseError(errorBody.body, result);
  }
  return attempt;
}

// -- The calls -------------------------------------------------------------------

ApiResult Api::pair(const std::string& setupCode, PetKind kind, PairOut& out) {
  out = PairOut{};
  std::string code;
  if (!normalizeSetupCode(setupCode, code)) {
    return failure(400, "bad_code", PET_LINE_SETUP_REFUSED);
  }
  const std::string shown = code.substr(0, 5) + "-" + code.substr(5);
  const std::string key = secrets_ != nullptr ? secrets_->deviceKey() : std::string();
  if (key.empty()) {
    return failure(-1, "", "");
  }

  JsonDocument doc;
  doc["setupCode"] = shown.c_str();
  doc["kind"] = PET_KIND_IDS[static_cast<int>(kind) < PET_KIND_COUNT ? static_cast<int>(kind) : 0];
  doc["hardware"] = PET_PAIR_HARDWARE_ID;
  doc["firmware"] = PET_FIRMWARE_VERSION;
  doc["deviceKey"] = key.c_str();

  Call call;
  call.method = HTTP_METHOD_POST;
  call.path = "/api/pets/pair";
  call.auth = false;
  call.contentType = "application/json";
  call.accept = "application/json";
  call.jsonBody = toJson(doc);

  JsonReceiver reader(kJsonBodyMax);
  ApiResult result = perform(call, &reader);
  if (result.status == 200) {
    JsonDocument answer;
    const std::string requestId = parseJson(reader.body, answer) ? std::string(answer["requestId"] | "") : std::string();
    const std::string confirm = answer["confirmCode"] | "";
    if (requestId.empty() || requestId.size() > 64 || !isConfirmCodeText(confirm)) {
      return failure(502, "", PET_LINE_BUSY);
    }
    out.requestId = requestId;
    out.confirmCode = confirm;
  }
  return result;
}

ApiResult Api::claim(const std::string& requestId, ClaimOut& out) {
  out = ClaimOut{};
  const std::string secret = secrets_ != nullptr ? secrets_->deviceSecret() : std::string();
  if (secret.empty() || requestId.empty()) {
    return failure(-1, "", "");
  }

  JsonDocument doc;
  doc["requestId"] = requestId.c_str();
  doc["deviceSecret"] = secret.c_str();

  Call call;
  call.method = HTTP_METHOD_POST;
  call.path = "/api/pets/pair/claim";
  call.auth = false;
  call.contentType = "application/json";
  call.accept = "application/json";
  call.jsonBody = toJson(doc);

  JsonReceiver reader(kJsonBodyMax);
  ApiResult result = perform(call, &reader);
  if (result.status == 200) {
    JsonDocument answer;
    std::vector<uint8_t> raw;
    const bool parsed = parseJson(reader.body, answer);
    const std::string token = parsed ? std::string(answer["token"] | "") : std::string();
    // A 256-bit token is 43 base64url characters; anything else is not ours to keep.
    if (!parsed || !base64urlDecode(token, raw) || raw.size() != 32) {
      return failure(502, "", PET_LINE_BUSY);
    }
    out.token = token;
    out.deviceId = std::string(answer["deviceId"] | "");
    PetKind kind = PET_DEFAULT_KIND;
    if (petKindFromWire(answer["pet"]["kind"] | "", kind)) {
      out.kind = kind;
    }
    parseSettings(answer["settings"], out.settings);
    if (out.deviceId.empty()) {
      return failure(502, "", PET_LINE_BUSY);
    }
  }
  return result;
}

ApiResult Api::turn(ByteSource& wav, const std::string& turnId, const std::string& recordedAtIso, bool offline,
                    ReplySink* sink) {
  if (wav.size() == 0) {
    return failure(415, "bad_audio", PET_LINE_DIDNT_CATCH);
  }
  if (wav.size() > PET_UPLOAD_MAX_BYTES) {
    return failure(413, "too_long", PET_LINE_DIDNT_CATCH);
  }
  Call call;
  call.method = HTTP_METHOD_POST;
  call.path = "/api/pets/turn";
  call.timeoutMs = PET_TURN_HTTP_TIMEOUT_MS;
  call.contentType = PET_AUDIO_UP_CONTENT_TYPE;
  call.accept = offline ? "application/json" : PET_AUDIO_DOWN_CONTENT_TYPE;
  call.body = &wav;
  call.headers.emplace_back(PET_HEADER_TURN, turnId);
  if (!recordedAtIso.empty()) {
    call.headers.emplace_back(PET_HEADER_RECORDED_AT, recordedAtIso);
  }
  if (offline) {
    call.headers.emplace_back(PET_HEADER_OFFLINE, "1");
  }
  if (offline || sink == nullptr) {
    return perform(call, nullptr);  // a saved note: only the status matters
  }
  AudioReceiver reader(*sink);
  ApiResult result = perform(call, &reader);
  return result;
}

ApiResult Api::inbox(uint32_t after, int waitSeconds, InboxOut& out) {
  out = InboxOut{};
  out.next = after;
  const int wait = std::max(0, std::min(waitSeconds, static_cast<int>(PET_INBOX_WAIT_MAX_SECONDS)));
  char path[96];
  std::snprintf(path, sizeof(path), "/api/pets/inbox?after=%lu&wait=%d", static_cast<unsigned long>(after), wait);

  Call call;
  call.path = path;
  call.timeoutMs = PET_INBOX_HTTP_TIMEOUT_MS;
  call.accept = "application/json";

  JsonReceiver reader(kInboxBodyMax);
  ApiResult result = perform(call, &reader);
  if (result.status != 200) {
    return result;
  }
  JsonDocument answer;
  if (reader.overflow || result.truncated || !parseJson(reader.body, answer)) {
    return failure(502, "", PET_LINE_BUSY);
  }
  out.quiet = answer["quiet"] | false;
  out.next = answer["next"] | after;
  for (JsonObjectConst item : answer["notices"].as<JsonArrayConst>()) {
    Notice notice;
    notice.seq = item["seq"] | 0u;
    if (notice.seq == 0 || !noticeKindFromWire(item["kind"] | "", notice.kind)) {
      continue;  // a kind this firmware does not know is skipped, never guessed
    }
    notice.line = std::string(item["line"] | "");
    const char* title = item["title"] | "";
    notice.hasTitle = title[0] != '\0';
    notice.role = std::string(item["role"] | "");
    notice.chatKey = idKey(item["chat"] | "");
    notice.runKey = idKey(item["run"] | "");
    out.notices.push_back(std::move(notice));
  }
  return result;
}

ApiResult Api::heartbeat(const HeartbeatIn& in, HeartbeatOut& out) {
  out = HeartbeatOut{};
  float battery = in.battery;
  if (!(battery >= 0.0f)) {
    battery = 0.0f;
  }
  if (battery > 1.0f) {
    battery = 1.0f;
  }
  const int rssi = std::max(-127, std::min(0, in.rssi));

  JsonDocument doc;
  doc["battery"] = std::round(battery * 100.0f) / 100.0f;
  doc["charging"] = in.charging;
  doc["rssi"] = rssi;
  doc["firmware"] = PET_FIRMWARE_VERSION;
  doc["queue"] = std::min<int>(in.queue, PET_SAVED_NOTES_MAX);
  doc["skin"] = in.skin;
  doc["uptime"] = in.uptimeSeconds;

  Call call;
  call.method = HTTP_METHOD_POST;
  call.path = "/api/pets/heartbeat";
  call.contentType = "application/json";
  call.accept = "application/json";
  call.jsonBody = toJson(doc);

  JsonReceiver reader(kJsonBodyMax);
  ApiResult result = perform(call, &reader);
  if (result.status == 200) {
    JsonDocument answer;
    if (!parseJson(reader.body, answer)) {
      return failure(502, "", PET_LINE_BUSY);
    }
    parseSettings(answer["settings"], out.settings);
    out.quiet = answer["quiet"] | false;
  }
  return result;
}

ApiResult Api::say(uint32_t seq, ReplySink& sink) {
  char path[48];
  std::snprintf(path, sizeof(path), "/api/pets/say/%lu", static_cast<unsigned long>(seq));
  Call call;
  call.path = path;
  call.timeoutMs = PET_TURN_HTTP_TIMEOUT_MS;
  call.accept = PET_AUDIO_DOWN_CONTENT_TYPE;
  AudioReceiver reader(sink);
  return perform(call, &reader);
}

ApiResult Api::download(const char* urlPath, ByteSink& sink, size_t maxBytes) {
  if (urlPath == nullptr || urlPath[0] != '/') {
    return failure(400, "bad_request", PET_LINE_BUSY);
  }
  Call call;
  call.path = urlPath;
  call.auth = false;  // a public file: the token has no business here
  call.accept = "application/octet-stream";
  FileReceiver reader(sink, maxBytes);
  ApiResult result = perform(call, &reader);
  if (reader.tooBig) {
    return failure(413, "too_long", PET_LINE_BUSY);
  }
  return result;
}

}  // namespace pet
