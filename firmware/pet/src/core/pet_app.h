#pragma once

// The desk pet's state machine, with no hardware in it. The hardware side
// (gestures, the network task, the audio task, the power monitor) turns what
// happens into an Event; handle() returns the Actions it asks for. It never
// touches a pin, a socket or a clock: the time comes in with each event, and
// every effect goes out as a flag or a voice pack line id.
//
// How the pieces map to it:
//
//   gestures:  HoldStart -> ButtonDown, Up -> ButtonUp, Tap -> Tap,
//              DoubleTap -> DoubleTap, ResetHold -> ResetHold
//              (docs/desk-pets-plan.md: a hold starts listening; a tap stops it, or plays
//              the waiting notice when the pet is not listening; the plan
//              adds "or repeats the last answer", which is not built yet; a double tap
//              asks "what's happening")
//   microphone: while it records, the main loop sends a Voice event every tick with
//              what the voice activity detector (vad.h) has heard: whether speech
//              began, and how long it has been silent since
//   network:   WifiUp means "OpenStellarFirm is reachable": the Wi-Fi joined, or a
//              call worked again after ServerUnreachable. A 401 "forgotten"
//              answer is Forgotten (not TurnFailed), and only that answer.
//   main loop: a Tick every 100 ms or so (the 120 second cap, the wait for first
//              speech and the watchdogs need time to pass)
//
// The rules the tests pin (docs/desk-pets-plan.md, "Rules the code must keep"):
//
//  * Rule 4: recording() is true exactly in State::Listening, entered only by a
//    ButtonDown (the hold of the lime light) while the mic switch is on, never by
//    anything else and never by itself. Letting go (ButtonUp) does not end it: the
//    pet goes on listening while the owner talks. It ends
//      - on 5 seconds of silence after speech (Voice: silenceMs), and the audio is sent;
//      - on a Tap, or a second hold, the owner pressing the light again: sent at once;
//      - at the 120 second cap, or when the memory for the recording is full: sent;
//      - when no speech began in the first 5 seconds: dropped, with the
//        "didn't catch" line, nothing sent or charged;
//      - when the mic switch goes off, or on a fault, a forgetting, a reset or the
//        battery cut-off: dropped.
//    While it is true the light mode is Listening and LED 0 is solid lime at full
//    brightness, whatever else is on.
//  * Offline, a finished recording is saved (saveNote), never sent.
//  * The pet never approves. There is no event and no action for it: an
//    approval notice only lights the pet and says that a step waits.
//  * A notice never plays in quiet hours or with "say notices aloud" off; it
//    waits for a Tap or a double tap. Whether it is quiet hours is the server's
//    word (the `quiet` of an inbox or heartbeat answer), never a clock on the pet.
//  * A double tap asks "what's happening" and only a resting pet answers it (Ready,
//    Offline, LowBattery): a notice that waits is played now, whatever the quiet hours
//    and "say notices aloud" say, since the owner asked; otherwise, while online, the
//    inbox is asked at once (askInbox) and a notice that comes back within
//    kAskWindowMs is played the same way; and with nothing waiting the pet gives one
//    short lime blink (LightMode::Checked) and says nothing.
//  * No double announcement. A turn answered "needs-approve" has already said
//    that a step waits, and a turn answered "answered" has already said the work
//    is done; an approval notice for the same work within two minutes, or a done
//    notice for the same run, only moves the light.
//
// Actions are what the caller must do after one event:
//
//   startRecording / stopRecording   the mic task starts or stops capturing.
//                                    stopRecording with neither sendTurn nor
//                                    saveNote means "throw the audio away".
//   sendTurn                         upload the recording as a live turn
//   saveNote                         put the recording in the note queue; the
//                                    NoteSaved event comes back with the result
//   startSync                        send the saved notes, oldest first
//   askInbox                         poll the inbox now (a double tap asked "what's
//                                    happening"); what it returns arrives as
//                                    NoticeArrived like any notice
//   stopPlayback                     stop the speaker and abandon a reply stream
//   playLine, playLineThen           pack clips to play now, one after the other
//                                    (the second only when set)
//   fetchSay                         GET /api/pets/say/<seq> and play it (a
//                                    notice seq), or "" lines when 0
//   startSetup                       open the Wi-Fi access point and the setup page
//                                    (the caller then says "setup-join" and spells the
//                                    network's passphrase, see core/setup_access.h)
//   forgetAll                        erase the token, the Wi-Fi and the saved notes
//   restart / shutdown               restart the chip / lights and amp off, deep sleep
//   heartbeat                        send a heartbeat now
//
// After "setup-code" is played the caller adds one "char-<C>" clip per
// character of the confirm code; that is the one place a line is followed by
// text the machine does not know.

#include <cstdint>

#include "generated/protocol.h"
#include "light_frames.h"
#include "note_queue.h"
#include "notice_clips.h"

namespace pet {

enum class State : uint8_t {
  Boot,
  SetupWifi,
  Pairing,
  Ready,
  Listening,
  Sending,
  Speaking,
  Offline,
  Syncing,
  Notice,
  LowBattery,
  Updating,
  Error,
};

const char* stateName(State state);

// Bits of Actions::overlays and PetApp::overlays(): what the pet is showing on
// top of its resting light. The light mode already accounts for them by
// priority; the bits are here for the heartbeat and for debugging.
enum Overlay : uint8_t {
  kOverlayTeamWorking = 1u << 0,
  kOverlayNeedsApprove = 1u << 1,
  kOverlayMicOff = 1u << 2,
  kOverlayCharging = 1u << 3,
  kOverlayQuiet = 1u << 4,
};

enum class EventType : uint8_t {
  Tick,               // time passes
  BootDone,           // paired, wifiKnown, notesWaiting
  WifiUp,             // OpenStellarFirm is reachable
  WifiDown,           // the Wi-Fi was lost
  ServerUnreachable,  // a call failed at the network level
  ButtonDown,         // the hold of the lime light began (the gestures' HoldStart): starts listening
  ButtonUp,           // the hold ended: listening goes on, so this does nothing
  Tap,                // while listening: stop and send at once
  DoubleTap,
  ResetHold,          // the button was held from power-on for 10 seconds
  SetupSubmitted,     // the setup page sent the Wi-Fi password and the setup code
  PairRequested,      // ok: the server made a confirm code; !ok: it refused the code
  PairApproved,       // the claim worked and the token is saved
  PairRefused,        // the claim was refused or expired
  Forgotten,          // a 401 "forgotten": the server no longer knows this pet
  TurnStarted,        // the upload is under way
  ReplyStarted,       // the first audio of the answer arrived; turnState says what it is
  ReplyEnded,         // the speaker finished the reply (only taken while Speaking)
  TurnFailed,         // a turn or a note upload failed; line is the pack line for it
  NoteSaved,          // noteResult
  NotesSynced,        // every saved note was confirmed
  NoticeArrived,      // a notice from the inbox
  NoticeShown,        // the notice finished playing
  QuietChanged,       // the server's `quiet` answer changed (on)
  BatteryLow,
  BatteryOk,
  BatteryCritical,
  Charging,           // on: the charger or USB power is connected
  MicSwitch,          // on: the MIC slide switch is on
  Fault,              // a hardware fault the pet cannot work around
  UpdateOffered,
  Voice,              // while recording: what the voice activity detector has heard
  SetupTimedOut,      // the setup network was switched off after ten minutes with no pairing
};

struct Event {
  EventType type = EventType::Tick;

  // BootDone
  bool paired = false;
  bool wifiKnown = false;
  bool notesWaiting = false;
  // PairRequested (ok)
  bool ok = false;
  // MicSwitch, Charging, QuietChanged
  bool on = false;
  // ReplyStarted
  PetTurnState turnState = PET_STATE_ANSWERED;
  // ReplyStarted, NoticeArrived: the chat and the run the answer or the notice is
  // about, as idKey() of the ids (0 when it names none). They are only compared,
  // to tell a notice that repeats what the last turn said.
  uint32_t chatKey = 0;
  uint32_t runKey = 0;
  // TurnFailed: a PET_LINE_* id from lineForError(); "saved" means a network error
  const char* line = "";
  // Voice: speech began in this recording; milliseconds since the last speech frame;
  // the memory for the recording is full (or the microphone would not start), so
  // nothing more can be kept
  bool speechStarted = false;
  uint32_t silenceMs = 0;
  bool bufferFull = false;
  // NoteSaved
  AddResult noteResult = AddResult::Saved;
  // NotesSynced: only notes OpenStellarFirm had refused were left, and nothing went
  // out, so there is nothing to announce.
  bool nothingSent = false;
  // NoticeArrived
  PetNoticeKind noticeKind = PET_NOTICE_KIND_MESSAGE;
  uint32_t seq = 0;
  bool quietNow = false;
  bool speak = true;
  NoticePlan plan;

  static Event simple(EventType type) {
    Event e;
    e.type = type;
    return e;
  }
  static Event bootDone(bool paired, bool wifiKnown, bool notesWaiting = false) {
    Event e = simple(EventType::BootDone);
    e.paired = paired;
    e.wifiKnown = wifiKnown;
    e.notesWaiting = notesWaiting;
    return e;
  }
  static Event pairRequested(bool ok) {
    Event e = simple(EventType::PairRequested);
    e.ok = ok;
    return e;
  }
  static Event micSwitch(bool on) {
    Event e = simple(EventType::MicSwitch);
    e.on = on;
    return e;
  }
  static Event charging(bool on) {
    Event e = simple(EventType::Charging);
    e.on = on;
    return e;
  }
  static Event quietChanged(bool on) {
    Event e = simple(EventType::QuietChanged);
    e.on = on;
    return e;
  }
  static Event voice(bool speechStarted, uint32_t silenceMs, bool bufferFull = false) {
    Event e = simple(EventType::Voice);
    e.speechStarted = speechStarted;
    e.silenceMs = silenceMs;
    e.bufferFull = bufferFull;
    return e;
  }
  static Event replyStarted(PetTurnState state, uint32_t chatKey = 0, uint32_t runKey = 0) {
    Event e = simple(EventType::ReplyStarted);
    e.turnState = state;
    e.chatKey = chatKey;
    e.runKey = runKey;
    return e;
  }
  static Event turnFailed(const char* line) {
    Event e = simple(EventType::TurnFailed);
    e.line = line == nullptr ? "" : line;
    return e;
  }
  static Event notesSyncedNothingSent() {
    Event e = simple(EventType::NotesSynced);
    e.nothingSent = true;
    return e;
  }
  static Event noteSaved(AddResult result) {
    Event e = simple(EventType::NoteSaved);
    e.noteResult = result;
    return e;
  }
  static Event noticeArrived(PetNoticeKind kind, uint32_t seq, bool quietNow, bool speak, const NoticePlan& plan,
                             uint32_t chatKey = 0, uint32_t runKey = 0) {
    Event e = simple(EventType::NoticeArrived);
    e.noticeKind = kind;
    e.seq = seq;
    e.quietNow = quietNow;
    e.speak = speak;
    e.plan = plan;
    e.chatKey = chatKey;
    e.runKey = runKey;
    return e;
  }
};

// What to do after an event. There is deliberately no approve, accept or reject
// field here or in Event: the pet cannot decide anything for the owner.
struct Actions {
  bool startRecording = false;
  bool stopRecording = false;
  bool sendTurn = false;
  bool saveNote = false;
  bool startSync = false;
  bool askInbox = false;
  bool stopPlayback = false;
  bool startSetup = false;
  bool forgetAll = false;
  bool restart = false;
  bool shutdown = false;
  bool heartbeat = false;
  const char* playLine = "";
  const char* playLineThen = "";
  uint32_t fetchSay = 0;
  LightMode lightMode = LightMode::Off;
  uint8_t overlays = 0;
};

// Timings, in milliseconds.
constexpr uint32_t kRecordCapMs = static_cast<uint32_t>(PET_RECORD_MAX_SECONDS) * 1000u;
// Silence that ends a recording once the owner has talked, and the wait for the first
// word before a recording that heard nothing is dropped. Both are the protocol's
// PET_SILENCE_END_SECONDS (the same five seconds).
constexpr uint32_t kSilenceEndMs = static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u;
constexpr uint32_t kNoSpeechMs = kSilenceEndMs;
constexpr uint32_t kFlashMs = 3000;                  // a Done or Stopped flash on the resting light
// After a double tap asked the inbox, a notice that comes back within this is played
// even in quiet hours or with "say notices aloud" off, since the owner asked for it.
constexpr uint32_t kAskWindowMs = 10000;
// How long the pet shows the one lime blink that says "I looked, nothing waits" (the
// blink itself is shorter; the lights task draws it from the start of the mode).
constexpr uint32_t kCheckedBlinkMs = 400;
// No answer at all: save the note. The wait starts when the upload does, so it holds
// the longest upload a poor Wi-Fi link may take (PET_TURN_UPLOAD_SECONDS, 45 seconds for
// 966,716 bytes), then PET_TURN_HTTP_TIMEOUT_MS (config.h, 85 seconds) for the
// transcription and the answer, and 20 seconds more; test_pet_app checks they stay in
// that order.
constexpr uint32_t kSendingWatchdogMs = 150000;
constexpr uint32_t kSpeakingWatchdogMs = 120000;     // a reply that never ends
constexpr uint32_t kNoticeWatchdogMs = 60000;        // a notice that never finishes
// Saved notes that never finish. A pass sends every note in turn, each up to the upload
// allowance and the turn's wait (45 + 85 seconds): the flash holds six full-length
// notes or fifty short ones, so 20 minutes is long enough for either; test_pet_app
// checks the six.
constexpr uint32_t kSyncWatchdogMs = 1200000;
constexpr uint32_t kUpdatingWatchdogMs = 300000;     // an update that never finishes
constexpr uint32_t kErrorRestartMs = 10000;          // after a fault the pet restarts
constexpr uint32_t kSyncRetryMs = 60000;             // after a refused sync, try again; each miss doubles the wait
constexpr uint32_t kSyncRetryMaxMs = 30u * 60u * 1000u;  // but never waits longer than this
constexpr uint8_t kSyncRetryMaxDoublings = 5;        // 1, 2, 4, 8, 16 minutes, then 30
constexpr uint32_t kBackOnlineMinOfflineMs = 60000;  // "I'm back online" only after this long
constexpr uint32_t kRepeatedNoticeMs = 2u * 60u * 1000u;      // a notice that repeats the last turn's answer only lights
constexpr uint32_t kApproveLightMs = 30u * 60u * 1000u;       // the nebula blink for a waiting Approve
constexpr uint32_t kTeamWorkingLightMs = 6u * 3600u * 1000u;  // the team-working light, at most

class PetApp {
 public:
  Actions handle(const Event& event, uint32_t nowMs);

  State state() const { return state_; }
  // Rule 4: true exactly in State::Listening.
  bool recording() const { return state_ == State::Listening; }
  LightMode lightMode() const { return lightMode_; }
  // LED 0's hue at full brightness for the current light mode.
  Rgb ledZeroColor() const { return ledZeroBase(lightMode_); }
  uint8_t overlays() const;

  bool paired() const { return paired_; }
  // Whether the setup network is up (or being brought up) for the owner.
  bool setupOpen() const { return setupOpen_; }
  bool online() const { return online_; }
  bool micOn() const { return micOn_; }
  bool charging() const { return charging_; }
  bool lowBattery() const { return lowBattery_; }
  bool quiet() const { return quiet_; }
  bool notesWaiting() const { return notesWaiting_; }
  bool hasPendingNotice() const { return pending_.has; }

 private:
  enum class Halt : uint8_t { None, Shutdown, Restart };

  struct Pending {
    bool has = false;
    PetNoticeKind kind = PET_NOTICE_KIND_MESSAGE;
    uint32_t seq = 0;
    NoticePlan plan;
    bool autoPlay = false;
    uint32_t chatKey = 0;
    uint32_t runKey = 0;
    uint32_t atMs = 0;
    bool asked = false;  // it came back to a double tap: it plays whatever the quiet hours say
  };

  // What the last turn answer said, to recognise a notice that only repeats it.
  struct LastTurn {
    bool has = false;
    PetTurnState state = PET_STATE_ANSWERED;
    uint32_t chatKey = 0;
    uint32_t runKey = 0;
    uint32_t atMs = 0;
  };

  void enter(State next, uint32_t now);
  void settle(Actions& a, uint32_t now, bool playPending = true);
  void beginRecording(uint32_t now);
  void endRecording(Actions& a, bool deliver, uint32_t now);
  void askSetup(Actions& a);
  void checkListening(Actions& a, uint32_t now);
  void markOffline(uint32_t now);
  void onNetworkLost(Actions& a, uint32_t now, bool wifiItself);
  void onTick(Actions& a, uint32_t now);
  void onNotice(const Event& e, Actions& a, uint32_t now);
  void startNotice(Actions& a, uint32_t now);
  void startFlash(LightMode mode, uint32_t now);
  void askWhatIsHappening(Actions& a, uint32_t now);
  bool askOpen(uint32_t now) const;
  void armSyncRetry(uint32_t now);
  bool syncAllowed(uint32_t now) const;
  void expireAttention(uint32_t now);
  void rememberTurn(const Event& e, uint32_t now);
  bool repeatsTurn(PetNoticeKind kind, uint32_t chatKey, uint32_t runKey, uint32_t now) const;
  LightMode computeLight(uint32_t now) const;
  Actions finish(Actions a, uint32_t now);

  State state_ = State::Boot;
  uint32_t sinceMs_ = 0;

  bool paired_ = false;
  // Whether the setup network is up (or being brought up). It opens by itself
  // only on a boot with no pairing; after ten minutes with nobody finishing it
  // closes, and a server that forgot the pet does not open it either: the owner
  // taps or holds the lime light to open it, in the room with the pet.
  bool setupOpen_ = false;
  bool online_ = false;
  bool everOnline_ = false;
  bool micOn_ = true;
  bool charging_ = false;
  bool lowBattery_ = false;
  bool quiet_ = false;
  bool notesWaiting_ = false;
  Halt halt_ = Halt::None;

  // Effects that follow from entering or leaving a state; finish() turns them
  // into flags, so they cannot be forgotten on any path.
  bool startPending_ = false;
  bool stopPending_ = false;
  bool stopPlaybackPending_ = false;

  uint32_t recordStartMs_ = 0;
  // What the last Voice event said about this recording (cleared when one starts).
  bool speechStarted_ = false;
  uint32_t silenceMs_ = 0;
  bool bufferFull_ = false;
  uint32_t offlineSinceMs_ = 0;

  bool syncRetryArmed_ = false;
  uint32_t syncRetryAtMs_ = 0;
  uint8_t syncRetries_ = 0;  // misses in a row, so a refused sync backs off (a note is up to 0.97 MB)

  bool teamWorking_ = false;
  uint32_t teamUntilMs_ = 0;
  bool needsApprove_ = false;
  uint32_t approveUntilMs_ = 0;

  LightMode flashMode_ = LightMode::Off;
  uint32_t flashUntilMs_ = 0;
  bool checked_ = false;  // the "nothing waits" blink is showing
  uint32_t checkedUntilMs_ = 0;
  bool asked_ = false;  // a double tap asked the inbox and its answer may still come
  uint32_t askedUntilMs_ = 0;
  LightMode noticeMode_ = LightMode::Done;
  LightMode afterReplyFlash_ = LightMode::Off;

  Pending pending_;
  LastTurn lastTurn_;
  LightMode lightMode_ = LightMode::Off;
};

}  // namespace pet
