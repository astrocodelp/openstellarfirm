#include "net/net_worker.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <esp_random.h>
#include <freertos/task.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <ctime>

#include "config.h"
#include "core/api_rules.h"
#include "core/audio_dsp.h"
#include "core/byte_source.h"
#include "core/setup_access.h"
#include "core/text_rules.h"
#include "core/uuid_format.h"
#include "hw/log.h"
#include "net/api.h"
#include "store/note_store_fs.h"
#include "store/secrets.h"
#include "store/voicepack.h"

namespace pet {

namespace {

// Task shapes. Core 0 is the radio's core; the audio task and the lights are on core 1.
constexpr UBaseType_t kNetworkPriority = 4;
constexpr UBaseType_t kInboxPriority = 3;
constexpr uint32_t kNetworkStackBytes = 16 * 1024;
constexpr uint32_t kInboxStackBytes = 12 * 1024;
constexpr BaseType_t kRadioCore = 0;
constexpr UBaseType_t kCommandQueueLength = 8;

// Joining the saved Wi-Fi: how long one try may take before the next is allowed.
constexpr uint32_t kJoinTryMs = 20000;
constexpr uint32_t kSetupJoinTimeoutMs = 20000;
constexpr uint32_t kClaimPollMs = 2000;
// The page needs a moment to read "done" before the setup network is switched off.
constexpr uint32_t kSetupLingerMs = 3000;

constexpr uint32_t kHeartbeatRetryMs = 10000;
// A double tap asks the inbox at most this often.
constexpr uint32_t kAskMinGapMs = 2000;
constexpr uint32_t kPackRetryMs = 10 * 60 * 1000;
constexpr uint32_t kPackMissingRetryMs = 60 * 60 * 1000;
constexpr size_t kPackMaxBytes = 3 * 1024 * 1024;

// The voice pack may not take the room the saved notes need.
constexpr size_t kPackFlashMargin = 512 * 1024;

// Holds the computer a pairing try was told about in the client for as long as the try
// lives, and lets go of it on every way out but a pairing that was kept: a try that failed
// leaves the pet with no computer, never with the half of one.
class TrialServer {
 public:
  explicit TrialServer(Api& api) : api_(api) {}
  ~TrialServer() {
    if (!kept_) {
      api_.dropServer();
    }
  }
  TrialServer(const TrialServer&) = delete;
  TrialServer& operator=(const TrialServer&) = delete;
  void keep() { kept_ = true; }

 private:
  Api& api_;
  bool kept_ = false;
};

// Marks a setup try as running for as long as it lives, whatever way the try ends: the
// cable turns away a scan or a join while it is set.
class BusyScope {
 public:
  explicit BusyScope(bool& flag) : flag_(flag) { flag_ = true; }
  ~BusyScope() { flag_ = false; }
  BusyScope(const BusyScope&) = delete;
  BusyScope& operator=(const BusyScope&) = delete;

 private:
  bool& flag_;
};

// Writes a download to a file, and gives up when the pet has something better to
// do (a turn is waiting, or it is no longer idle): flash writes stall the whole
// chip for a moment, and nothing may do that while the pet records or speaks.
class PackFileSink : public ByteSink {
 public:
  PackFileSink(File& file, bool (*keepGoing)(void*), void* context) : file_(file), keepGoing_(keepGoing), context_(context) {}

  bool write(const uint8_t* bytes, size_t len) override {
    if (!keepGoing_(context_)) {
      interrupted = true;
      return false;
    }
    if (file_.write(bytes, len) != len) {
      failed = true;
      return false;
    }
    vTaskDelay(1);
    return true;
  }

  bool interrupted = false;
  bool failed = false;

 private:
  File& file_;
  bool (*keepGoing_)(void*);
  void* context_;
};

}  // namespace

std::string newTurnId() {
  uint8_t random[16];
  esp_fill_random(random, sizeof(random));
  return uuidV4(random);
}

std::string recordedAtNow() {
  const time_t now = time(nullptr);
  struct tm parts = {};
  gmtime_r(&now, &parts);
  char text[21];
  if (!formatIsoUtc(parts.tm_year + 1900, parts.tm_mon + 1, parts.tm_mday, parts.tm_hour, parts.tm_min, parts.tm_sec, text)) {
    return std::string();  // the clock is not set yet: the header is left out
  }
  return text;
}

// -- A spoken answer as it arrives ---------------------------------------------------

// Feeds the PCM of a reply (or a notice read aloud) to the speaker while it comes
// in, so the pet starts talking after the jitter head start and not after the
// whole download.
class NetWorker::ReplyPlayer : public ReplySink {
 public:
  ReplyPlayer(NetWorker& worker, PlayTag tag, bool announce, uint32_t epoch)
      : worker_(worker), tag_(tag), announce_(announce), epoch_(epoch) {}

  bool onStart(bool hasState, PetTurnState state, const std::string& /*line*/, uint32_t chatKey, uint32_t runKey,
               int64_t /*contentLength*/) override {
    state_ = hasState ? state : PET_STATE_ANSWERED;
    started_ = true;
    if (announce_) {
      // The state machine learns what kind of answer this is (the team is on it,
      // a step waits for the owner's Approve, the rules say no) as it begins, and which
      // chat and run it is about: a notice for the same work is lit, not said again.
      worker_.post(Event::replyStarted(state_, chatKey, runKey));
    }
    return true;
  }

  bool onAudio(const uint8_t* bytes, size_t len) override {
    if (worker_.forgetRequested_.load()) {
      stopped_ = true;  // the pet is being forgotten: stop at once, the wipe is waiting
      return false;
    }
    size_t i = 0;
    while (i < len) {
      size_t n = 0;
      while (n < kPiece && i < len) {
        if (haveCarry_) {
          pcm_[n++] = sample(carry_, bytes[i]);
          haveCarry_ = false;
          ++i;
        } else if (i + 1 < len) {
          pcm_[n++] = sample(bytes[i], bytes[i + 1]);
          i += 2;
        } else {
          carry_ = bytes[i];  // half a sample at the end of this piece
          haveCarry_ = true;
          ++i;
        }
      }
      if (n == 0) {
        continue;
      }
      if (stream_ == 0) {
        // The epoch says whether the owner stopped the pet since this answer was asked
        // for: then the speaker refuses, and the late answer is dropped unheard.
        stream_ = worker_.speaker_.open(tag_, epoch_);
        if (stream_ == 0) {
          unplayable_ = worker_.speaker_.epoch() == epoch_;  // otherwise: stopped, not broken
          stopped_ = true;
          return false;
        }
      }
      // Waits when the jitter buffer is full, which slows the download to the pace
      // of the speech. False means the pet was told to stop (or the speaker stalled).
      if (!worker_.speaker_.feed(stream_, pcm_, n, 5000)) {
        stopped_ = true;
        return false;
      }
      gotAudio_ = true;
    }
    return true;
  }

  // The end of the body: the speaker plays what it has and then reports the tag.
  void finish() {
    if (stream_ != 0) {
      worker_.speaker_.close(stream_);
    }
  }

  bool started() const { return started_; }
  bool gotAudio() const { return gotAudio_; }
  bool stopped() const { return stopped_; }
  bool unplayable() const { return unplayable_; }
  PetTurnState state() const { return state_; }

 private:
  static constexpr size_t kPiece = 512;

  static int16_t sample(uint8_t low, uint8_t high) {
    // Little-endian, whatever this chip's byte order is.
    return static_cast<int16_t>(static_cast<uint16_t>(low | (static_cast<uint16_t>(high) << 8)));
  }

  NetWorker& worker_;
  PlayTag tag_;
  bool announce_;
  uint32_t epoch_;
  bool started_ = false;
  bool gotAudio_ = false;
  bool stopped_ = false;
  bool unplayable_ = false;
  bool haveCarry_ = false;
  uint8_t carry_ = 0;
  uint32_t stream_ = 0;
  PetTurnState state_ = PET_STATE_ANSWERED;
  int16_t pcm_[kPiece] = {};
};

// -- Setting up ---------------------------------------------------------------------

NetWorker::NetWorker(const Parts& parts)
    : api_(parts.api),
      secrets_(parts.secrets),
      queue_(parts.queue),
      store_(parts.store),
      speaker_(parts.speaker),
      player_(parts.player),
      packs_(parts.packs),
      mailbox_(parts.mailbox),
      shared_(parts.shared),
      kind_(parts.kind),
      usb_(parts.kind),
      wifiBackoff_(PET_BACKOFF_BASE_MS, PET_BACKOFF_MAX_MS),
      probeBackoff_(PET_BACKOFF_BASE_MS, PET_BACKOFF_MAX_MS) {}

bool NetWorker::start() {
  commands_ = xQueueCreate(kCommandQueueLength, sizeof(NetCommand));
  forgotten_ = xSemaphoreCreateBinary();
  confirmMutex_ = xSemaphoreCreateMutex();
  if (commands_ == nullptr || forgotten_ == nullptr || confirmMutex_ == nullptr) {
    return false;
  }
  wantedVoice_ = secrets_.settings().voice;
  packVoice_ = secrets_.packVoice();
  shared_.noteCount.store(static_cast<uint8_t>(std::min<size_t>(queue_.pending(), 255)));
  // The cable is told where a setup try stands; it never sees the page's message or the
  // confirm code (UsbSetup::report).
  setup_.observe(&NetWorker::onSetupStatus, this);
  const bool network =
      xTaskCreatePinnedToCore(&NetWorker::networkEntry, "net", kNetworkStackBytes, this, kNetworkPriority, nullptr, kRadioCore) == pdPASS;
  const bool inbox =
      xTaskCreatePinnedToCore(&NetWorker::inboxEntry, "inbox", kInboxStackBytes, this, kInboxPriority, &inboxTask_, kRadioCore) == pdPASS;
  return network && inbox;
}

bool NetWorker::submit(const NetCommand& command) {
  if (commands_ == nullptr) {
    return false;
  }
  // Set before the command is queued, so a step that is under way sees it at once.
  if (command.op == NetOp::ForgetAll) {
    forgetRequested_.store(true);
  }
  const bool queued = xQueueSend(commands_, &command, 0) == pdTRUE;
  if (!queued && command.op == NetOp::ForgetAll) {
    forgetRequested_.store(false);  // nothing will run the forgetting and clear the flag
  }
  return queued;
}

bool NetWorker::forgetAll(uint32_t timeoutMs) {
  NetCommand command;
  command.op = NetOp::ForgetAll;
  xSemaphoreTake(forgotten_, 0);  // a "done" left over from an earlier, unawaited forgetting
  if (!submit(command)) {
    return false;
  }
  return xSemaphoreTake(forgotten_, pdMS_TO_TICKS(timeoutMs)) == pdTRUE;
}

void NetWorker::askInbox() {
  // A person's double tap: one request at most every two seconds, however fast they tap.
  const uint32_t now = millis();
  const uint32_t last = lastAskMs_.load();
  if (askedBefore_.load() && static_cast<uint32_t>(now - last) < kAskMinGapMs) {
    return;
  }
  lastAskMs_.store(now);
  askedBefore_.store(true);
  if (inboxTask_ != nullptr) {
    xTaskNotifyGive(inboxTask_);  // wakes the inbox task out of a backoff wait
  }
}

std::string NetWorker::confirmCode() {
  std::string code;
  xSemaphoreTake(confirmMutex_, portMAX_DELAY);
  code = confirmCode_;
  xSemaphoreGive(confirmMutex_);
  return code;
}

void NetWorker::networkEntry(void* self) { static_cast<NetWorker*>(self)->networkLoop(); }
void NetWorker::inboxEntry(void* self) { static_cast<NetWorker*>(self)->inboxLoop(); }

float NetWorker::jitter() { return static_cast<float>(esp_random()) / 4294967296.0f; }

void NetWorker::post(const Event& event) {
  Msg message;
  message.kind = MsgKind::App;
  message.event = event;
  mailbox_.post(message);
}

void NetWorker::postSlotDone(int slot) {
  Msg message;
  message.kind = MsgKind::SlotDone;
  message.slot = slot;
  mailbox_.post(message);
}

// A call got an answer from OpenStellarFirm (of any status): it is reachable. Runs on
// either task.
void NetWorker::noteReachable() {
  const bool wasDown = shared_.serverDown.exchange(false);
  if (wasDown) {
    probeReset_.store(true);  // maintain() starts the backoff over
  }
  // The state machine can be offline without the network side ever having seen the
  // server go (its Sending watchdog gave up on a slow answer, or the command queue
  // was full). Nothing else would tell it that OpenStellarFirm answers, and every
  // recording would be saved as a note that never syncs. WifiUp means "reachable".
  if (wasDown || !shared_.appOnline.load()) {
    post(Event::simple(EventType::WifiUp));
  }
}

// A call failed at the network level while the Wi-Fi is up. Runs on either task.
void NetWorker::noteUnreachable(bool announce) {
  if (!WifiLink::connected()) {
    return;  // the Wi-Fi itself is down; superviseWifi() says so
  }
  if (!shared_.serverDown.exchange(true)) {
    probeArm_.store(true);  // maintain() times the first probe
    if (announce) {
      post(Event::simple(EventType::ServerUnreachable));
    }
  }
}

HeartbeatState NetWorker::heartbeatState() const {
  HeartbeatState state;
  state.batteryBand = shared_.batteryBand.load();
  state.charging = shared_.charging.load();
  state.queue = shared_.noteCount.load();
  state.skin = shared_.skin.present ? static_cast<int8_t>(shared_.skin.kind) : static_cast<int8_t>(-1);
  return state;
}

// -- The network task ----------------------------------------------------------------

void NetWorker::networkLoop() {
  for (;;) {
    NetCommand command;
    if (xQueueReceive(commands_, &command, pdMS_TO_TICKS(25)) == pdTRUE) {
      handle(command);
    }
    superviseWifi();
    maintain();
    serveUsb();
  }
}

void NetWorker::handle(const NetCommand& command) {
  if (forgetRequested_.load() && command.op != NetOp::ForgetAll) {
    // The pet is being forgotten: whatever was queued before that does not run (a
    // heartbeat or an upload with the old token would only keep the wipe waiting).
    if (command.op == NetOp::SendTurn || command.op == NetOp::SaveNote) {
      postSlotDone(command.slot);
    }
    return;
  }
  switch (command.op) {
    case NetOp::StartSetup:
      runSetup();
      break;
    case NetOp::SendTurn:
      doTurn(command);
      break;
    case NetOp::SaveNote:
      doSave(command);
      break;
    case NetOp::StartSync:
      doSync();
      break;
    case NetOp::FetchSay:
      doSay(command);
      break;
    case NetOp::Heartbeat:
      // With no pairing, no Wi-Fi or a server that is not answering, a heartbeat
      // would hold this task for the whole HTTP timeout while a saved note or a
      // spoken notice waits behind it. Keep the wish; maintain() sends it once
      // OpenStellarFirm can be reached.
      if (!shared_.paired.load() || !shared_.online.load() || shared_.serverDown.load()) {
        heartbeat_.request();
        break;
      }
      // Asked for by the state machine on many small changes: not more than one
      // every two seconds.
      if (static_cast<uint32_t>(millis() - lastHeartbeatTryMs_) >= 2000) {
        sendHeartbeat();
      } else {
        heartbeat_.request();
      }
      break;
    case NetOp::ForgetAll:
      doForget();
      break;
  }
}

// Keeps the Wi-Fi joined: tells the state machine when it comes and goes, and
// joins the saved network again with a growing wait when it is not there.
void NetWorker::superviseWifi() {
  const uint32_t now = millis();
  if (static_cast<uint32_t>(now - lastWifiCheckMs_) < 500) {
    return;
  }
  lastWifiCheckMs_ = now;
  if (setupActive_ || !shared_.paired.load() || !secrets_.hasWifi()) {
    if (static_cast<uint32_t>(now - lastWifiNoteMs_) >= 15000) {
      lastWifiNoteMs_ = now;
      PET_LOG("wifi: not joining (setup %d, paired %d, saved network %d)", setupActive_ ? 1 : 0,
              shared_.paired.load() ? 1 : 0, secrets_.hasWifi() ? 1 : 0);
    }
    return;
  }

  if (WifiLink::connected()) {
    if (!wifiWasUp_) {
      wifiWasUp_ = true;
      wifiBackoff_.reset();
      WifiLink::saveEnergy();
      shared_.online.store(true);
      shared_.serverDown.store(false);
      PET_LOG("wifi: joined");
      post(Event::simple(EventType::WifiUp));
    }
    return;
  }

  if (wifiWasUp_) {
    wifiWasUp_ = false;
    shared_.online.store(false);
    post(Event::simple(EventType::WifiDown));
    // The Wi-Fi library reconnects by itself first; join again by hand only if
    // that has not worked within ten seconds.
    nextJoinAtMs_ = now + 10000;
  }
  if (static_cast<int32_t>(now - nextJoinAtMs_) >= 0) {
    PET_LOG("wifi: joining the saved network (status %d)", WifiLink::status());
    WifiLink::prepare();
    WifiLink::beginJoin(secrets_.wifiSsid(), secrets_.wifiPassword(), false);
    nextJoinAtMs_ = now + kJoinTryMs + wifiBackoff_.nextDelayMs(jitter());
  }
}

bool NetWorker::idleForFlashWork() const {
  return shared_.appState.load() == static_cast<uint8_t>(State::Ready) && !speaker_.busy() && !player_.active();
}

// What the network task does on its own when it has no command: the heartbeat, a
// probe of a server that stopped answering, and the voice pack.
void NetWorker::maintain() {
  // The backoff of the probe belongs to this task alone (the inbox task only
  // leaves flags), whatever else is going on.
  if (probeReset_.exchange(false)) {
    probeBackoff_.reset();
  }
  if (setupActive_ || !shared_.paired.load() || !shared_.online.load()) {
    return;
  }
  const uint32_t now = millis();
  if (shared_.serverDown.load()) {
    if (probeArm_.exchange(false)) {
      // The server just stopped answering: the first probe comes after the first step.
      nextProbeAtMs_ = now + probeBackoff_.nextDelayMs(jitter());
    }
    if (static_cast<int32_t>(now - nextProbeAtMs_) >= 0) {
      // A heartbeat is the probe: when it is answered, noteReachable() tells the
      // state machine that OpenStellarFirm is back.
      sendHeartbeat();
      if (shared_.serverDown.load()) {
        nextProbeAtMs_ = millis() + probeBackoff_.nextDelayMs(jitter());
      }
    }
    return;
  }
  if (static_cast<uint32_t>(now - lastHeartbeatTryMs_) >= kHeartbeatRetryMs && heartbeat_.due(heartbeatState(), now)) {
    sendHeartbeat();
  }
  tryVoicePack();
}

// -- Setup and pairing ---------------------------------------------------------------

void NetWorker::onSetupStatus(void* self, SetupState state, SetupFailure failure) {
  static_cast<NetWorker*>(self)->usb_.report(state, failure);
}

UsbSetup::Info NetWorker::usbInfo() const {
  UsbSetup::Info info;
  info.paired = shared_.paired.load();
  info.busy = trying_;
  info.setupOpen = setupActive_ && setup_.running();
  return info;
}

// Serves the setup page and the USB cable together. Both are polled, never waited on,
// so this is called from every loop that waits in setup.
void NetWorker::pumpSetup() {
  setup_.service();
  usb_.service(usbInfo());
}

// A cancel from the cable ends a try only when the cable started it. The computer's page
// shows the state of a try the phone started too (the pet reports every state to both),
// and its Stop or "Use the pet's Wi-Fi instead" must not end the phone's try. The flag is
// read whatever the source, so a cancel meant for another source's try cannot be left
// behind to end the next one.
bool NetWorker::cableStops(TrySource source) {
  const bool asked = usb_.takeCancel();
  return asked && source == TrySource::Usb;
}

// The pet's own Wi-Fi network and the setup page on it. The network is WPA2 with the
// pet's own passphrase, which its voice told the owner (main.cpp). A pet that has none to
// give does not start it: never an open one.
bool NetWorker::openSetupNetwork() {
  const uint64_t mac = ESP.getEfuseMac();
  const uint8_t byteFive = static_cast<uint8_t>((mac >> 32) & 0xff);
  const uint8_t byteSix = static_cast<uint8_t>((mac >> 40) & 0xff);
  const int kindIndex = static_cast<int>(kind_) < PET_KIND_COUNT ? static_cast<int>(kind_) : 0;
  return setup_.start(apName(kind_, byteFive, byteSix), PET_KIND_NAMES[kindIndex], secrets_.setupPassphrase());
}

void NetWorker::runSetup() {
  if (setupActive_) {
    return;
  }
  setupActive_ = true;
  wifiWasUp_ = false;
  shared_.online.store(false);

  if (!openSetupNetwork()) {
    setupActive_ = false;
    post(Event::simple(EventType::Fault));
    return;
  }
  PET_LOG("setup: waiting for the owner on the pet's own network or the cable");

  // Ten minutes with nobody finishing, and the network goes off again; a tap or a hold
  // of the light opens it. A try in progress is never cut off: the window starts again
  // after each one that did not pair. The cable works whether the window is open or not
  // (serveUsb), and a join over it counts as a try like any other.
  SetupWindow window;
  window.restart(millis());
  bool paired = false;
  bool timedOut = false;
  while (!paired && !timedOut) {
    pumpSetup();
    // The only command that matters while setting up: forgetting, from a reset.
    NetCommand command;
    if (xQueueReceive(commands_, &command, 0) == pdTRUE && command.op == NetOp::ForgetAll) {
      doForget();
    }
    SetupSubmission submission;
    if (setup_.takeSubmission(submission)) {
      // The first submission wins: a join that was waiting on the cable is turned away.
      usb_.dropSubmission();
      paired = pairWith(submission, TrySource::Page);
      window.restart(millis());
    } else if (usb_.takeSubmission(submission)) {
      paired = pairWith(submission, TrySource::Usb);
      if (!paired && !forgetRequested_.load() && !openSetupNetwork()) {
        PET_LOG("setup: the setup network would not come back after a try over the cable");
      }
      window.restart(millis());
    } else if (window.over(millis())) {
      timedOut = true;
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }

  if (timedOut) {
    PET_LOG("setup: nobody finished in time, the setup network is off");
    setup_.stop();
    // A try that joined the home Wi-Fi and was then refused left the radio on.
    const bool wasOnline = shared_.online.load();
    WifiLink::drop();
    shared_.online.store(false);
    setupActive_ = false;
    wifiWasUp_ = false;
    if (wasOnline) {
      post(Event::simple(EventType::WifiDown));
    }
    post(Event::simple(EventType::SetupTimedOut));
    return;
  }

  // Let the page read "done", then switch the setup network off.
  const uint32_t until = millis() + kSetupLingerMs;
  while (static_cast<int32_t>(millis() - until) < 0) {
    pumpSetup();
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  setup_.stop();
  setupActive_ = false;
  wifiWasUp_ = true;  // we are joined, and the state machine already heard WifiUp
  wifiBackoff_.reset();
  heartbeat_.request();
}

// The cable while the setup network's window is closed: the pet answers hello, status,
// cancel and a scan whenever it is not paired, and a join runs one try with the pet as a
// station only. A cable is proof of presence, like a tap of the light, so this opens
// nothing but the one try. If it fails the state machine opens the setup network again,
// as it does after a failed try on the page.
void NetWorker::serveUsb() {
  if (setupActive_) {
    return;  // runSetup() and the try it runs serve the cable beside the page
  }
  usb_.service(usbInfo());
  SetupSubmission submission;
  if (!usb_.takeSubmission(submission)) {
    return;
  }
  setupActive_ = true;
  wifiWasUp_ = false;
  shared_.online.store(false);
  const bool paired = pairWith(submission, TrySource::Usb);
  setupActive_ = false;
  if (paired) {
    wifiWasUp_ = true;  // joined, and the state machine already heard WifiUp
    wifiBackoff_.reset();
    heartbeat_.request();
  }
}

// One try: join the Wi-Fi, ask OpenStellarFirm to pair, wait for the owner to type the
// confirm code, claim the token. True when the pet is paired. Every way out sets the
// status the page shows, with the fixed reason the cable reports for an error.
bool NetWorker::pairWith(const SetupSubmission& submission, TrySource source) {
  BusyScope busy(trying_);
  usb_.takeCancel();  // a cancel left over from an earlier try is not this try's

  // A pet pairs only with a computer whose certificate it was told to pin, and only the
  // cable carries that. A submission with no computer (the setup page's, were it ever
  // accepted again) pairs with nothing: there is no connection to make without a pin.
  TrialServer trial(api_);
  if (!submission.hasServer || !api_.useServer(submission.server)) {
    setup_.setStatus(SetupState::Error, "I can only be set up from OpenStellarFirm over my USB cable.", std::string(),
                     SetupFailure::Unreachable);
    post(Event::simple(EventType::PairRefused));
    return false;
  }
  post(Event::simple(EventType::SetupSubmitted));
  setup_.setStatus(SetupState::Joining, "Joining your Wi-Fi...");

  // A try from the cable needs no setup network. With it up a scan or a join would pull
  // it off its channel, so it is switched off for the length of the try; runSetup()
  // opens it again if the try fails.
  if (source == TrySource::Usb) {
    setup_.stop();
  }
  WifiLink::beginJoin(submission.ssid, submission.password, source == TrySource::Page);
  const uint32_t joinStart = millis();
  bool cancelled = false;
  while (!cancelled && !WifiLink::connected() && static_cast<uint32_t>(millis() - joinStart) < kSetupJoinTimeoutMs) {
    pumpSetup();
    cancelled = cableStops(source);
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  if (cancelled || !WifiLink::connected()) {
    WifiLink::abortJoin();
    setup_.setStatus(SetupState::Error, "I could not join that Wi-Fi. Check the name and the password, and try again.", std::string(),
                     SetupFailure::WifiFailed);
    post(Event::simple(EventType::WifiDown));  // the state machine says so and opens setup again
    return false;
  }
  WifiLink::saveEnergy();
  shared_.online.store(true);
  post(Event::simple(EventType::WifiUp));
  secrets_.setWifi(submission.ssid, submission.password);

  setup_.setStatus(SetupState::Pairing, "Asking OpenStellarFirm to pair me...");
  // A new secret for each try, so an old request can never be claimed by this one.
  secrets_.newDeviceSecret();
  PairOut pairOut;
  const ApiResult pair = api_.pair(submission.code, kind_, pairOut);
  if (pair.status != 200) {
    secrets_.clearDeviceSecret();  // no request was made, so nothing will be claimed with it
    if (pair.status == 400 || pair.status == 404) {
      // The code is unknown, used or too old (400), or desk pets are not switched on (404).
      setup_.setStatus(SetupState::Error, "OpenStellarFirm did not accept that setup code. Make a new one in OpenStellarFirm and try again.",
                       std::string(), SetupFailure::CodeRefused);
      post(Event::pairRequested(false));
    } else {
      setup_.setStatus(SetupState::Error, "I could not reach OpenStellarFirm. Try again in a moment.", std::string(),
                       SetupFailure::Unreachable);
      post(Event::simple(EventType::ServerUnreachable));
    }
    return false;
  }

  // The confirm code is on the page and spoken. The owner types it in OpenStellarFirm. (The
  // cable is only told "confirm": the code itself never leaves the pet but by its voice
  // and the page.)
  xSemaphoreTake(confirmMutex_, portMAX_DELAY);
  confirmCode_ = pairOut.confirmCode;
  xSemaphoreGive(confirmMutex_);
  setup_.setStatus(SetupState::Confirm, "Type this code in OpenStellarFirm to approve me.", pairOut.confirmCode);
  post(Event::pairRequested(true));

  const bool paired = claimToken(pairOut, source);
  if (paired) {
    trial.keep();  // claimToken stored the computer with the token
  }

  xSemaphoreTake(confirmMutex_, portMAX_DELAY);
  confirmCode_.clear();
  xSemaphoreGive(confirmMutex_);
  return paired;
}

// Rule 2: the claim is the third step, and the token is kept only after it.
// Rule 1: the device secret (made for this try, sent only in the claim) is kept no
// longer than the try: setPaired() removes it when the claim worked, and every other
// way out of here removes it too.
bool NetWorker::claimToken(const PairOut& pairOut, TrySource source) {
  const uint32_t deadline = millis() + static_cast<uint32_t>(PET_PAIR_REQUEST_TTL_SECONDS) * 1000u;
  while (static_cast<int32_t>(millis() - deadline) < 0) {
    // Serve the page and the cable for two seconds, then ask again.
    const uint32_t until = millis() + kClaimPollMs;
    while (static_cast<int32_t>(millis() - until) < 0) {
      if (forgetRequested_.load()) {
        secrets_.clearDeviceSecret();
        return false;  // a reset is waiting: doForget() runs next
      }
      pumpSetup();
      if (cableStops(source)) {
        // The computer gave up on this try. The request on the server runs out unclaimed.
        secrets_.clearDeviceSecret();
        setup_.setStatus(SetupState::Error, "Setup was stopped. Make a new setup code and try again.", std::string(),
                         SetupFailure::TimedOut);
        post(Event::simple(EventType::PairRefused));
        return false;
      }
      vTaskDelay(pdMS_TO_TICKS(10));
    }
    ClaimOut claim;
    const ApiResult result = api_.claim(pairOut.requestId, claim);
    if (result.status == 200) {
      // The computer is stored first, with the address that worked, and then the token:
      // a pet is never left with a token and no pin to use it against.
      if (!api_.keepServer()) {
        secrets_.clearDeviceSecret();
        setup_.setStatus(SetupState::Error, "I could not save my pairing. Try again.", std::string(), SetupFailure::SaveFailed);
        post(Event::simple(EventType::PairRefused));
        return false;
      }
      if (!secrets_.setPaired(claim.token, claim.deviceId)) {
        secrets_.clearServer();
        secrets_.clearDeviceSecret();
        setup_.setStatus(SetupState::Error, "I could not save my pairing. Try again.", std::string(), SetupFailure::SaveFailed);
        post(Event::simple(EventType::PairRefused));
        return false;
      }
      // A new pairing is a new inbox on the server (setPaired() put the cursor back to 0).
      pairing_.fetch_add(1);
      applySettings(claim.settings);
      shared_.paired.store(true);
      setup_.setStatus(SetupState::Done, "All set. Hold my lime light and talk to me.");
      post(Event::simple(EventType::PairApproved));
      return true;
    }
    if (result.status == 410) {
      secrets_.clearDeviceSecret();
      setup_.setStatus(SetupState::Error, "OpenStellarFirm did not accept me. Make a new setup code and try again.", std::string(),
                       SetupFailure::CodeRefused);
      post(Event::simple(EventType::PairRefused));
      return false;
    }
    // 202 (not approved yet), a network error or a busy server: keep waiting.
  }
  secrets_.clearDeviceSecret();
  setup_.setStatus(SetupState::Error, "The code was not typed in time. Make a new setup code and try again.", std::string(),
                   SetupFailure::TimedOut);
  post(Event::simple(EventType::PairRefused));
  return false;
}

// -- Turns, notes, notices -----------------------------------------------------------

// What the server can answer to a turn is told apart by turnVerdictFor (core/api_rules.h,
// the same table the tests walk): 200 is the reply, 208 says the server has this turn
// already, 401 "forgotten" sends the pet back to setup, no answer / a timeout / a 5xx
// keeps the recording as a saved note, and everything else is an answer with a line.
void NetWorker::doTurn(const NetCommand& command) {
  MemorySource source(command.wav, command.bytes);
  post(Event::simple(EventType::TurnStarted));

  ReplyPlayer sink(*this, PlayTag::Reply, true, command.epoch);
  const ApiResult result = api_.turn(source, command.turnId, command.recordedAt, false, &sink);
  sink.finish();

  switch (turnVerdictFor(result.status, result.error)) {
    case TurnVerdict::Reply:
      noteReachable();
      if (!sink.started()) {
        post(Event::turnFailed(PET_LINE_BUSY));  // a 200 that never said what it was
      } else if (sink.unplayable()) {
        speaker_.notifyDrained(PlayTag::Reply);
      } else if (!sink.gotAudio() && !sink.stopped()) {
        // A 200 with an empty body: the run started, and the speech failed after that.
        // The state in the header says where things stand, and the pet says the clip of
        // its own pack for it (the team is on it, a step waits for the owner's Approve, the
        // rules say no, or: there is a message in the app).
        player_.playEpoch(command.epoch, PlayTag::Reply, clipForSilentReply(sink.state()));
      }
      // With audio, the speaker reports PlayDone(Reply) when the last word is out.
      break;
    case TurnVerdict::Received:
      // The server already has this turn: there is no answer to play.
      noteReachable();
      post(Event::replyStarted(PET_STATE_ANSWERED));
      post(Event::simple(EventType::ReplyEnded));
      break;
    case TurnVerdict::Forgotten:
      post(Event::simple(EventType::Forgotten));
      break;
    case TurnVerdict::Unreachable:
      // No answer, a timeout or a server error: the recording is kept as a saved note
      // (the state machine asks for that on this event), and a probe finds out when
      // OpenStellarFirm is back.
      noteUnreachable(false);
      post(Event::turnFailed(PET_LINE_SAVED));
      break;
    case TurnVerdict::Failed:
      // An answer: busy, voice quota used up, paused, a refusal of the recording. The pet says the
      // line it names and stays paired.
      noteReachable();
      post(Event::turnFailed(lineFromAnswer(result.status, result.error, result.line)));
      break;
  }
  // After the failure event, so the slot is still there when the note is saved.
  postSlotDone(command.slot);
}

// Flash erases stop the whole chip for a moment, and the microphone's receiver is
// not safe against that: samples would be lost from the middle of a recording. So a
// note waits until the pet has stopped listening, the way the voice pack does
// (idleForFlashWork). A recording is at most PET_RECORD_MAX_SECONDS (two minutes), so
// the wait is bounded: that, and ten seconds more.
void NetWorker::waitWhileListening() const {
  constexpr int kStepMs = 50;
  constexpr int kMaxSteps = (PET_RECORD_MAX_SECONDS + 10) * 1000 / kStepMs;
  for (int i = 0; i < kMaxSteps && shared_.appState.load() == static_cast<uint8_t>(State::Listening) && !forgetRequested_.load();
       ++i) {
    vTaskDelay(pdMS_TO_TICKS(kStepMs));
  }
}

void NetWorker::doSave(const NetCommand& command) {
  waitWhileListening();
  const AddResult result = queue_.add(command.turnId, command.recordedAt, command.wav, command.bytes);
  if (result == AddResult::Saved) {
    secrets_.setNextNoteSeq(queue_.nextSeq());
  }
  shared_.noteCount.store(static_cast<uint8_t>(std::min<size_t>(queue_.pending(), 255)));
  post(Event::noteSaved(result));
  postSlotDone(command.slot);
}

// Sends the saved notes, oldest first, each as a turn with its own id and
// X-Pet-Offline: 1. A note is confirmed (deleted) only on a 200 or 208. A note the
// server refuses for its content stays on the pet (rule 6) but is marked refused, on
// flash, so it is not sent (and transcribed) again on every boot, does not hold up
// the notes behind it and is not counted as waiting; any other trouble stops the
// pass.
void NetWorker::doSync() {
  size_t sent = 0;
  bool offline = false;
  bool retry = false;
  bool forgotten = false;
  const char* retryLine = PET_LINE_BUSY;

  // Paused in Settings: OpenStellarFirm would refuse every note, but only after the whole
  // upload (up to 0.97 MB each time). The last settings the pet heard say
  // paused, so nothing goes out until a heartbeat says it is not.
  if (secrets_.settings().paused) {
    post(Event::turnFailed(PET_LINE_PAUSED));
    return;
  }

  NoteInfo info;
  bool have = queue_.oldest(info);
  while (have) {
    if (forgetRequested_.load()) {
      return;  // the pet is being forgotten: the wipe runs next and nothing more is sent
    }
    if (info.refused == 0) {
      NoteSource source(store_, info.name, info.bytes);
      const std::string turn = info.turn.empty() ? newTurnId() : info.turn;
      const ApiResult result = api_.turn(source, turn, info.recordedAt, true, nullptr);
      const SyncOutcome outcome = syncOutcomeFor(result.status, result.error);
      if (outcome == SyncOutcome::Confirm) {
        noteReachable();
        if (!queue_.confirm(info.name)) {
          retry = true;  // the file could not be removed: stop, it is sent again with the same id
          break;
        }
        ++sent;
        shared_.noteCount.store(static_cast<uint8_t>(std::min<size_t>(queue_.pending(), 255)));
      } else if (outcome == SyncOutcome::SkipNote) {
        noteReachable();
        queue_.markRefused(info.name, result.status);
        shared_.noteCount.store(static_cast<uint8_t>(std::min<size_t>(queue_.pending(), 255)));
        PET_LOG("sync: a saved note was refused, keeping it on the pet and not sending it again");
      } else if (outcome == SyncOutcome::StopOffline) {
        noteUnreachable(false);
        offline = true;
        break;
      } else if (outcome == SyncOutcome::StopServerError) {
        // A server error or a timeout counts as unreachable, so the probe runs, but the
        // Wi-Fi is up: the sync waits out its backoff (retry) instead of starting again
        // as soon as a heartbeat is answered, and no note is deleted.
        noteUnreachable(false);
        retry = true;
        retryLine = PET_LINE_BUSY;
        break;
      } else if (outcome == SyncOutcome::Forgotten) {
        forgotten = true;
        break;
      } else {
        noteReachable();
        retry = true;
        retryLine = lineForError(result.status, result.error);
        break;
      }
    }
    have = queue_.next(info.seq, info);
  }

  if (forgotten) {
    post(Event::simple(EventType::Forgotten));
  } else if (offline) {
    post(Event::turnFailed(PET_LINE_SAVED));
  } else if (retry) {
    post(Event::turnFailed(retryLine));
  } else if (sent > 0) {
    post(Event::simple(EventType::NotesSynced));
  } else if (queue_.pending() == 0) {
    // Only refused notes were left and nothing went out: they are no longer
    // waiting, and the pet does not say it sent anything.
    post(Event::notesSyncedNothingSent());
  } else {
    post(Event::turnFailed(PET_LINE_BUSY));
  }
}

void NetWorker::doSay(const NetCommand& command) {
  ReplyPlayer sink(*this, PlayTag::Notice, false, command.epoch);
  const ApiResult result = api_.say(command.seq, sink);
  sink.finish();

  if (result.ok() && sink.gotAudio()) {
    noteReachable();
    return;  // the speaker reports PlayDone(Notice)
  }
  if (sink.unplayable()) {
    speaker_.notifyDrained(PlayTag::Notice);
    return;
  }
  if (sink.stopped()) {
    return;  // the pet was told to stop
  }
  if (isForgotten(result.status, result.error)) {
    post(Event::simple(EventType::Forgotten));
    return;
  }
  if (isUnreachable(result.status)) {
    noteUnreachable(true);
  } else {
    noteReachable();
  }
  // Could not be read aloud (offline, voice quota used up, the notice is gone): the pet
  // says the line of its own that stands in for it, unless the owner has stopped the
  // pet while it waited. A pet that is paused (409) and a busy OpenStellarFirm (429)
  // say that instead; nothing is asked for again.
  const char* standIn = command.fallback[0] != '\0' ? command.fallback : PET_LINE_MESSAGE;
  player_.playEpoch(command.epoch, PlayTag::Notice, lineForFailedSay(result.status, result.error, result.line, standIn));
}

void NetWorker::doForget() {
  pairing_.fetch_add(1);
  api_.dropServer();  // first: nothing connects while the wipe runs
  secrets_.clearAll();
  // A new passphrase for the setup network, so the one a previous owner heard is no
  // good. Made now, while the radio is still on: the hardware random numbers are true
  // random only then (WifiLink::drop() below turns it off).
  secrets_.setupPassphrase();
  store_.wipe();
  queue_.load();  // now empty
  packs_.removeAll();
  wantedVoice_.clear();
  packVoice_.clear();
  WifiLink::drop();
  wifiWasUp_ = false;
  shared_.paired.store(false);
  shared_.online.store(false);
  shared_.serverDown.store(false);
  shared_.noteCount.store(0);
  forgetRequested_.store(false);
  xSemaphoreGive(forgotten_);
}

// -- Heartbeat, settings, voice pack ---------------------------------------------------

void NetWorker::sendHeartbeat() {
  const uint32_t now = millis();
  lastHeartbeatTryMs_ = now;
  const HeartbeatState state = heartbeatState();

  HeartbeatIn in;
  in.battery = static_cast<float>(shared_.batteryPermille.load()) / 1000.0f;
  in.charging = state.charging;
  in.rssi = WifiLink::rssi();
  in.queue = state.queue;
  in.skin = skinWireName(shared_.skin);
  in.uptimeSeconds = now / 1000u;

  HeartbeatOut out;
  const ApiResult result = api_.heartbeat(in, out);
  if (result.status == 200) {
    heartbeat_.sent(state, now);
    noteReachable();
    applySettings(out.settings);
    if (shared_.quiet.exchange(out.quiet) != out.quiet) {
      post(Event::quietChanged(out.quiet));
    }
  } else if (isForgotten(result.status, result.error)) {
    post(Event::simple(EventType::Forgotten));
  } else if (isUnreachable(result.status)) {
    noteUnreachable(true);
  } else {
    // The server answered, with an error: not heard from again for a period.
    heartbeat_.sent(state, now);
    noteReachable();
  }
}

void NetWorker::applySettings(const ServerSettings& settings) {
  if (!settings.valid) {
    return;
  }
  StoredSettings stored = secrets_.settings();
  StoredSettings next = stored;
  next.paused = settings.paused;
  next.speakNotices = settings.speakNotices;
  next.volumePercent = static_cast<uint8_t>(std::lround(settings.volume * 100.0f));
  if (settings.voice[0] != '\0') {
    std::strncpy(next.voice, settings.voice, sizeof(next.voice) - 1);
    next.voice[sizeof(next.voice) - 1] = '\0';
  }
  // Flash is written only when something changed.
  if (next.paused != stored.paused || next.speakNotices != stored.speakNotices || next.volumePercent != stored.volumePercent ||
      std::strcmp(next.voice, stored.voice) != 0) {
    secrets_.saveSettings(next);
  }
  shared_.speakNotices.store(settings.speakNotices);
  speaker_.setVolume(settings.volume);
  if (settings.voice[0] != '\0') {
    if (wantedVoice_ != settings.voice) {
      // The owner chose another voice: its pack is tried at the next idle moment, not
      // after the wait that a failed try for the old one left behind.
      nextPackTryAtMs_ = millis();
    }
    wantedVoice_ = settings.voice;
  }
}

// Fetches the pack of the pet's voice when the one on flash is not it. Done only
// while the pet is idle: a flash write stalls the chip for a moment, and the pet
// must not stutter in the middle of a word or lose a piece of a recording.
void NetWorker::tryVoicePack() {
  if (wantedVoice_.empty() || !isVoiceId(wantedVoice_.c_str()) || wantedVoice_ == packVoice_) {
    return;
  }
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - nextPackTryAtMs_) < 0 || !idleForFlashWork()) {
    return;
  }
  if (flashFreeBytes() < kPackMaxBytes + kPackFlashMargin) {
    PET_LOG("voice: not enough room for the voice pack");
    nextPackTryAtMs_ = now + kPackMissingRetryMs;
    return;
  }

  const std::string voice = wantedVoice_;
  char urlPath[64];
  char tempPath[48];
  if (!packUrlPath(voice.c_str(), urlPath, sizeof(urlPath)) || !packs_.tempPath(voice.c_str(), tempPath, sizeof(tempPath))) {
    return;
  }

  File file = LittleFS.open(tempPath, FILE_WRITE);
  if (!file) {
    nextPackTryAtMs_ = now + kPackRetryMs;
    return;
  }
  struct Context {
    NetWorker* worker;
  } context{this};
  auto keepGoing = [](void* raw) -> bool {
    NetWorker* worker = static_cast<Context*>(raw)->worker;
    return worker->idleForFlashWork() && uxQueueMessagesWaiting(worker->commands_) == 0 && !worker->forgetRequested_.load();
  };
  PackFileSink sink(file, keepGoing, &context);
  const ApiResult result = api_.download(urlPath, sink, kPackMaxBytes);
  file.close();

  bool installed = false;
  if (result.status == 200 && !result.truncated && !sink.failed && !sink.interrupted && packs_.validateTemp(voice.c_str()) &&
      idleForFlashWork()) {
    installed = packs_.install(voice.c_str());
    if (installed) {
      secrets_.setPackVoice(voice);
      packVoice_ = voice;
      PET_LOG("voice: the voice pack is in place");
    }
  }
  if (!installed) {
    packs_.discardTemp(voice.c_str());
    if (sink.interrupted) {
      nextPackTryAtMs_ = millis() + 30000;
    } else if (result.status == 404) {
      nextPackTryAtMs_ = millis() + kPackMissingRetryMs;  // the pack is not published yet: the boot pack serves
    } else {
      nextPackTryAtMs_ = millis() + kPackRetryMs;
    }
    if (isUnreachable(result.status)) {
      noteUnreachable(true);
    }
  } else {
    noteReachable();
  }
}

// -- The inbox task --------------------------------------------------------------------

bool NetWorker::inboxMayPoll() const {
  if (!shared_.paired.load() || !shared_.online.load() || shared_.serverDown.load()) {
    return false;
  }
  switch (static_cast<State>(shared_.appState.load())) {
    case State::Boot:
    case State::SetupWifi:
    case State::Pairing:
    case State::Listening:
    case State::Sending:
      return false;  // not while setting up, and never in the way of a turn
    default:
      return true;
  }
}

void NetWorker::handleNotice(const Notice& notice, bool quietNow) {
  // The pairing greeting is a message like any other: read aloud through say, and
  // when that cannot be done the pack's "hello" stands in (planInboxNotice).
  const NoticePlan plan =
      planInboxNotice(notice.kind, notice.role.empty() ? nullptr : notice.role.c_str(), notice.hasTitle, notice.line.c_str());
  post(Event::noticeArrived(notice.kind, notice.seq, quietNow, shared_.speakNotices.load(), plan, notice.chatKey, notice.runKey));
}

void NetWorker::inboxLoop() {
  Backoff backoff(PET_BACKOFF_BASE_MS, PET_BACKOFF_MAX_MS);
  uint32_t after = 0;
  bool wasPaired = false;
  for (;;) {
    if (!shared_.paired.load()) {
      wasPaired = false;
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!wasPaired) {
      // A new pairing starts a new inbox on the server: read where this one stands.
      after = secrets_.inboxAfter();
      wasPaired = true;
    }
    if (!inboxMayPoll()) {
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    InboxOut inbox;
    const uint32_t pairing = pairing_.load();
    // A double tap's wake-up is for a backoff wait below; one that came while the last
    // poll was out is answered by that poll, so it is cleared before the next starts.
    ulTaskNotifyTake(pdTRUE, 0);
    const ApiResult result = api_.inbox(after, PET_INBOX_WAIT_SECONDS, inbox);
    if (pairing != pairing_.load()) {
      // The pet was forgotten, or paired again, while the poll was out: whatever came
      // back belongs to the old pairing. Start from where the new one stands.
      wasPaired = false;
      continue;
    }
    if (result.status == 200) {
      backoff.reset();
      noteReachable();
      // The quiet flag goes first, so a notice in the same answer is judged by it. It
      // is the server's word (worked out from the owner's quiet hours and time zone), never
      // a clock on the pet; the heartbeat's answer carries the same flag.
      if (shared_.quiet.exchange(inbox.quiet) != inbox.quiet) {
        post(Event::quietChanged(inbox.quiet));
      }
      for (const Notice& notice : inbox.notices) {
        handleNotice(notice, inbox.quiet);
      }
      // `next` is where the server says the pet stands. It can be lower than `after`
      // (the counter started over), so it is kept whenever it differs.
      const InboxCursor cursor = inboxCursorAfter(after, inbox.next);
      after = cursor.after;
      if (cursor.store) {
        secrets_.setInboxAfter(after);
      }
      continue;
    }
    if (isForgotten(result.status, result.error)) {
      post(Event::simple(EventType::Forgotten));
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }
    if (isUnreachable(result.status)) {
      noteUnreachable(true);
    } else {
      noteReachable();
    }
    // Wait out the backoff, unless the owner's double tap (askInbox) wakes this task: they
    // asked "what's happening", so the poll is tried again now.
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(backoff.nextDelayMs(jitter())));
  }
}

}  // namespace pet
