#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include "audio/speaker.h"
#include "core/backoff.h"
#include "core/heartbeat.h"
#include "core/note_queue.h"
#include "core/pet_app.h"
#include "core/skin_id.h"
#include "core/voice_pack.h"
#include "net/api.h"
#include "net/usb_setup.h"
#include "net/wifi_setup.h"

namespace pet {

class Secrets;
class NoteStoreFs;
class ClipPlayer;
class VoicePackStore;

// What the workers tell the main loop. Only the main loop touches PetApp.
enum class MsgKind : uint8_t {
  App,       // `event` is for the state machine
  SlotDone,  // a worker is finished with a recording slot (`slot`)
  PlayDone,  // a stream finished playing (`tag`)
};

struct Msg {
  MsgKind kind = MsgKind::App;
  Event event;
  int slot = -1;
  PlayTag tag = PlayTag::Line;
};

// Where messages go: the main loop's queue (main.cpp implements this).
class Mailbox {
 public:
  virtual ~Mailbox() = default;
  virtual void post(const Msg& message) = 0;
};

// What the workers read and the main loop keeps up to date.
struct Shared {
  std::atomic<uint8_t> appState{0};  // pet::State
  std::atomic<bool> paired{false};
  std::atomic<bool> online{false};      // the Wi-Fi is joined
  std::atomic<bool> serverDown{false};  // joined, but OpenStellarFirm could not be reached
  // What the state machine believes (PetApp::online()). It marks itself offline on
  // its own (the Sending watchdog, a full command queue), and the network side then
  // has to say that OpenStellarFirm is reachable again, though it never saw it go.
  std::atomic<bool> appOnline{false};
  std::atomic<bool> speakNotices{true};
  std::atomic<bool> quiet{false};
  std::atomic<bool> charging{false};
  std::atomic<uint8_t> batteryBand{0};
  std::atomic<uint16_t> batteryPermille{0};  // 0..1000
  std::atomic<uint8_t> noteCount{0};         // kept by the network worker
  PetKindOrNone skin;                        // set at boot, then only read
};

enum class NetOp : uint8_t {
  StartSetup,  // open the setup network and page, pair
  SendTurn,    // upload a recording as a live turn
  SaveNote,    // keep a recording as a saved note
  StartSync,   // send the saved notes
  FetchSay,    // read a notice aloud
  Heartbeat,   // tell OpenStellarFirm how the pet is, now
  ForgetAll,   // erase the pairing, the Wi-Fi, the notes
};

struct NetCommand {
  NetOp op = NetOp::Heartbeat;
  // SendTurn, SaveNote: the recording, which stays valid until SlotDone.
  int slot = -1;
  const uint8_t* wav = nullptr;
  size_t bytes = 0;
  char turnId[40] = {0};
  char recordedAt[24] = {0};
  // FetchSay: the notice and what to say if it cannot be fetched.
  uint32_t seq = 0;
  char fallback[kClipIdChars + 1] = {0};
  // SendTurn, FetchSay: Speaker::epoch() when the main loop handed the command over.
  // The answer is played only if the owner has not stopped the pet since (the speaker
  // refuses a stream of an older epoch), so a late answer never talks after the pet
  // was told to be quiet.
  uint32_t epoch = 0;
};

// A new version 4 UUID for a turn (X-Pet-Turn), from the hardware random source.
std::string newTurnId();

// The time for X-Pet-Recorded-At, "2026-10-21T14:02:00Z", or empty when the clock has
// not been set yet. The only clock the pet has is the computer's: the Date header of an
// answer sets it (net/api.h), and the pet asks no time server.
std::string recordedAtNow();

// The pet's network side: two tasks on core 0.
//
//   the network task   Wi-Fi, setup and pairing, uploads (live turns and saved
//                      notes), the sync of saved notes, notices read aloud, the
//                      heartbeat and the voice pack download. It takes commands
//                      from the main loop (submit) and runs one at a time.
//   the inbox task     the long poll for notices. It is a task of its own so a
//                      turn is never made to wait behind a 20 second poll.
//
// Everything they learn goes back as messages (Mailbox). They never touch PetApp.
//
// Rules this file keeps (docs/desk-pets-plan.md):
//   1. only the device token is sent (Api adds it);
//   2. pairing is: the owner's setup code, the owner-typed confirm code, a one-time
//      claim; the token is stored only after the claim;
//   3. nothing here approves anything: a notice is shown and spoken, no more;
//   6. a saved note is deleted (NoteQueue::confirm) only when the server answered
//      200 or 208 for its turn id (syncOutcomeFor); a note the server refuses for
//      its content stays, marked as refused (NoteQueue::markRefused), and is not
//      sent again;
//   7. calls go through Api, which is HTTPS only, follows no redirect and holds every
//      connection to the pinned certificate of the one computer the pet was set up with;
//      a pairing try gets its computer only from the cable (SetupSubmission::server).
class NetWorker {
 public:
  struct Parts {
    Api& api;
    Secrets& secrets;
    NoteQueue& queue;
    NoteStoreFs& store;
    Speaker& speaker;
    ClipPlayer& player;
    VoicePackStore& packs;
    Mailbox& mailbox;
    Shared& shared;
    PetKind kind;
  };

  explicit NetWorker(const Parts& parts);

  // Creates the command queue and starts both tasks (core 0).
  bool start();

  // From the main loop. False when the queue is full. A ForgetAll command also
  // tells whatever the network task is doing to stop at its next step, and the
  // commands queued before it are dropped, so the forgetting runs at once.
  bool submit(const NetCommand& command);

  // Forgetting the pet: erases the token, the secret, the Wi-Fi, the settings,
  // every saved note and the voice pack, then returns. Waits for the network task
  // to do it, up to timeoutMs; False on timeout or when the command could not be
  // queued (the caller then clears the secrets itself).
  bool forgetAll(uint32_t timeoutMs);

  // The owner's double tap, "what's happening": wakes the inbox task so it polls now
  // instead of waiting out a backoff. Anything the poll returns arrives as a notice, like
  // any other. Safe from any task; a second call within two seconds is ignored.
  void askInbox();

  // The confirm code of the pairing in progress ("" outside one), for the voice
  // to spell. Safe from any task.
  std::string confirmCode();

 private:
  class ReplyPlayer;

  static void networkEntry(void* self);
  static void inboxEntry(void* self);
  void networkLoop();
  void inboxLoop();

  void post(const Event& event);
  void postSlotDone(int slot);
  void noteReachable();
  // `announce` also tells the state machine (ServerUnreachable); a failed turn or
  // sync already does that through TurnFailed.
  void noteUnreachable(bool announce);

  void handle(const NetCommand& command);
  void superviseWifi();
  void maintain();

  // Where a setup try came from. A try from the cable has the setup network switched
  // off for its length (the pet joins the Wi-Fi as a station only) and gets it back
  // if the try fails.
  enum class TrySource : uint8_t { Page, Usb };

  void runSetup();
  bool openSetupNetwork();
  bool pairWith(const SetupSubmission& submission, TrySource source);
  bool claimToken(const PairOut& pairOut, TrySource source);
  // True when the computer asked to stop the running try and the try came from the cable.
  bool cableStops(TrySource source);
  // The setup page and the USB cable, served while a try waits or the pet idles in setup.
  void pumpSetup();
  UsbSetup::Info usbInfo() const;
  // The cable outside the setup network's ten minutes: answers it, and runs the one
  // try a join asks for (an unpaired pet only).
  void serveUsb();
  static void onSetupStatus(void* self, SetupState state, SetupFailure failure);

  void doTurn(const NetCommand& command);
  void doSave(const NetCommand& command);
  void doSync();
  void doSay(const NetCommand& command);
  void doForget();
  void sendHeartbeat();
  void applySettings(const ServerSettings& settings);
  void tryVoicePack();
  void handleNotice(const Notice& notice, bool quietNow);

  bool inboxMayPoll() const;
  bool idleForFlashWork() const;
  // Saving a note writes up to 0.97 MB of flash (120 seconds of ADPCM), which stalls
  // the chip for a moment at each erase; the microphone must not be recording meanwhile.
  void waitWhileListening() const;
  static float jitter();
  HeartbeatState heartbeatState() const;

  Api& api_;
  Secrets& secrets_;
  NoteQueue& queue_;
  NoteStoreFs& store_;
  Speaker& speaker_;
  ClipPlayer& player_;
  VoicePackStore& packs_;
  Mailbox& mailbox_;
  Shared& shared_;
  PetKind kind_;

  QueueHandle_t commands_ = nullptr;
  TaskHandle_t inboxTask_ = nullptr;
  std::atomic<uint32_t> lastAskMs_{0};
  std::atomic<bool> askedBefore_{false};  // lastAskMs_ is a real time
  SemaphoreHandle_t forgotten_ = nullptr;
  SemaphoreHandle_t confirmMutex_ = nullptr;
  std::string confirmCode_;

  WifiSetup setup_;
  UsbSetup usb_;
  bool setupActive_ = false;
  // A setup try is running, from either source: the cable turns away scans and joins.
  bool trying_ = false;

  // Wi-Fi supervision
  Backoff wifiBackoff_;
  bool wifiWasUp_ = false;
  uint32_t nextJoinAtMs_ = 0;
  uint32_t lastWifiCheckMs_ = 0;
  uint32_t lastWifiNoteMs_ = 0;
  // The probe of a server that stopped answering. Both tasks learn about the server
  // (noteReachable, noteUnreachable), but only the network task touches the backoff
  // and the time: the inbox task leaves a flag, and maintain() acts on it.
  Backoff probeBackoff_;
  uint32_t nextProbeAtMs_ = 0;
  std::atomic<bool> probeArm_{false};    // the server just stopped answering: start the backoff
  std::atomic<bool> probeReset_{false};  // the server answered again: start the backoff over
  // The pet is being forgotten (reset or "forgotten" answer): long steps stop early.
  std::atomic<bool> forgetRequested_{false};
  // Counts the pairings that began or ended (a claim that worked, a forgetting). The
  // inbox task compares it before and after a long poll: an answer that came back
  // across a change belongs to the old pairing, and the cursor is read again.
  std::atomic<uint32_t> pairing_{0};

  // Heartbeat and settings
  HeartbeatPolicy heartbeat_;
  uint32_t lastHeartbeatTryMs_ = 0;
  std::string wantedVoice_;
  std::string packVoice_;  // the voice whose pack is on flash
  uint32_t nextPackTryAtMs_ = 0;
};

}  // namespace pet
