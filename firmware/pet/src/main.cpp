// The OpenStellarFirm desk pet (env nano_esp32).
//
// This file only wires things together. Every decision lives in the pure state
// machine (core/pet_app.h) and the other pure modules in core/; this turns what
// happens on the hardware into events for it and its actions into effects.
//
//   tasks
//     the main loop (Arduino loop(), core 1)  the only owner of PetApp: reads the
//                                             button, the power pins and the
//                                             message queue, applies the actions
//     the audio task (core 1, priority 6)     records (mic.pump) or plays
//                                             (clip player and speaker pump)
//     the lights task (core 1)                draws the light frames at 50 Hz
//     the network task (core 0)               Wi-Fi, setup and pairing, uploads,
//                                             sync, notices read aloud, heartbeat,
//                                             voice pack (net/net_worker.cpp)
//     the inbox task (core 0)                 the long poll for notices
//
//   events in:  button gestures, a 100 ms tick (with what the voice detector heard,
//               while the microphone runs), the power and MIC switch readings, and the
//               messages the workers post (Mailbox -> `inbox` queue)
//   actions out: PetApp::handle() returns Actions; applyActions() carries them out
//
// The rules of docs/desk-pets-plan.md that this file helps keep:
//   3. the pet never approves: there is no event or action for it, and nothing here
//      invents one; a notice is lit and spoken, never decided;
//   4. the microphone runs only between mic.start() and mic.stop(), started by the
//      owner's hold of the lime light (never by itself), with the lime light switched
//      on first (Mic and Lights tie the two together), and never with the MIC switch
//      off. It goes on after they let go. What it hears goes to the voice detector, the
//      main loop turns that into a Voice event, and the state machine ends the
//      recording: five seconds of silence, a tap, 120 seconds, a full memory.

#include <Arduino.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include <cstring>
#include <memory>
#include <string>

#include "audio/mic.h"
#include "audio/speaker.h"
#include "config.h"
#include "core/api_rules.h"
#include "core/audio_dsp.h"
#include "core/battery.h"
#include "core/pet_app.h"
#include "core/setup_access.h"
#include "core/skin_id.h"
#include "core/voice_pack.h"
#include "hw/log.h"
#include "hw/power.h"
#include "hw/skin.h"
#include "net/api.h"
#include "net/net_worker.h"
#include "net/wifi_setup.h"
#include "pins.h"
#include "store/note_store_fs.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif
#include "store/secrets.h"
#include "store/voicepack.h"
#include "ui/button.h"
#include "ui/lights.h"

using namespace pet;

namespace {

// -- The pieces ----------------------------------------------------------------------

Secrets secrets;
NoteStoreFs noteStore;
std::unique_ptr<NoteQueue> noteQueue;  // made after NVS is open: it needs the next note number
Speaker speaker;
Mic mic;
Lights lights;
Button button;
Power power;
VoicePackStore packs;
ClipPlayer player;
Api api;
Shared shared;
PetApp app;
std::unique_ptr<NetWorker> net;

PetKind kind = PET_DEFAULT_KIND;
QueueHandle_t inboxQueue = nullptr;

constexpr UBaseType_t kAudioPriority = 6;
constexpr UBaseType_t kLightsPriority = 3;
constexpr BaseType_t kAudioCore = 1;
constexpr uint32_t kAudioStackBytes = 8 * 1024;
constexpr UBaseType_t kInboxQueueLength = 24;

// -- Messages from the other tasks -----------------------------------------------------

class MainMailbox : public Mailbox {
 public:
  void post(const Msg& message) override {
    if (inboxQueue == nullptr || xQueueSend(inboxQueue, &message, pdMS_TO_TICKS(200)) != pdTRUE) {
      PET_LOG("a message to the main loop was dropped");
    }
  }
};
MainMailbox mailbox;

// The main loop's own events to itself (for an effect that failed and must be
// told to the state machine). Never blocks.
void postToSelf(const Event& event) {
  Msg message;
  message.kind = MsgKind::App;
  message.event = event;
  if (inboxQueue != nullptr) {
    xQueueSend(inboxQueue, &message, 0);
  }
}

void onSpeakerDrained(PlayTag tag, void*) {
  Msg message;
  message.kind = MsgKind::PlayDone;
  message.tag = tag;
  mailbox.post(message);
}

void onMicIndicator(bool on, void*) { lights.setMicLive(on); }

// -- Recordings ------------------------------------------------------------------------
//
// Two slots hold recordings (audio/mic.h). A slot is free when nothing uses it.
// Only the main loop counts the users, so there is no lock: it adds one for each
// upload or save it hands to the network task, and takes it away on SlotDone.

int slotUsers[Mic::kSlots] = {0, 0};
Recording latest;                  // the last finished recording
char latestTurnId[40] = {0};       // its turn id, kept for a retry as a saved note
char latestRecordedAt[24] = {0};   // when it was made, or empty when the clock was not set

int pickFreeSlot() {
  // A slot other than the latest recording's, so that recording survives the next one
  // while it is still being sent or saved. A slot with no buffer (a unit with no
  // PSRAM, or one that got only one of the two) is never picked: starting the
  // microphone on it fails, and every other recording would be thrown away.
  for (int i = 0; i < Mic::kSlots; ++i) {
    if (mic.slotUsable(i) && slotUsers[i] == 0 && i != latest.slot) {
      return i;
    }
  }
  if (latest.slot >= 0 && mic.slotUsable(latest.slot) && slotUsers[latest.slot] == 0) {
    return latest.slot;
  }
  return -1;
}

void copyText(char* dest, size_t cap, const std::string& text) {
  std::strncpy(dest, text.c_str(), cap - 1);
  dest[cap - 1] = '\0';
}

void startRecording() {
  const int slot = pickFreeSlot();
  if (slot == latest.slot) {
    latest = Recording{};  // the data is about to be overwritten
  }
  if (slot >= 0 && mic.start(slot)) {
    return;
  }
  // The microphone would not start: the MIC switch went off a moment ago, no slot
  // is free, or the receiver failed. The state machine believes it is listening;
  // tell it the truth at once rather than let the owner talk to nothing. (Letting go of
  // the light no longer ends a recording, so "the memory is full" is the word for it:
  // the recording is over, it holds nothing, and the pet will say it did not catch it.)
  PET_LOG("the microphone did not start");
  if (!Mic::switchOn()) {
    postToSelf(Event::micSwitch(false));
  } else {
    postToSelf(Event::voice(false, 0, true));
  }
}

void finishRecording() {
  const Recording done = mic.stop();
  latest = done;
  if (done.valid()) {
    // A turn id and a time, made once: a retry (a saved note) sends the same ones.
    copyText(latestTurnId, sizeof(latestTurnId), newTurnId());
    copyText(latestRecordedAt, sizeof(latestRecordedAt), recordedAtNow());
  } else {
    latestTurnId[0] = '\0';
    latestRecordedAt[0] = '\0';
  }
}

// A recording worth sending or keeping: it holds audio, it is not a bump of the button
// (under 0.3 s), and it is not dead air (nothing above the microphone's noise floor:
// OpenStellarFirm could only refuse it, so it is not sent and charged, or kept as a note).
bool latestUsable() {
  return latest.valid() && !recordingTooShort(latest.samples) && !recordingTooQuiet(latest.peak) && latestTurnId[0] != '\0';
}

NetCommand commandForLatest(NetOp op) {
  NetCommand command;
  command.op = op;
  command.slot = latest.slot;
  command.wav = latest.wav;
  command.bytes = latest.bytes;
  command.epoch = speaker.epoch();
  std::strncpy(command.turnId, latestTurnId, sizeof(command.turnId) - 1);
  std::strncpy(command.recordedAt, latestRecordedAt, sizeof(command.recordedAt) - 1);
  return command;
}

// -- Speech ----------------------------------------------------------------------------

// What the pet says, and what the notice it belongs to (if any) is waiting for.
struct NoticeMemo {
  uint32_t seq = 0;
  char fallback[kClipIdChars + 1] = {0};
};
NoticeMemo noticeMemos[8];
size_t noticeMemoNext = 0;

void rememberNotice(const Event& event) {
  NoticeMemo& memo = noticeMemos[noticeMemoNext % (sizeof(noticeMemos) / sizeof(noticeMemos[0]))];
  ++noticeMemoNext;
  memo.seq = event.seq;
  std::strncpy(memo.fallback, event.plan.fallback, sizeof(memo.fallback) - 1);
  memo.fallback[sizeof(memo.fallback) - 1] = '\0';
}

const char* fallbackFor(uint32_t seq) {
  for (const NoticeMemo& memo : noticeMemos) {
    if (memo.seq == seq && memo.seq != 0) {
      return memo.fallback;
    }
  }
  return "";
}

// A stream that is a notice (the state machine is showing one) reports NoticeShown
// when it ends; anything else is just a line.
PlayTag tagForSpeech() { return app.state() == State::Notice ? PlayTag::Notice : PlayTag::Line; }

// How many times the confirm code is said in a row.
constexpr int kConfirmCodeRounds = 3;

void sayLines(const Actions& actions) {
  const PlayTag tag = tagForSpeech();
  if (std::strcmp(actions.playLine, PET_LINE_SETUP_JOIN) == 0) {
    // "Hi! To set me up, plug me into your computer and open OpenStellarFirm, or join my
    // Wi-Fi network on your phone." and then the network's password, one clip a
    // character. The setup network is not open: its password is told only here, by the
    // pet's own voice, to whoever is in the room (core/setup_access.h). The cable
    // needs no password (the person who holds it is in the room). A tap or a hold of
    // the light says it again.
    const char* ids[ClipPlayer::kMaxClips];
    size_t n = 0;
    ids[n++] = PET_LINE_SETUP_JOIN;
    n += spellSetupPassphrase(secrets.setupPassphrase(), ids + n, ClipPlayer::kMaxClips - n);
    player.play(tag, ids, n);
    return;
  }
  if (std::strcmp(actions.playLine, PET_LINE_SETUP_CODE) == 0) {
    // "Here is my confirm code. I will say it three times, slowly." and then the
    // code, one clip a character, three times over, with "Listen, here is the code
    // again." before the second and the third (a code heard once and fast was missed
    // on the first board). The player leaves a long pause after every character. This
    // is the one place a line is followed by text the pack does not know (rule 3).
    const char* ids[ClipPlayer::kMaxClips];
    size_t n = 0;
    const std::string code = net->confirmCode();
    for (int round = 0; round < kConfirmCodeRounds; ++round) {
      if (n >= ClipPlayer::kMaxClips) {
        break;
      }
      ids[n++] = round == 0 ? PET_LINE_SETUP_CODE : PET_LINE_SETUP_CODE_AGAIN;
      n += spellCodeClips(code.c_str(), ids + n, ClipPlayer::kMaxClips - n);
    }
    player.play(tag, ids, n);
    return;
  }
  player.play(tag, actions.playLine, actions.playLineThen);
}

void stopAllPlayback() {
  player.cancel();
  speaker.abort();
}

// -- Effects of the state machine's actions --------------------------------------------

[[noreturn]] void shutDown() {
  PET_LOG("battery cut-off: lights off, amplifier off, deep sleep until USB power");
  // The microphone first: lights.off() puts the lights in direct mode, and the lime
  // light must not be dark while anything is still recording.
  if (mic.recording()) {
    mic.stop();
  }
  lights.off();
  player.cancel();
  speaker.abort();
  digitalWrite(PIN_AMP_SD, LOW);
  WifiLink::drop();
  Power::sleepUntilPlugged();  // holds the amplifier's pin low through the sleep
}

void forgetEverything(bool thenRestart) {
  PET_LOG("forgetting this pet");
  shared.paired.store(false);
  if (thenRestart) {
    // A reset: the wipe must be done before the chip restarts. The network task
    // stops what it is doing when it is asked (a sync, a pairing wait, a download),
    // but an upload in flight cannot be cut short. If it does not finish in time the
    // token, the secret and the Wi-Fi are cleared from here: the pet must come back
    // up unpaired, and the saved notes of this pairing are wiped by setup() then,
    // never sent to the next owner's account.
    if (!net->forgetAll(8000)) {
      PET_LOG("the network task did not finish forgetting in time: clearing the secrets here");
      secrets.clearAll();
    }
  } else {
    // Forgotten by the server: the command is queued ahead of the setup that follows.
    NetCommand command;
    command.op = NetOp::ForgetAll;
    if (!net->submit(command)) {
      secrets.clearAll();  // the queue is full: at least the token goes now
    }
  }
}

void applyActions(const Actions& actions) {
  lights.setMode(actions.lightMode);
  shared.appState.store(static_cast<uint8_t>(app.state()));
  shared.appOnline.store(app.online());

  if (actions.forgetAll) {
    forgetEverything(actions.restart);
  }
  if (actions.stopPlayback) {
    stopAllPlayback();
  }
  if (actions.stopRecording) {
    finishRecording();
  }
  if (actions.startRecording) {
    startRecording();
  }

  if (actions.sendTurn) {
    if (!latestUsable()) {
      // A bump of the button, dead air, or the microphone never ran: nothing to send.
      postToSelf(Event::turnFailed(PET_LINE_DIDNT_CATCH));
    } else {
      ++slotUsers[latest.slot];
      if (!net->submit(commandForLatest(NetOp::SendTurn))) {
        --slotUsers[latest.slot];
        postToSelf(Event::turnFailed(PET_LINE_SAVED));  // the queue is full: keep it as a note
      }
    }
  } else if (actions.saveNote) {
    if (!latestUsable()) {
      // A bump of the button while offline, or dead air: nothing worth keeping.
      // (OpenStellarFirm could only refuse a silent note, and a refused note stays on the
      // pet for good, in one of its 50 places.)
      player.play(PlayTag::Line, PET_LINE_DIDNT_CATCH);
    } else {
      ++slotUsers[latest.slot];
      if (!net->submit(commandForLatest(NetOp::SaveNote))) {
        --slotUsers[latest.slot];
        postToSelf(Event::noteSaved(AddResult::NoSpace));
      }
    }
  }

  if (actions.startSetup) {
    NetCommand command;
    command.op = NetOp::StartSetup;
    net->submit(command);
  }
  if (actions.startSync) {
    NetCommand command;
    command.op = NetOp::StartSync;
    net->submit(command);
  }
  if (actions.askInbox) {
    // A double tap: "what's happening". The inbox task polls now; what comes back is a
    // notice like any other, and the state machine plays it because the owner asked.
    net->askInbox();
  }
  if (actions.heartbeat) {
    NetCommand command;
    command.op = NetOp::Heartbeat;
    net->submit(command);
  }

  if (actions.fetchSay != 0) {
    NetCommand command;
    command.op = NetOp::FetchSay;
    command.seq = actions.fetchSay;
    command.epoch = speaker.epoch();
    std::strncpy(command.fallback, fallbackFor(actions.fetchSay), sizeof(command.fallback) - 1);
    if (!net->submit(command)) {
      // The network task is busy: say the saved line instead.
      player.play(PlayTag::Notice, command.fallback[0] != '\0' ? command.fallback : PET_LINE_MESSAGE);
    }
  } else if (actions.playLine[0] != '\0') {
    sayLines(actions);
  }

  if (actions.shutdown) {
    shutDown();
  }
  if (actions.restart) {
    PET_LOG("restarting");
    delay(300);
    ESP.restart();
  }
}

void dispatch(const Event& event) {
  // Several calls can find out in the same second that the server forgot this pet;
  // it is forgotten once.
  if (event.type == EventType::Forgotten && !shared.paired.load()) {
    return;
  }
  if (event.type == EventType::NoticeArrived) {
    rememberNotice(event);
  }
  applyActions(app.handle(event, millis()));
}

void handleMessage(const Msg& message) {
  switch (message.kind) {
    case MsgKind::App:
      dispatch(message.event);
      break;
    case MsgKind::SlotDone:
      if (message.slot >= 0 && message.slot < Mic::kSlots && slotUsers[message.slot] > 0) {
        --slotUsers[message.slot];
      }
      break;
    case MsgKind::PlayDone:
      if (message.tag == PlayTag::Reply) {
        dispatch(Event::simple(EventType::ReplyEnded));
      } else if (message.tag == PlayTag::Notice) {
        dispatch(Event::simple(EventType::NoticeShown));
      }
      break;
  }
}

// -- The audio task --------------------------------------------------------------------

// Record or play, never both: the speaker must not feed the microphone, and the
// state machine has already stopped playback before it starts a recording.
// Returns true when it did something, so the task can go straight round again.
bool audioStep() {
  bool worked = false;
  if (mic.recording()) {
    // Nothing may be left playing beside an open microphone: an amplifier that was
    // switched on a moment before the owner pressed the button is switched off here.
    speaker.quiet();
    worked = mic.pump();
  } else {
    worked = player.pump();
    worked = speaker.pump() || worked;
    lights.setVoiceLevel(speaker.level());
  }
  return worked;
}

void audioTask(void*) {
  for (;;) {
    if (!audioStep()) {
      vTaskDelay(pdMS_TO_TICKS(2));
    }
  }
}

// -- Inputs the main loop reads ----------------------------------------------------------

void pollButton(uint32_t now) {
  switch (button.poll(now)) {
    case GestureEvent::HoldStart:
      // The owner held the lime light: the pet starts listening (or, if it already is,
      // sends what it has: "press the light again").
      dispatch(Event::simple(EventType::ButtonDown));
      break;
    case GestureEvent::Up:
      // Letting go does not stop the pet; the state machine ignores it.
      dispatch(Event::simple(EventType::ButtonUp));
      break;
    case GestureEvent::Tap:
      // While listening, a tap stops and sends at once; otherwise it plays the waiting
      // notice (it never repeats the last answer).
      dispatch(Event::simple(EventType::Tap));
      break;
    case GestureEvent::DoubleTap:
      // "What's happening": plays what waits, asks the inbox, or blinks once.
      dispatch(Event::simple(EventType::DoubleTap));
      break;
    case GestureEvent::ResetHold:
      dispatch(Event::simple(EventType::ResetHold));
      break;
    case GestureEvent::Down:
    case GestureEvent::None:
      break;
  }
}

// The MIC slide switch, debounced: three readings in a row, 20 ms apart.
bool micSwitchReported = true;
void pollMicSwitch(uint32_t now) {
  static uint32_t lastMs = 0;
  static int agree = 0;
  if (static_cast<uint32_t>(now - lastMs) < 20) {
    return;
  }
  lastMs = now;
  const bool on = power.micSwitchOn();
  if (on == micSwitchReported) {
    agree = 0;
    return;
  }
  if (++agree >= 3) {
    agree = 0;
    micSwitchReported = on;
    dispatch(Event::micSwitch(on));
  }
}

// The battery and the charger, once a second. A reading counts only when three in a
// row agree: the LEDs and the amplifier pull the rail down for a moment.
bool chargingReported = false;
bool lowReported = false;
int lowCount = 0;
int criticalCount = 0;
int okCount = 0;

void pollPower(uint32_t now) {
  static uint32_t lastMs = 0;
  if (static_cast<uint32_t>(now - lastMs) < 1000) {
    return;
  }
  lastMs = now;
  const PowerReading reading = power.read();

  shared.batteryPermille.store(static_cast<uint16_t>(reading.fraction * 1000.0f));
  shared.batteryBand.store(static_cast<uint8_t>(batteryBand(reading.fraction)));
  shared.charging.store(reading.externalPower());

  if (reading.externalPower() != chargingReported) {
    chargingReported = reading.externalPower();
    lowReported = false;
    lowCount = criticalCount = okCount = 0;
    dispatch(Event::charging(chargingReported));
  }
  if (reading.externalPower()) {
    return;  // on USB power the rail is not the battery's
  }
  criticalCount = isCritical(reading.volts) ? criticalCount + 1 : 0;
  lowCount = isLow(reading.volts) ? lowCount + 1 : 0;
  okCount = reading.volts >= PET_LOW_BATTERY_VOLTS + 0.05f ? okCount + 1 : 0;
  if (criticalCount >= 3) {
    dispatch(Event::simple(EventType::BatteryCritical));
  } else if (lowCount >= 3 && !lowReported) {
    lowReported = true;
    dispatch(Event::simple(EventType::BatteryLow));
  } else if (okCount >= 3 && lowReported) {
    lowReported = false;
    dispatch(Event::simple(EventType::BatteryOk));
  }
}

}  // namespace

// -- Boot ------------------------------------------------------------------------------

void setup() {
  // After the battery cut-off the amplifier's pin was held low through deep sleep;
  // a held pad ignores pinMode and digitalWrite, so let go of it first.
  Power::releaseAmplifierHold();

  // The amplifier off before anything else, so it never pops at power-on.
  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);

  // The USB serial carries the setup protocol (net/usb_setup.h) as well as the log. The
  // board is built with ARDUINO_USB_CDC_ON_BOOT=1, so the Arduino core has already called
  // Serial.begin() in app_main by the time setup() runs, and what follows works on the
  // running port. setRxBufferSize swaps its receive queue for one of 1024 bytes (the
  // default is 256), keeping any bytes already waiting, so a whole join line (up to 512
  // bytes) waits for the network task, and Serial.begin() then keeps the queue it finds.
  // Rebooting on request is switched off for good, in the first milliseconds of setup():
  // with it on, the port restarts the chip into the ROM's download mode when the computer
  // opens it at 1200 baud or toggles DTR and RTS in the esptool order, and from there
  // anything that holds a port grant could read the flash or replace the firmware. A page
  // that sets the pet up can open the port, so the pet never offers that. A known limit:
  // the short window between the core's begin and these calls is not covered (a computer
  // would have to open the port at 1200 baud in the first milliseconds after power-on).
  // The image has no DFU interface either (platformio.ini turns the board's in-app DFU
  // off for this environment): with it, any program on the computer could write a new
  // image into the next slot with no button pressed. (The board's own bootloader is still
  // there by hand: double-press RST, or the B1 to GND jumper.)
#ifdef PET_DEVBOARD
  // The development board's laptop sends its microphone over the port (about 57 KB a
  // second of text): a deeper queue, so a busy moment does not drop pieces.
  Serial.setRxBufferSize(16384);
#else
  Serial.setRxBufferSize(1024);
#endif
  Serial.begin(115200);
  Serial.enableReboot(false);

  // The first button sample is the power-on one: a button held now is the reset hold.
  button.begin();
  button.poll(millis());

  // The figure on the pad, read before the Wi-Fi radio starts (hw/skin.h).
  const PetKindOrNone skin = readSkin();
  kind = kindOrDefault(skin);
  shared.skin = skin;
  PET_LOG("%s on the pad", PET_KIND_NAMES[kind]);

  lights.begin(kind);
  power.begin();
#ifdef PET_DEVBOARD
  devboard::begin(PET_KIND_NAMES[kind]);
#endif

  const bool nvsOk = secrets.begin();
  const bool flashOk = mountFlash();
  if (!nvsOk || !flashOk) {
    PET_LOG("storage problem: nvs %d, flash %d", nvsOk ? 1 : 0, flashOk ? 1 : 0);
  }
  // A pairing attempt does not survive a restart (setup starts again from the page),
  // so a device secret left behind is of no use: rule 1, the pet holds only its token.
  secrets.clearDeviceSecret();
  noteStore.begin();
  if (nvsOk && flashOk && !secrets.paired()) {
    // Saved notes belong to a pairing. An unpaired pet that still has some was
    // forgotten while they were waiting (a reset that could not finish, or a power
    // cut in the middle of one): they must never be sent into the next owner's
    // account. (Not when NVS itself failed to open: then "unpaired" is a guess.)
    noteStore.wipe();
  }
  noteQueue.reset(new NoteQueue(noteStore, secrets.nextNoteSeq()));
  noteQueue->load();

  packs.begin();
  const StoredSettings stored = secrets.settings();
  // The pack that is on flash, which is not always the pack of the voice in the
  // settings (a voice just changed, or its pack not published yet): the old valid
  // pack keeps the pet's lines in its voice until the new one is downloaded.
  const std::string onFlash = secrets.packVoice();
  if (!onFlash.empty() && !packs.loadVoice(onFlash.c_str())) {
    secrets.setPackVoice("");  // the pack is missing or damaged: fetch it again
  }

  const bool speakerOk = speaker.begin();
  if (!speakerOk) {
    PET_LOG("the speaker did not start");
  }
  speaker.setVolume(static_cast<float>(stored.volumePercent) / 100.0f);
  speaker.onDrained(&onSpeakerDrained, nullptr);
  const bool micOk = mic.begin();
  if (!micOk) {
    PET_LOG("the microphone buffers could not be made");
  }
#ifdef PET_DEVBOARD
  // A paired pet with no network, made up on the board alone, so a recording can be
  // tried with no server: it lands as a saved note. "forget" wipes it. Neither is ever
  // in the pet image.
  devboard::onCommand("offline-pet", []() {
    secrets.setWifi("devboard-no-such-network", "devboard-offline");
    secrets.setPaired("devboard-offline-not-a-token-xxxxxxxxxxxxxx", "dev_offline");
    ESP.restart();
  });
  devboard::onCommand("where", []() {
    const Mic::Heard heard = mic.heard();
    PET_LOG("devboard: state %s recording %d speech %d silence-ms %lu full %d samples %lu", stateName(app.state()),
            mic.recording() ? 1 : 0, heard.speechStarted ? 1 : 0, static_cast<unsigned long>(heard.silenceMs),
            heard.full ? 1 : 0, static_cast<unsigned long>(mic.samplesSoFar()));
  });
  devboard::onCommand("forget", []() {
    secrets.clearAll();
    ESP.restart();
  });
  devboard::note("nvs", nvsOk ? 1 : 0);
  devboard::note("flash", flashOk ? 1 : 0);
  devboard::note("speaker", speakerOk ? 1 : 0);
  devboard::note("mic", micOk ? 1 : 0);
  devboard::note("bootpack", packs.hasBootPack() ? 1 : 0);
  devboard::note("psram-free-kb", static_cast<int>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
  devboard::note("internal-free-kb", static_cast<int>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024));
#endif
  mic.setIndicator(&onMicIndicator, nullptr);
  player.begin(speaker, packs);

  const bool httpsOk = api.begin(secrets);

  shared.speakNotices.store(stored.speakNotices);
  shared.paired.store(secrets.paired());

  inboxQueue = xQueueCreate(kInboxQueueLength, sizeof(Msg));
  NetWorker::Parts parts{api, secrets, *noteQueue, noteStore, speaker, player, packs, mailbox, shared, kind};
  net.reset(new NetWorker(parts));
  if (inboxQueue == nullptr || !net->start()) {
    PET_LOG("the tasks could not be started");
  }
  xTaskCreatePinnedToCore(audioTask, "audio", kAudioStackBytes, nullptr, kAudioPriority, nullptr, kAudioCore);
  lights.startTask(kLightsPriority, kAudioCore);

  // Tell the state machine where things stand.
  const bool paired = secrets.paired();
  const bool wifiKnown = secrets.hasWifi();
  if ((!paired || !wifiKnown) && !secrets.hasSetupPassphrase()) {
    // The pet is about to open its setup network and to say its passphrase. Made
    // here, with the radio on, because the hardware random numbers are true random
    // only then (core/setup_access.h).
    WifiLink::startRadio();
    secrets.setupPassphrase();
  }
  micSwitchReported = power.micSwitchOn();
  const PowerReading first = power.read();
  chargingReported = first.externalPower();
  dispatch(Event::bootDone(paired, wifiKnown, noteQueue->pending() > 0));
  dispatch(Event::micSwitch(micSwitchReported));
  if (chargingReported) {
    dispatch(Event::charging(true));
  }
  if (!httpsOk) {
    dispatch(Event::simple(EventType::Fault));
  }
  PET_LOG("ready: %s, %s, %u saved notes", paired ? "paired" : "not paired", wifiKnown ? "wifi known" : "no wifi",
          static_cast<unsigned>(noteQueue->pending()));
}

void loop() {
  const uint32_t now = millis();
  // Whatever the serial log or the setup protocol queued leaves as the port takes it.
  serialPump();
  // A second line of defence for rule 4: the microphone runs only while the state
  // machine is listening. If the two ever disagree, the microphone is the one that stops.
  if (mic.recording() && app.state() != State::Listening) {
    PET_LOG("the microphone was running outside Listening: stopped");
    finishRecording();
  }
  pollButton(now);
  pollMicSwitch(now);
  pollPower(now);

  // A tick every 100 ms: the 120 second recording cap, the wait for a first word and
  // the watchdogs need time to pass. While the microphone runs, what the voice detector
  // heard goes first, so the tick finds the state machine up to date.
  static uint32_t lastTickMs = 0;
  if (static_cast<uint32_t>(now - lastTickMs) >= 100) {
    lastTickMs = now;
    if (mic.recording()) {
      const Mic::Heard heard = mic.heard();
      dispatch(Event::voice(heard.speechStarted, heard.silenceMs, heard.full));
    }
    dispatch(Event::simple(EventType::Tick));
  }

  // Messages from the other tasks. Waiting here for up to 5 ms paces the loop.
  Msg message;
  TickType_t wait = pdMS_TO_TICKS(5);
  while (inboxQueue != nullptr && xQueueReceive(inboxQueue, &message, wait) == pdTRUE) {
    handleMessage(message);
    wait = 0;
  }
}
