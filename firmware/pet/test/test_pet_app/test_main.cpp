// The pet's state machine. Besides the scripted scenarios there are three
// property tests: a seeded random walk over every event, a sweep of every state
// the walk reaches against every event, and a model of the listening limits.
// They hold rule 4 (the microphone records only after the owner's hold of the lime
// light and never by itself, it goes on after they let go, it ends only on five
// seconds of silence, a tap, the 120 second cap, a full memory or a cut, and LED 0
// is solid lime the whole time), the offline rule (a finished recording offline is
// saved, never sent) and the consistency of the actions.
#include <unity.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <set>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "config.h"
#include "core/pet_app.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

// A pet and a clock the tests move by hand.
struct Sim {
  PetApp app;
  uint32_t now;
  explicit Sim(uint32_t start = 100000) : now(start) {}

  Actions send(const Event& e, uint32_t advanceMs = 10) {
    now += advanceMs;
    return app.handle(e, now);
  }
  Actions send(EventType t, uint32_t advanceMs = 10) { return send(Event::simple(t), advanceMs); }
};

// A paired pet whose Wi-Fi is up: Ready.
Sim readyPet(uint32_t start = 100000) {
  Sim s(start);
  s.send(Event::bootDone(true, true));
  s.send(EventType::WifiUp);
  return s;
}

// A paired pet that has not got online yet: Offline.
Sim offlinePet(uint32_t start = 100000) {
  Sim s(start);
  s.send(Event::bootDone(true, true));
  return s;
}

bool empty(const char* s) { return s == nullptr || s[0] == '\0'; }

bool noEffects(const Actions& a) {
  return !a.startRecording && !a.stopRecording && !a.sendTurn && !a.saveNote && !a.startSync && !a.stopPlayback &&
         !a.startSetup && !a.forgetAll && !a.restart && !a.shutdown && !a.heartbeat && !a.askInbox && empty(a.playLine) &&
         empty(a.playLineThen) && a.fetchSay == 0;
}

bool isPackLine(const char* id) {
  for (int i = 0; i < PET_LINE_COUNT; ++i) {
    if (std::strcmp(id, PET_LINE_IDS[i]) == 0) {
      return true;
    }
  }
  return false;
}

}  // namespace

// -- The pet never approves ----------------------------------------------------

#define DEFINE_HAS_MEMBER(NAME)                                                         \
  template <typename T, typename = void>                                                \
  struct Has_##NAME : std::false_type {};                                               \
  template <typename T>                                                                 \
  struct Has_##NAME<T, std::void_t<decltype(std::declval<T&>().NAME)>> : std::true_type {};

DEFINE_HAS_MEMBER(approve)
DEFINE_HAS_MEMBER(approved)
DEFINE_HAS_MEMBER(reject)
DEFINE_HAS_MEMBER(accept)
DEFINE_HAS_MEMBER(decide)
DEFINE_HAS_MEMBER(confirm)
DEFINE_HAS_MEMBER(playLine)  // a positive control for the detector itself

// Rule 3: the pet has no way to approve. Neither the events it reacts to nor the
// actions it asks for have a field that could carry an Approve, Reject or any
// other decision for the owner; an approval notice only lights the pet and says
// that a step waits. If you add such a field, this test fails on purpose: read
// docs/desk-pets-plan.md, rule 3, first.
static_assert(Has_playLine<Actions>::value, "the member detector works");
static_assert(!Has_approve<Actions>::value && !Has_approve<Event>::value, "the pet never approves");
static_assert(!Has_approved<Actions>::value && !Has_approved<Event>::value, "the pet never approves");
static_assert(!Has_reject<Actions>::value && !Has_reject<Event>::value, "the pet never rejects");
static_assert(!Has_accept<Actions>::value && !Has_accept<Event>::value, "the pet never accepts for the owner");
static_assert(!Has_decide<Actions>::value && !Has_decide<Event>::value, "the pet never decides");
static_assert(!Has_confirm<Actions>::value && !Has_confirm<Event>::value, "the pet never confirms for the owner");

namespace {

const char* const kEventNames[] = {
    "Tick",           "BootDone",       "WifiUp",         "WifiDown",       "ServerUnreachable", "ButtonDown",
    "ButtonUp",       "Tap",            "DoubleTap",      "ResetHold",      "SetupSubmitted",    "PairRequested",
    "PairApproved",   "PairRefused",    "Forgotten",      "TurnStarted",    "ReplyStarted",      "ReplyEnded",
    "TurnFailed",     "NoteSaved",      "NotesSynced",    "NoticeArrived",  "NoticeShown",       "QuietChanged",
    "BatteryLow",     "BatteryOk",      "BatteryCritical", "Charging",      "MicSwitch",         "Fault",
    "UpdateOffered",  "Voice",          "SetupTimedOut"};
constexpr int kEventCount = static_cast<int>(sizeof(kEventNames) / sizeof(kEventNames[0]));
static_assert(kEventCount == static_cast<int>(EventType::SetupTimedOut) + 1, "the name table covers every event");

}  // namespace

void test_no_event_is_an_approve() {
  for (int i = 0; i < kEventCount; ++i) {
    const char* name = kEventNames[i];
    if (std::strstr(name, "Approve") != nullptr) {
      // PairApproved is the owner's confirm code being accepted by OpenStellarFirm,
      // not the pet approving anything.
      TEST_ASSERT_EQUAL_STRING("PairApproved", name);
    }
    TEST_ASSERT_TRUE(std::strstr(name, "Reject") == nullptr);
    TEST_ASSERT_TRUE(std::strstr(name, "Accept") == nullptr);
    TEST_ASSERT_TRUE(std::strstr(name, "Decide") == nullptr);
  }
}

// -- Boot and pairing ------------------------------------------------------------

void test_boot_unpaired_goes_to_setup() {
  Sim s;
  Actions a = s.send(Event::bootDone(false, false));
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_TRUE(a.startSetup);
  TEST_ASSERT_EQUAL_STRING("setup-join", a.playLine);
  TEST_ASSERT_EQUAL_INT(LightMode::Setup, a.lightMode);
  TEST_ASSERT_FALSE(s.app.paired());
  TEST_ASSERT_FALSE(a.startRecording);
}

void test_boot_paired_without_a_known_wifi_also_goes_to_setup() {
  Sim s;
  Actions a = s.send(Event::bootDone(true, false));
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_TRUE(a.startSetup);
}

void test_boot_paired_goes_offline_until_the_wifi_is_up() {
  Sim s;
  Actions a = s.send(Event::bootDone(true, true));
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(LightMode::OfflineSaving, a.lightMode);
  TEST_ASSERT_FALSE(s.app.online());
  a = s.send(EventType::WifiUp);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(s.app.online());
  TEST_ASSERT_TRUE(a.heartbeat);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  // It does not say "I'm back online" for the first connection after power-on.
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
}

void test_the_first_wifi_after_boot_says_nothing_however_long_it_took() {
  Sim s = offlinePet();
  Actions a = s.send(EventType::WifiUp, 300000);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
}

void test_events_before_boot_done_do_nothing_harmful() {
  Sim s;
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_EQUAL_INT(State::Boot, s.app.state());
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(noEffects(a));
  // A second BootDone later is ignored.
  s.send(Event::bootDone(true, true));
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  s.send(Event::bootDone(false, false));
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
}

void test_a_wifi_that_came_up_before_boot_done_is_not_forgotten() {
  Sim s;
  s.send(EventType::WifiUp);
  s.send(Event::bootDone(true, true));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
}

void test_pairing_flow() {
  Sim s;
  s.send(Event::bootDone(false, false));
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  Actions a = s.send(EventType::SetupSubmitted);
  TEST_ASSERT_EQUAL_INT(State::Pairing, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Setup, a.lightMode);
  s.send(EventType::WifiUp);
  TEST_ASSERT_EQUAL_INT(State::Pairing, s.app.state());
  a = s.send(Event::pairRequested(true));
  TEST_ASSERT_EQUAL_STRING("setup-code", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::Pairing, s.app.state());
  a = s.send(EventType::PairApproved);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_STRING("setup-done", a.playLine);
  TEST_ASSERT_TRUE(a.heartbeat);
  TEST_ASSERT_TRUE(s.app.paired());
  TEST_ASSERT_TRUE(s.app.online());
}

void test_pairing_refused_goes_back_to_setup() {
  Sim s;
  s.send(Event::bootDone(false, false));
  s.send(EventType::SetupSubmitted);
  Actions a = s.send(Event::pairRequested(false));
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_EQUAL_STRING("setup-refused", a.playLine);
  TEST_ASSERT_TRUE(a.startSetup);

  s.send(EventType::SetupSubmitted);
  s.send(Event::pairRequested(true));
  a = s.send(EventType::PairRefused);
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_EQUAL_STRING("setup-refused", a.playLine);
  TEST_ASSERT_TRUE(a.startSetup);
  TEST_ASSERT_FALSE(s.app.paired());
}

void test_a_wifi_that_fails_during_pairing_says_so() {
  Sim s;
  s.send(Event::bootDone(false, false));
  s.send(EventType::SetupSubmitted);
  Actions a = s.send(EventType::WifiDown);
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_EQUAL_STRING("setup-wifi-failed", a.playLine);
  TEST_ASSERT_TRUE(a.startSetup);

  s.send(EventType::SetupSubmitted);
  a = s.send(EventType::ServerUnreachable);
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_EQUAL_STRING("busy", a.playLine);
}

void test_pairing_approved_with_the_wifi_gone_is_offline() {
  Sim s;
  s.send(Event::bootDone(false, false));
  s.send(EventType::SetupSubmitted);
  s.send(Event::pairRequested(true));
  Actions a = s.send(EventType::PairApproved);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_EQUAL_STRING("setup-done", a.playLine);
}

void test_the_pet_cannot_talk_while_it_is_being_set_up() {
  Sim s;
  s.send(Event::bootDone(false, false));
  for (int i = 0; i < 2; ++i) {
    Actions a = s.send(EventType::ButtonDown);
    TEST_ASSERT_FALSE(a.startRecording);
    TEST_ASSERT_FALSE(s.app.recording());
    s.send(EventType::SetupSubmitted);
  }
}

void test_forgotten_wipes_the_pet_and_waits_for_the_owner_to_open_setup() {
  Sim s = readyPet();
  Actions a = s.send(EventType::Forgotten);
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_TRUE(a.forgetAll);
  TEST_ASSERT_EQUAL_STRING("disconnected", a.playLine);
  TEST_ASSERT_FALSE(s.app.paired());
  TEST_ASSERT_FALSE(s.app.notesWaiting());
  TEST_ASSERT_FALSE(a.restart);
  // A server that said 401 (the owner pressed Forget, or anyone holding a stale token)
  // does not put the pet on the air for whoever is in radio range.
  TEST_ASSERT_FALSE(a.startSetup);
  TEST_ASSERT_FALSE(s.app.setupOpen());
  // And nothing opens it later by itself.
  for (int i = 0; i < 50; ++i) {
    a = s.send(EventType::Tick, 60000);
    TEST_ASSERT_FALSE(a.startSetup);
  }
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
}

void test_a_tap_opens_the_setup_network_of_a_pet_that_waits_and_says_how_to_join() {
  Sim s = readyPet();
  s.send(EventType::Forgotten);
  Actions a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.startSetup);
  TEST_ASSERT_TRUE(s.app.setupOpen());
  // "setup-join" is followed by the network's passphrase, spelled by main.cpp.
  TEST_ASSERT_EQUAL_STRING("setup-join", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_FALSE(a.startRecording);
  // A second tap says it again and opens nothing twice.
  a = s.send(EventType::Tap);
  TEST_ASSERT_FALSE(a.startSetup);
  TEST_ASSERT_EQUAL_STRING("setup-join", a.playLine);
}

void test_a_hold_of_the_light_opens_setup_too_and_never_records() {
  Sim s = readyPet();
  s.send(EventType::Forgotten);
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startSetup);
  TEST_ASSERT_EQUAL_STRING("setup-join", a.playLine);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_FALSE(s.app.recording());
  a = s.send(EventType::ButtonUp);
  TEST_ASSERT_TRUE(noEffects(a));
}

void test_the_setup_network_closes_when_nobody_finishes_and_a_tap_opens_it_again() {
  Sim s;
  Actions a = s.send(Event::bootDone(false, false));
  TEST_ASSERT_TRUE(a.startSetup);  // the one time it opens by itself: a power-on with no pairing
  TEST_ASSERT_TRUE(s.app.setupOpen());
  a = s.send(EventType::SetupTimedOut);
  TEST_ASSERT_TRUE(noEffects(a));  // it just goes quiet
  TEST_ASSERT_FALSE(s.app.setupOpen());
  TEST_ASSERT_EQUAL_INT(State::SetupWifi, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Setup, s.app.lightMode());
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.startSetup);
  TEST_ASSERT_TRUE(s.app.setupOpen());
  TEST_ASSERT_EQUAL_STRING("setup-join", a.playLine);
}

void test_a_pet_with_no_wifi_saved_opens_setup_when_it_is_powered_on() {
  Sim s;
  Actions a = s.send(Event::bootDone(true, false));
  TEST_ASSERT_TRUE(a.startSetup);
  TEST_ASSERT_EQUAL_STRING("setup-join", a.playLine);
}

void test_a_failed_try_keeps_the_setup_network_open() {
  Sim s;
  s.send(Event::bootDone(false, false));
  s.send(EventType::SetupSubmitted);
  s.send(Event::pairRequested(false));
  TEST_ASSERT_TRUE(s.app.setupOpen());
  s.send(EventType::SetupSubmitted);
  s.send(EventType::WifiDown);
  TEST_ASSERT_TRUE(s.app.setupOpen());
  s.send(EventType::SetupSubmitted);
  s.send(Event::pairRequested(true));
  s.send(EventType::PairRefused);
  TEST_ASSERT_TRUE(s.app.setupOpen());
  // A timeout after that closes it, and a pairing that works closes it for good.
  s.send(EventType::SetupTimedOut);
  TEST_ASSERT_FALSE(s.app.setupOpen());
  s.send(EventType::Tap);
  s.send(EventType::SetupSubmitted);
  s.send(Event::pairRequested(true));
  s.send(EventType::PairApproved);
  TEST_ASSERT_FALSE(s.app.setupOpen());
  TEST_ASSERT_TRUE(s.app.paired());
}

void test_a_pet_that_is_set_up_ignores_a_timeout_and_a_tap_does_not_open_setup() {
  Sim s = readyPet();
  Actions a = s.send(EventType::SetupTimedOut);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  a = s.send(EventType::Tap);
  TEST_ASSERT_FALSE(a.startSetup);
  TEST_ASSERT_FALSE(s.app.setupOpen());
}

void test_a_reset_hold_leaves_no_setup_network_open() {
  Sim s;
  s.send(Event::bootDone(false, false));
  TEST_ASSERT_TRUE(s.app.setupOpen());
  Actions a = s.send(EventType::ResetHold);
  TEST_ASSERT_TRUE(a.forgetAll);
  TEST_ASSERT_FALSE(a.startSetup);
  TEST_ASSERT_FALSE(s.app.setupOpen());
}

void test_forgotten_while_recording_throws_the_audio_away() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  Actions a = s.send(EventType::Forgotten);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_FALSE(s.app.recording());
}

// -- Talking ----------------------------------------------------------------------

void test_hold_to_talk_online() {
  Sim s = readyPet();
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_EQUAL_INT(State::Listening, s.app.state());
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(a.startRecording);
  TEST_ASSERT_TRUE(a.stopPlayback);  // the speaker never feeds the mic
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
  TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);

  // Letting go of the light does not stop the pet: it goes on listening.
  a = s.send(EventType::ButtonUp, 1500);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);

  // A tap is the owner pressing the light again: stop and send at once.
  a = s.send(EventType::Tap, 1500);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_EQUAL_INT(LightMode::Thinking, a.lightMode);

  a = s.send(EventType::TurnStarted);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  a = s.send(Event::replyStarted(PET_STATE_ANSWERED), 800);
  TEST_ASSERT_EQUAL_INT(State::Speaking, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Speaking, a.lightMode);
  a = s.send(EventType::ReplyEnded, 3000);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  TEST_ASSERT_EQUAL_UINT8(0, a.overlays);
}

void test_a_reply_that_says_the_team_is_working_lights_the_team() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_WORKING));
  Actions a = s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::TeamWorking, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayTeamWorking) != 0);
  // A done notice ends it and sparkles.
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 1, false, true, plan));
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Done, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayTeamWorking) == 0);
  a = s.send(EventType::NoticeShown, 2000);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

void test_a_reply_that_needs_the_owners_approve_lights_nebula_and_decides_nothing() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_NEEDS_APPROVE));
  Actions a = s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayNeedsApprove) != 0);
  TEST_ASSERT_FALSE(a.sendTurn);
  // Nothing the buttons do clears it: the Approve is in the app. A double tap asks
  // "what's happening" (the inbox is asked and the pet blinks once), and the nebula
  // comes back after the blink.
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  a = s.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(a.askInbox);
  TEST_ASSERT_EQUAL_INT(LightMode::Checked, a.lightMode);
  a = s.send(EventType::Tick, kCheckedBlinkMs);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayNeedsApprove) != 0);
}

void test_a_refused_reply_flashes_rose_then_rests() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_REFUSED));
  Actions a = s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
  a = s.send(EventType::Tick, kFlashMs - 100);
  TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
  a = s.send(EventType::Tick, 200);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

void test_a_stale_refused_flash_does_not_leak_into_the_next_turn() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_REFUSED));
  s.send(EventType::Tap);  // stops the reply early
  s.send(EventType::Tick, kFlashMs + 100);
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  s.send(EventType::ReplyEnded);  // an answer with no audio
  Actions a = s.send(EventType::Tick);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

// An end of speech that belongs to an old reply (the owner talked over it, and the
// speaker had already been told to drop it) must not end the turn being sent now:
// that turn would lose its answer, and its failure would be ignored.
void test_a_late_end_of_an_old_reply_does_not_end_the_turn_being_sent() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  Actions a = s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  TEST_ASSERT_TRUE(noEffects(a));
  // The turn goes on: a network error still keeps the recording as a note.
  a = s.send(Event::turnFailed(PET_LINE_SAVED));
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
}

void test_a_reply_ends_only_while_it_is_being_spoken() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  TEST_ASSERT_EQUAL_INT(State::Speaking, s.app.state());
  s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // Not in the idle states either.
  Actions a = s.send(EventType::ReplyEnded);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
}

// The turn's own wait for an answer must be shorter than the state machine's: the
// server may take up to the first-answer wait plus the speech, and the pet must not
// give up on a turn the server has.
static_assert(PET_TURN_HTTP_TIMEOUT_MS > PET_FIRST_ANSWER_WAIT_SECONDS * 1000 + 30000,
              "the turn's HTTP timeout covers the transcription, the first-answer wait and the speech");
static_assert(PET_TURN_HTTP_TIMEOUT_MS < kSendingWatchdogMs, "the HTTP timeout ends before the Sending watchdog does");
// A full recording is 966,716 bytes (120 seconds of ADPCM) and the upload cap is 1 MiB.
// The watchdog counts from the start of the upload, so it must hold that upload on a poor
// link (PET_TURN_UPLOAD_SECONDS, about 170 kbit/s), then the HTTP timeout, then a margin;
// and the HTTP timeout must be long enough for the server to transcribe two minutes of
// speech and make the speech.
static_assert(kSendingWatchdogMs >= PET_TURN_UPLOAD_SECONDS * 1000 + PET_TURN_HTTP_TIMEOUT_MS,
              "the Sending watchdog holds a slow 1 MB upload and then the HTTP timeout");
static_assert(kSendingWatchdogMs >= PET_TURN_UPLOAD_SECONDS * 1000 + PET_TURN_HTTP_TIMEOUT_MS + 15000,
              "and leaves a margin after both");
static_assert(PET_TURN_HTTP_TIMEOUT_MS >= (PET_FIRST_ANSWER_WAIT_SECONDS + 60) * 1000,
              "the HTTP timeout leaves a minute or more to transcribe two minutes of speech");
// A saved-note pass sends one note after another, each with the upload allowance and the
// turn's wait. The flash holds six full-length notes beside the biggest voice pack (or
// fifty short ones, which take far less each), and the watchdog must outlast all six.
static_assert(kSyncWatchdogMs >= 6u * (PET_TURN_UPLOAD_SECONDS * 1000u + PET_TURN_HTTP_TIMEOUT_MS),
              "the sync watchdog holds a pass over six full-length notes");

void test_a_failed_turn_plays_its_line_and_flashes() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  Actions a = s.send(Event::turnFailed("paused"));
  TEST_ASSERT_EQUAL_STRING("paused", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
  TEST_ASSERT_FALSE(a.saveNote);

  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  a = s.send(Event::turnFailed(PET_LINE_DIDNT_CATCH));
  TEST_ASSERT_EQUAL_STRING("didnt-catch", a.playLine);

  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  a = s.send(Event::turnFailed(""));
  TEST_ASSERT_EQUAL_STRING("busy", a.playLine);
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  a = s.send(Event::turnFailed(nullptr));
  TEST_ASSERT_EQUAL_STRING("busy", a.playLine);
}

void test_a_turn_failure_outside_a_turn_is_ignored() {
  Sim s = readyPet();
  Actions a = s.send(Event::turnFailed("busy"));
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
}

void test_the_mic_switch_off_means_no_recording() {
  Sim s = readyPet();
  Actions a = s.send(Event::micSwitch(false));
  TEST_ASSERT_EQUAL_INT(LightMode::MicOff, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayMicOff) != 0);
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_EQUAL_STRING("mic-off", a.playLine);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // Switched on again: it records.
  a = s.send(Event::micSwitch(true));
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
}

void test_the_mic_switch_cut_during_a_recording_discards_it() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  Actions a = s.send(Event::micSwitch(false), 700);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_EQUAL_STRING("mic-off", a.playLine);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // Letting go afterwards sends nothing.
  a = s.send(EventType::ButtonUp);
  TEST_ASSERT_TRUE(noEffects(a));
}

void test_the_mic_switch_cut_during_a_recording_leaves_a_waiting_notice_waiting() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 8, false, true, plan));
  Actions a = s.send(Event::micSwitch(false), 700);
  // Only the mic-off line: the notice must not start here and add its suffix.
  TEST_ASSERT_EQUAL_STRING("mic-off", a.playLine);
  TEST_ASSERT_EQUAL_STRING("", a.playLineThen);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
  // A Tap brings the notice back, whole.
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-done", a.playLineThen);

  // The same with a notice that is read aloud through the server.
  Sim t = readyPet();
  t.send(EventType::ButtonDown);
  NoticePlan titled = planNotice(PET_NOTICE_KIND_DONE, "developer", true);
  t.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 9, false, true, titled));
  a = t.send(Event::micSwitch(false), 700);
  TEST_ASSERT_EQUAL_STRING("mic-off", a.playLine);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_TRUE(t.app.hasPendingNotice());
}

void test_mic_off_in_every_idle_state() {
  Sim online = readyPet();
  online.send(Event::micSwitch(false));
  TEST_ASSERT_EQUAL_STRING("mic-off", online.send(EventType::ButtonDown).playLine);
  Sim off = offlinePet();
  off.send(Event::micSwitch(false));
  TEST_ASSERT_EQUAL_STRING("mic-off", off.send(EventType::ButtonDown).playLine);
  Sim low = readyPet();
  low.send(EventType::BatteryLow);
  low.send(Event::micSwitch(false));
  TEST_ASSERT_EQUAL_INT(State::LowBattery, low.app.state());
  TEST_ASSERT_EQUAL_STRING("mic-off", low.send(EventType::ButtonDown).playLine);
}

void test_the_cap_ends_the_recording() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  const uint32_t start = s.now;
  // The owner talks the whole time, so neither silence nor the wait for a first word
  // ends it; only the cap does.
  s.send(Event::voice(true, 0), 100);
  Actions a = s.send(EventType::Tick, kRecordCapMs - 101);
  TEST_ASSERT_EQUAL_UINT32(start + kRecordCapMs - 1, s.now);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(noEffects(a));
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  // The button may still be down; letting go later does not send a second time.
  a = s.send(EventType::ButtonUp, 2000);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
}

void test_the_cap_is_the_protocols_120_seconds() {
  TEST_ASSERT_EQUAL_UINT32(120000, kRecordCapMs);
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(PET_RECORD_MAX_SECONDS) * 1000u, kRecordCapMs);
  TEST_ASSERT_EQUAL_UINT32(5000, kSilenceEndMs);
  TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(PET_SILENCE_END_SECONDS) * 1000u, kSilenceEndMs);
  // The wait for a first word is the same five seconds.
  TEST_ASSERT_EQUAL_UINT32(kSilenceEndMs, kNoSpeechMs);
}

void test_the_cap_works_across_a_clock_wrap() {
  Sim s(0xFFFFFFFFu - 100000);
  s.send(Event::bootDone(true, true));
  s.send(EventType::WifiUp);
  s.send(EventType::ButtonDown);
  s.send(Event::voice(true, 0));
  Actions a = s.send(EventType::Tick, 99990);  // 100 seconds in, now past the wrap
  TEST_ASSERT_TRUE(s.app.recording());
  a = s.send(EventType::Tick, kRecordCapMs - 100001);
  TEST_ASSERT_TRUE(s.app.recording());  // one millisecond short of the cap
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.sendTurn);

  // And the wait for a first word.
  Sim t(0xFFFFFFFFu - 2000);
  t.send(Event::bootDone(true, true));
  t.send(EventType::WifiUp);
  t.send(EventType::ButtonDown);
  a = t.send(EventType::Tick, 4000);  // past the wrap, 4 s in
  TEST_ASSERT_TRUE(t.app.recording());
  a = t.send(EventType::Tick, 1000);
  TEST_ASSERT_FALSE(t.app.recording());
  TEST_ASSERT_EQUAL_STRING("didnt-catch", a.playLine);
}

// -- Rule 4: press to start, stop on silence, a tap or the cap ---------------------

namespace {

// The owner has held the light: the pet listens (online, or offline for a note).
Sim listeningPet(bool online = true) {
  Sim s = online ? readyPet() : offlinePet();
  s.send(EventType::ButtonDown);
  return s;
}

}  // namespace

void test_listening_starts_on_the_hold_and_goes_on_after_the_release() {
  Sim s = readyPet();
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
  TEST_ASSERT_TRUE(s.app.recording());
  // The release, however late, changes nothing: no stop, no send, the light stays lime.
  for (uint32_t gap : {1u, 400u, 3000u}) {
    s.send(Event::voice(true, 0), gap);
    a = s.send(EventType::ButtonUp, gap);
    TEST_ASSERT_TRUE(noEffects(a));
    TEST_ASSERT_TRUE(s.app.recording());
    TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
    TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);
  }
  // And a release with no hold before it (the gestures never send one) starts nothing.
  Sim t = readyPet();
  a = t.send(EventType::ButtonUp);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_FALSE(t.app.recording());
}

void test_a_tap_while_listening_stops_and_sends_at_once() {
  Sim s = listeningPet();
  s.send(Event::voice(true, 0), 800);
  Actions a = s.send(EventType::Tap, 700);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  TEST_ASSERT_FALSE(s.app.recording());

  // Offline it is kept as a note instead, still at once.
  Sim o = listeningPet(false);
  a = o.send(EventType::Tap, 700);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Offline, o.app.state());
}

void test_a_tap_before_any_speech_still_sends_what_was_recorded() {
  // The owner said "send": the pet does not second-guess it. (A recording that is
  // only dead air is dropped by the microphone side, main.cpp, with "didn't catch".)
  Sim s = listeningPet();
  Actions a = s.send(EventType::Tap, 1200);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_TRUE(a.stopRecording);
}

void test_a_second_hold_while_listening_also_sends_at_once() {
  // "Press the light again": a long press is a press too.
  Sim s = listeningPet();
  s.send(Event::voice(true, 0), 800);
  Actions a = s.send(EventType::ButtonDown, 900);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_FALSE(s.app.recording());
  // Its release, and a second hold that comes while it is being sent, start nothing.
  a = s.send(EventType::ButtonUp, 700);
  TEST_ASSERT_TRUE(noEffects(a));
  a = s.send(EventType::ButtonDown, 100);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
}

void test_five_seconds_of_silence_after_speech_ends_the_recording() {
  Sim s = listeningPet();
  Actions a = s.send(Event::voice(true, 0), 2000);
  TEST_ASSERT_TRUE(s.app.recording());
  a = s.send(Event::voice(true, 2000), 2000);
  TEST_ASSERT_TRUE(s.app.recording());
  a = s.send(Event::voice(true, kSilenceEndMs - 20), 10);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(noEffects(a));
  a = s.send(Event::voice(true, kSilenceEndMs), 10);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Thinking, a.lightMode);

  // Offline the same silence keeps it as a note.
  Sim o = listeningPet(false);
  o.send(Event::voice(true, 0), 2000);
  a = o.send(Event::voice(true, 7000), 100);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
}

void test_the_silence_is_the_detectors_word_not_the_pets_clock() {
  // The detector says the owner is still talking (silenceMs stays low), however long
  // the recording has been going: the pet keeps listening, up to the cap.
  Sim s = listeningPet();
  for (uint32_t i = 0; i < (kRecordCapMs - 10000) / 2100; ++i) {
    s.send(Event::voice(true, (i % 7) * 100), 2000);
    s.send(EventType::Tick, 100);
    TEST_ASSERT_TRUE(s.app.recording());
  }
  // The silence that ends it is the detector's number, so a pet that has had no
  // Voice event for a while (nothing new to say) is not ended by its own clock.
  Sim t = listeningPet();
  t.send(Event::voice(true, 0), 100);
  t.send(EventType::Tick, 30000);
  TEST_ASSERT_TRUE(t.app.recording());
  t.send(EventType::Tick, kRecordCapMs / 2);
  TEST_ASSERT_TRUE(t.app.recording());
  Actions a = t.send(EventType::Tick, kRecordCapMs / 2);
  TEST_ASSERT_FALSE(t.app.recording());  // the 120 second cap
  TEST_ASSERT_TRUE(a.sendTurn);
}

void test_no_speech_in_the_first_five_seconds_drops_the_recording() {
  Sim s = listeningPet();
  const uint32_t start = s.now;
  // Nothing louder than the room, however long it has been: the detector says no.
  Actions a = s.send(Event::voice(false, 4000), 4000);
  TEST_ASSERT_TRUE(s.app.recording());
  a = s.send(EventType::Tick, 999);
  TEST_ASSERT_EQUAL_UINT32(start + 4999, s.now);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(noEffects(a));
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  // Thrown away: nothing is sent, saved or charged, and the pet says so.
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_EQUAL_STRING("didnt-catch", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_FALSE(s.app.notesWaiting());

  // The same offline: nothing is kept either.
  Sim o = listeningPet(false);
  a = o.send(EventType::Tick, 5000);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_STRING("didnt-catch", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::Offline, o.app.state());
}

void test_speech_inside_the_first_five_seconds_keeps_the_pet_listening() {
  Sim s = listeningPet();
  s.send(Event::voice(false, 3000), 3000);
  s.send(Event::voice(true, 0), 1900);  // began at 4.9 s
  Actions a = s.send(EventType::Tick, 5000);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(noEffects(a));
  // Once begun, a pause never un-starts it: a stray "no speech" report is ignored.
  a = s.send(Event::voice(false, 3000), 100);
  TEST_ASSERT_TRUE(s.app.recording());
  s.send(EventType::Tick, 20000);
  TEST_ASSERT_TRUE(s.app.recording());
  a = s.send(Event::voice(true, kSilenceEndMs), 10);
  TEST_ASSERT_TRUE(a.sendTurn);
}

void test_a_dropped_recording_is_not_talked_over_by_a_waiting_notice() {
  Sim s = listeningPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, plan));
  Actions a = s.send(EventType::Tick, 5000);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_EQUAL_STRING("didnt-catch", a.playLine);
  TEST_ASSERT_EQUAL_STRING("", a.playLineThen);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // The notice waits for a tap.
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
}

void test_a_full_memory_ends_the_recording_and_sends_what_it_holds() {
  Sim s = listeningPet();
  s.send(Event::voice(true, 0), 1000);
  Actions a = s.send(Event::voice(true, 0, true), 1000);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);

  // A microphone that would not start says the same before any speech: the pet ends
  // the recording at once (main.cpp then finds nothing to send and says "didn't catch").
  Sim t = listeningPet();
  a = t.send(Event::voice(false, 0, true), 20);
  TEST_ASSERT_FALSE(t.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.sendTurn);
}

void test_voice_events_do_nothing_when_the_pet_is_not_listening() {
  Sim s = readyPet();
  const Event reports[] = {Event::voice(true, 0), Event::voice(true, kSilenceEndMs), Event::voice(false, 90000),
                           Event::voice(true, 0, true)};
  for (const Event& e : reports) {
    Actions a = s.send(e, 1000);
    TEST_ASSERT_TRUE(noEffects(a));
    TEST_ASSERT_FALSE(s.app.recording());
    TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  }
  // And a report from the last recording does not leak into the next one.
  s.send(EventType::ButtonDown);
  s.send(Event::voice(true, 0), 100);
  s.send(Event::voice(true, kSilenceEndMs), 100);  // ends it
  TEST_ASSERT_FALSE(s.app.recording());
  s.send(Event::replyStarted(PET_STATE_ANSWERED), 100);
  s.send(EventType::ReplyEnded, 100);
  s.send(EventType::ButtonDown, 100);
  TEST_ASSERT_TRUE(s.app.recording());
  Actions a = s.send(EventType::Tick, 1000);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(noEffects(a));
}

void test_a_cut_microphone_ends_a_long_recording_at_once() {
  Sim s = listeningPet();
  s.send(Event::voice(true, 0), 1000);
  s.send(EventType::Tick, kRecordCapMs / 2);
  TEST_ASSERT_TRUE(s.app.recording());
  Actions a = s.send(Event::micSwitch(false), 100);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_EQUAL_STRING("mic-off", a.playLine);
}

void test_the_lime_light_is_solid_for_the_whole_listening() {
  // From the hold to the last silence, through every event that can come meanwhile,
  // LED 0 is lime and the light mode is Listening; it never depends on a setting.
  Sim s = readyPet();
  s.send(Event::quietChanged(true));  // quiet hours do not dim the microphone's light
  s.send(Event::charging(true));
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
  const uint32_t start = s.now;
  while (static_cast<uint32_t>(s.now - start) < kRecordCapMs - 10000) {
    s.send(Event::voice(true, 0), 1500);
    a = s.send(EventType::Tick, 500);
    TEST_ASSERT_TRUE(s.app.recording());
    TEST_ASSERT_EQUAL_INT(LightMode::Listening, s.app.lightMode());
    TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
    TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);
    TEST_ASSERT_TRUE(s.app.micOn());
  }
  a = s.send(EventType::ButtonUp);  // let go: still listening, still lime
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);
  a = s.send(Event::voice(true, kSilenceEndMs), 10);
  TEST_ASSERT_FALSE(s.app.recording());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(s.app.lightMode() != LightMode::Listening);
}

void test_recording_never_starts_without_a_hold() {
  // Every event but the hold, in every resting state, starts no recording; and the
  // hold starts one only where the pet may listen. (The property tests below walk the
  // same rule through random sequences.)
  for (int variant = 0; variant < 7; ++variant) {
    Sim s = readyPet();
    switch (variant) {
      case 1:
        s = offlinePet();
        break;
      case 2:
        s.send(EventType::BatteryLow);
        break;
      case 3:
        s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 1, false, true, planNotice(PET_NOTICE_KIND_DONE, "developer", true)));
        break;  // Notice
      case 4:
        s.send(EventType::ButtonDown);
        s.send(EventType::Tap);
        s.send(Event::replyStarted(PET_STATE_ANSWERED));
        break;  // Speaking
      case 5:
        s.send(Event::micSwitch(false));
        break;
      case 6:
        s.send(EventType::ButtonDown);
        s.send(EventType::Tap);
        break;  // Sending
    }
    for (int t = 0; t < kEventCount; ++t) {
      if (static_cast<EventType>(t) == EventType::ButtonDown) {
        continue;
      }
      Event e = Event::simple(static_cast<EventType>(t));
      // The events whose fields matter are tried with a few of them.
      for (int bits = 0; bits < 4; ++bits) {
        e.on = (bits & 1) != 0;
        e.speechStarted = (bits & 2) != 0;
        e.silenceMs = (bits & 2) != 0 ? kSilenceEndMs : 0;
        e.bufferFull = bits == 3;
        Sim again = s;
        Actions a = again.send(e, 7000);
        TEST_ASSERT_FALSE_MESSAGE(a.startRecording, kEventNames[t]);
        TEST_ASSERT_FALSE_MESSAGE(again.app.recording(), kEventNames[t]);
      }
    }
  }
  // Quiet or a waiting notice or a long idle never make the pet listen by itself.
  Sim idle = readyPet();
  idle.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 1, false, true, planNotice(PET_NOTICE_KIND_APPROVAL, "legal", false)));
  for (int i = 0; i < 1000; ++i) {
    Actions a = idle.send(EventType::Tick, 60000);
    TEST_ASSERT_FALSE(a.startRecording);
    TEST_ASSERT_FALSE(idle.app.recording());
  }
}

void test_barge_in_while_the_pet_speaks() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
  TEST_ASSERT_TRUE(a.stopPlayback);
  TEST_ASSERT_EQUAL_INT(State::Listening, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
}

void test_tap_stops_a_reply_and_a_tap_in_ready_does_nothing() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  Actions a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.stopPlayback);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // A tap in plain Ready does nothing: the pet does not repeat its last answer.
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
}

void test_the_speaking_watchdog_and_the_sending_watchdog() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  Actions a = s.send(EventType::Tick, kSpeakingWatchdogMs - 1);
  TEST_ASSERT_EQUAL_INT(State::Speaking, s.app.state());
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(a.stopPlayback);

  // An upload that never gets any answer is kept as a note.
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(EventType::TurnStarted);
  a = s.send(EventType::Tick, kSendingWatchdogMs - 1);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  TEST_ASSERT_FALSE(a.saveNote);
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_FALSE(s.app.online());
}

// -- Offline ----------------------------------------------------------------------

void test_offline_a_recording_becomes_a_saved_note() {
  Sim s = offlinePet();
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
  a = s.send(EventType::Tap, 2000);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::OfflineSaving, a.lightMode);

  a = s.send(Event::noteSaved(AddResult::Saved));
  TEST_ASSERT_EQUAL_STRING("saved", a.playLine);
  TEST_ASSERT_TRUE(s.app.notesWaiting());
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
}

void test_offline_with_a_full_memory_says_so() {
  Sim s = offlinePet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  Actions a = s.send(Event::noteSaved(AddResult::Full));
  TEST_ASSERT_EQUAL_STRING("memory-full", a.playLine);
  TEST_ASSERT_FALSE(s.app.notesWaiting());
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  a = s.send(Event::noteSaved(AddResult::NoSpace));
  TEST_ASSERT_EQUAL_STRING("memory-full", a.playLine);
  // The pet still listens after that.
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
}

void test_a_server_that_cannot_be_reached_turns_the_recording_into_a_note() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  Actions a = s.send(EventType::ServerUnreachable);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_FALSE(s.app.online());
  // A second failure report for the same turn saves nothing more.
  a = s.send(Event::turnFailed("saved"));
  TEST_ASSERT_FALSE(a.saveNote);
  a = s.send(EventType::ServerUnreachable);
  TEST_ASSERT_FALSE(a.saveNote);
}

void test_a_network_error_answer_also_saves_the_note() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  Actions a = s.send(Event::turnFailed(PET_LINE_SAVED));
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_TRUE(noEffects(s.send(EventType::Tick)));
}

void test_the_wifi_lost_during_the_upload_saves_the_note() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  Actions a = s.send(EventType::WifiDown);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
}

void test_the_wifi_lost_while_listening_saves_the_note_at_the_end() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  Actions a = s.send(EventType::WifiDown);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_TRUE(noEffects(a));
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
}

void test_the_wifi_coming_back_while_listening_is_used_at_the_end() {
  Sim s = offlinePet();
  s.send(EventType::ButtonDown);
  s.send(EventType::WifiUp);
  TEST_ASSERT_TRUE(s.app.recording());
  Actions a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
}

void test_losing_the_wifi_in_ready_goes_offline() {
  Sim s = readyPet();
  Actions a = s.send(EventType::WifiDown);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::OfflineSaving, a.lightMode);
  TEST_ASSERT_FALSE(a.saveNote);
}

// -- Saved notes and sync -----------------------------------------------------------

namespace {

// A pet that is offline with one saved note.
Sim petWithANote() {
  Sim s = readyPet();
  s.send(EventType::WifiDown);
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::noteSaved(AddResult::Saved));
  return s;
}

}  // namespace

void test_wifi_up_with_notes_waiting_syncs_them() {
  Sim s = petWithANote();
  Actions a = s.send(EventType::WifiUp, 30000);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  TEST_ASSERT_TRUE(a.startSync);
  TEST_ASSERT_TRUE(a.heartbeat);
  TEST_ASSERT_EQUAL_INT(LightMode::Thinking, a.lightMode);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);

  a = s.send(EventType::NotesSynced, 4000);
  TEST_ASSERT_EQUAL_STRING("sent", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_FALSE(s.app.notesWaiting());
}

void test_notes_from_before_a_reboot_are_synced_at_the_first_wifi() {
  Sim s;
  s.send(Event::bootDone(true, true, true));
  TEST_ASSERT_TRUE(s.app.notesWaiting());
  Actions a = s.send(EventType::WifiUp);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  TEST_ASSERT_TRUE(a.startSync);
}

void test_lost_wifi_during_a_sync_keeps_the_notes() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  Actions a = s.send(EventType::WifiDown);
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_TRUE(s.app.notesWaiting());
  TEST_ASSERT_FALSE(a.saveNote);
  a = s.send(EventType::WifiUp);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  TEST_ASSERT_TRUE(a.startSync);
}

void test_a_network_error_during_a_sync_goes_offline() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  Actions a = s.send(Event::turnFailed(PET_LINE_SAVED));
  TEST_ASSERT_EQUAL_INT(State::Offline, s.app.state());
  TEST_ASSERT_TRUE(s.app.notesWaiting());
  TEST_ASSERT_TRUE(noEffects(a));
  a = s.send(EventType::WifiUp);
  TEST_ASSERT_TRUE(a.startSync);
}

void test_a_refused_sync_waits_a_minute_before_trying_again() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  Actions a = s.send(Event::turnFailed("busy"));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(s.app.notesWaiting());
  TEST_ASSERT_FALSE(a.startSync);
  a = s.send(EventType::Tick, kSyncRetryMs - 100);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_FALSE(a.startSync);
  a = s.send(EventType::Tick, 200);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  TEST_ASSERT_TRUE(a.startSync);
}

// A sync OpenStellarFirm refuses (paused, voice quota used up, a limit) has already uploaded a
// whole note by the time the pet hears so: the wait doubles each time.
void test_a_refused_sync_backs_off_each_time() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  uint32_t expected = kSyncRetryMs;
  for (int miss = 0; miss < 8; ++miss) {
    TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
    Actions a = s.send(Event::turnFailed("paused"));
    TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
    TEST_ASSERT_FALSE(a.startSync);
    a = s.send(EventType::Tick, expected - 100);
    TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
    TEST_ASSERT_FALSE(a.startSync);
    a = s.send(EventType::Tick, 200);
    TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
    TEST_ASSERT_TRUE(a.startSync);
    expected = expected * 2 > kSyncRetryMaxMs ? kSyncRetryMaxMs : expected * 2;
  }
  TEST_ASSERT_EQUAL_UINT32(kSyncRetryMaxMs, expected);
}

void test_a_finished_sync_starts_the_backoff_over() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  for (int miss = 0; miss < 3; ++miss) {
    s.send(Event::turnFailed("paused"));
    s.send(EventType::Tick, kSyncRetryMaxMs);
  }
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  s.send(EventType::NotesSynced);
  // A new note, a new refusal: the wait is the first one again.
  s.send(EventType::WifiDown);
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::noteSaved(AddResult::Saved));
  Actions a = s.send(EventType::WifiUp);
  TEST_ASSERT_TRUE(a.startSync);
  s.send(Event::turnFailed("paused"));
  a = s.send(EventType::Tick, kSyncRetryMs - 100);
  TEST_ASSERT_FALSE(a.startSync);
  a = s.send(EventType::Tick, 200);
  TEST_ASSERT_TRUE(a.startSync);
}

// Only notes OpenStellarFirm refused were left, and nothing went out: the pet does not
// claim to have sent anything, and does not hold them as waiting.
void test_a_sync_that_found_only_refused_notes_says_nothing() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  Actions a = s.send(Event::notesSyncedNothingSent());
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_TRUE(a.heartbeat);
  TEST_ASSERT_FALSE(s.app.notesWaiting());
  // And it does not start again by itself.
  a = s.send(EventType::Tick, kSyncRetryMs * 4);
  TEST_ASSERT_FALSE(a.startSync);
}

void test_the_sync_watchdog() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  Actions a = s.send(EventType::Tick, kSyncWatchdogMs - 1);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_FALSE(a.startSync);
}

void test_the_button_while_syncing_says_busy() {
  Sim s = petWithANote();
  s.send(EventType::WifiUp);
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_EQUAL_STRING("busy", a.playLine);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  s.send(Event::micSwitch(false));
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_EQUAL_STRING("mic-off", a.playLine);
}

void test_a_note_saved_just_as_the_wifi_returns_is_synced_not_announced_as_offline() {
  Sim s = readyPet();
  s.send(EventType::WifiDown);
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(EventType::WifiUp);  // back before the save finished
  Actions a = s.send(Event::noteSaved(AddResult::Saved));
  TEST_ASSERT_EQUAL_INT(State::Syncing, s.app.state());
  TEST_ASSERT_TRUE(a.startSync);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
}

void test_back_online_is_said_only_after_a_real_gap() {
  Sim s = readyPet();
  s.send(EventType::WifiDown);
  Actions a = s.send(EventType::WifiUp, kBackOnlineMinOfflineMs - 1);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  s.send(EventType::WifiDown);
  a = s.send(EventType::WifiUp, kBackOnlineMinOfflineMs);
  TEST_ASSERT_EQUAL_STRING("back-online", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // Not in quiet hours.
  s.send(Event::quietChanged(true));
  s.send(EventType::WifiDown);
  a = s.send(EventType::WifiUp, 200000);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
}

// -- Notices ----------------------------------------------------------------------

void test_a_notice_plays_in_ready() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 7, false, true, plan));
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-approval", a.playLineThen);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayNeedsApprove) != 0);
  TEST_ASSERT_FALSE(s.app.hasPendingNotice());
  a = s.send(EventType::NoticeShown, 4000);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // The nebula blink goes on until the owner has dealt with it in the app.
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
}

void test_a_done_notice_with_a_title_is_fetched_spoken() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "marketing", true);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 12, false, true, plan));
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_UINT32(12, a.fetchSay);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_STRING("", a.playLineThen);
  TEST_ASSERT_EQUAL_INT(LightMode::Done, a.lightMode);
}

void test_a_notice_in_quiet_hours_stays_silent_and_dark_until_a_tap() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "legal", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, true, true, plan));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_TRUE(a.stopPlayback == false);
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayQuiet) != 0);
  TEST_ASSERT_TRUE((a.overlays & kOverlayNeedsApprove) != 0);
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
  // Time passes: still silent.
  a = s.send(EventType::Tick, 5000);
  TEST_ASSERT_TRUE(noEffects(a));
  // A tap asks for it.
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-legal", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-approval", a.playLineThen);
  TEST_ASSERT_FALSE(s.app.hasPendingNotice());
  a = s.send(EventType::NoticeShown, 3000);
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);
}

void test_a_notice_with_say_notices_off_waits_for_a_tap_and_lights_up() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, nullptr, false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 4, false, false, plan));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_STRING("needs-approve", a.playLine);
  TEST_ASSERT_EQUAL_STRING("", a.playLineThen);
}

void test_a_held_done_notice_flashes_then_waits() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, nullptr, false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 5, false, false, plan));
  TEST_ASSERT_EQUAL_INT(LightMode::Done, a.lightMode);
  a = s.send(EventType::Tick, kFlashMs + 10);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_STRING("done", a.playLine);
}

void test_a_stopped_notice_shows_rose() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_STOPPED, "developer", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_STOPPED, 6, false, true, plan));
  TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-stopped", a.playLineThen);
  NoticePlan budget = planNotice(PET_NOTICE_KIND_BUDGET, "sales", false);
  s.send(EventType::NoticeShown);
  a = s.send(Event::noticeArrived(PET_NOTICE_KIND_BUDGET, 7, false, true, budget));
  TEST_ASSERT_EQUAL_STRING("budget", a.playLine);
  TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
}

void test_a_settings_notice_is_silent_and_asks_for_a_heartbeat() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_SETTINGS, nullptr, false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_SETTINGS, 9, false, true, plan));
  TEST_ASSERT_TRUE(a.heartbeat);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_FALSE(s.app.hasPendingNotice());
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

// -- No double announcement -----------------------------------------------------------

namespace {

constexpr uint32_t kChatA = 0xA1A1A1A1u;
constexpr uint32_t kChatB = 0xB2B2B2B2u;
constexpr uint32_t kRunR = 0x11111111u;
constexpr uint32_t kRunS = 0x22222222u;

// The owner talks and the answer says `state` for run R in chat A; the reply is spoken.
Sim afterTurn(PetTurnState state, uint32_t chatKey = kChatA, uint32_t runKey = kRunR) {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(state, chatKey, runKey));
  s.send(EventType::ReplyEnded, 2000);
  return s;
}

bool saysNothing(const Actions& a) { return empty(a.playLine) && empty(a.playLineThen) && a.fetchSay == 0 && !a.stopPlayback; }

}  // namespace

void test_an_approval_notice_for_the_run_the_turn_just_announced_only_moves_the_light() {
  Sim s = afterTurn(PET_STATE_NEEDS_APPROVE);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunR), 5000);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(saysNothing(a));
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayNeedsApprove) != 0);
  // Nothing is left to say on a tap either.
  TEST_ASSERT_FALSE(s.app.hasPendingNotice());
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(saysNothing(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
}

void test_an_approval_notice_that_names_only_the_chat_is_matched_by_the_chat() {
  // The server's approval notice carries the chat; the run is not always known.
  Sim s = afterTurn(PET_STATE_NEEDS_APPROVE);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "legal", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, 0), 5000);
  TEST_ASSERT_TRUE(saysNothing(a));
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  // Another chat is other work: it is said.
  Sim t = afterTurn(PET_STATE_NEEDS_APPROVE);
  a = t.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatB, 0), 5000);
  TEST_ASSERT_EQUAL_INT(State::Notice, t.app.state());
  TEST_ASSERT_EQUAL_STRING("role-legal", a.playLine);
  // A notice that names nothing is said too.
  Sim u = afterTurn(PET_STATE_NEEDS_APPROVE);
  a = u.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, 0, 0), 5000);
  TEST_ASSERT_EQUAL_INT(State::Notice, u.app.state());
}

void test_an_approval_notice_for_another_run_is_still_said() {
  Sim s = afterTurn(PET_STATE_NEEDS_APPROVE);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunS), 5000);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-approval", a.playLineThen);
}

void test_the_two_minute_window_ends() {
  Sim s = afterTurn(PET_STATE_NEEDS_APPROVE);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  // Just inside the window: light only.
  Sim inside = s;
  Actions a = inside.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunR), kRepeatedNoticeMs - 3000);
  TEST_ASSERT_TRUE(saysNothing(a));
  // Past it: a new Approve is a new thing to say.
  a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunR), kRepeatedNoticeMs + 100);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
}

void test_a_done_notice_for_a_run_the_turn_already_answered_only_moves_the_light() {
  Sim s = afterTurn(PET_STATE_ANSWERED);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "marketing", true);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, plan, kChatA, kRunR), 3000);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(saysNothing(a));
  TEST_ASSERT_EQUAL_INT(LightMode::Done, a.lightMode);
  TEST_ASSERT_FALSE(s.app.hasPendingNotice());
  // The flash ends like any other.
  a = s.send(EventType::Tick, kFlashMs + 10);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

void test_a_done_notice_is_matched_by_its_run_alone() {
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  // Another run ending in the same chat is said.
  Sim s = afterTurn(PET_STATE_ANSWERED);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, plan, kChatA, kRunS), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  // So is one that names only the chat.
  Sim t = afterTurn(PET_STATE_ANSWERED);
  a = t.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, plan, kChatA, 0), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, t.app.state());
}

void test_only_the_matching_state_and_kind_are_silenced() {
  NoticePlan done = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  NoticePlan approval = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  NoticePlan stopped = planNotice(PET_NOTICE_KIND_STOPPED, "developer", false);
  // A turn that answered "working" is told the end of the job: a done notice for its run is news.
  Sim working = afterTurn(PET_STATE_WORKING);
  Actions a = working.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, done, kChatA, kRunR), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, working.app.state());
  // A turn that answered "needs-approve" is not answered: its done notice is said.
  Sim waiting = afterTurn(PET_STATE_NEEDS_APPROVE);
  a = waiting.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, done, kChatA, kRunR), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, waiting.app.state());
  // A turn that answered "answered" has no Approve waiting: an approval for it is news.
  Sim answered = afterTurn(PET_STATE_ANSWERED);
  a = answered.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 4, false, true, approval, kChatA, kRunR), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, answered.app.state());
  // A stopped notice is never a repeat.
  Sim again = afterTurn(PET_STATE_NEEDS_APPROVE);
  a = again.send(Event::noticeArrived(PET_NOTICE_KIND_STOPPED, 4, false, true, stopped, kChatA, kRunR), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, again.app.state());
  // A refused turn leaves no memory worth matching.
  Sim refused = afterTurn(PET_STATE_REFUSED);
  a = refused.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 4, false, true, approval, kChatA, kRunR), 3000);
  TEST_ASSERT_EQUAL_INT(State::Notice, refused.app.state());
}

void test_a_turn_that_names_nothing_silences_nothing() {
  Sim s = afterTurn(PET_STATE_NEEDS_APPROVE, 0, 0);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunR), 5000);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
}

void test_a_repeat_in_quiet_hours_or_with_notices_off_waits_for_nothing() {
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  Sim quiet = afterTurn(PET_STATE_NEEDS_APPROVE);
  Actions a = quiet.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, true, true, plan, kChatA, kRunR), 5000);
  TEST_ASSERT_FALSE(quiet.app.hasPendingNotice());
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);
  TEST_ASSERT_TRUE(quiet.app.quiet());
  Sim off = afterTurn(PET_STATE_NEEDS_APPROVE);
  a = off.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, false, plan, kChatA, kRunR), 5000);
  TEST_ASSERT_FALSE(off.app.hasPendingNotice());
  a = off.send(EventType::Tap);
  TEST_ASSERT_TRUE(saysNothing(a));
}

void test_a_notice_that_came_in_while_sending_is_dropped_when_the_answer_says_the_same() {
  // The long poll was already out when the owner started to talk, so the approval
  // notice reaches the state machine before the turn's answer does.
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunR));
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
  s.send(Event::replyStarted(PET_STATE_NEEDS_APPROVE, kChatA, kRunR));
  TEST_ASSERT_FALSE(s.app.hasPendingNotice());
  Actions a = s.send(EventType::ReplyEnded, 2000);
  // The answer was spoken; the notice is not said after it.
  TEST_ASSERT_TRUE(saysNothing(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);

  // A notice about other work stays and is said after the answer.
  Sim t = readyPet();
  t.send(EventType::ButtonDown);
  t.send(EventType::Tap);
  NoticePlan done = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  t.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 4, false, true, done, kChatA, kRunS));
  t.send(Event::replyStarted(PET_STATE_NEEDS_APPROVE, kChatA, kRunR));
  TEST_ASSERT_TRUE(t.app.hasPendingNotice());
  a = t.send(EventType::ReplyEnded, 2000);
  TEST_ASSERT_EQUAL_INT(State::Notice, t.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
}

void test_forgetting_the_pet_forgets_the_last_turn() {
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  // A pet that is forgotten and paired again must not stay quiet about a notice
  // that happens to name the same chat and run as the turn it had before.
  Sim s = afterTurn(PET_STATE_NEEDS_APPROVE);
  s.send(EventType::Forgotten);
  s.send(EventType::SetupSubmitted);
  s.send(Event::pairRequested(true));
  s.send(EventType::PairApproved);
  TEST_ASSERT_TRUE(s.app.paired());
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, false, true, plan, kChatA, kRunR), 5000);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);

  // A reset hold ends in a restart; the next boot is a new PetApp, and the hold itself
  // leaves nothing to match.
  Sim t = afterTurn(PET_STATE_NEEDS_APPROVE);
  a = t.send(EventType::ResetHold);
  TEST_ASSERT_TRUE(a.forgetAll);
  TEST_ASSERT_FALSE(t.app.paired());
}

void test_quiet_hours_are_the_servers_word_not_a_clock() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  // The inbox answer says it is quiet: the notice waits for a tap, whatever the time is.
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 1, true, true, plan), 40000000);
  TEST_ASSERT_TRUE(s.app.quiet());
  TEST_ASSERT_TRUE(saysNothing(a));
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);
  // The next answer says it is not: the pet is no longer quiet and the next notice speaks.
  a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 2, false, true, plan));
  TEST_ASSERT_FALSE(s.app.quiet());
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  // A heartbeat that changes it is taken at once.
  s.send(EventType::NoticeShown);
  s.send(Event::quietChanged(true));
  TEST_ASSERT_TRUE(s.app.quiet());
  a = s.send(Event::quietChanged(false));
  TEST_ASSERT_FALSE(s.app.quiet());
  a = s.send(EventType::Tick, kFlashMs + 10);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

void test_a_notice_that_arrives_while_busy_waits_its_turn() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 8, false, true, plan));
  // Recording: nothing plays, the lime light stays solid.
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  a = s.send(EventType::ReplyEnded);
  // After the answer the held notice is said.
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-done", a.playLineThen);
}

void test_an_error_line_is_not_talked_over_by_a_waiting_notice() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 8, false, true, plan));
  s.send(EventType::Tap);
  Actions a = s.send(Event::turnFailed("paused"));
  TEST_ASSERT_EQUAL_STRING("paused", a.playLine);
  TEST_ASSERT_EQUAL_STRING("", a.playLineThen);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // The notice is still waiting for a tap.
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
}

void test_a_notice_does_not_start_a_recording_or_change_the_mic() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "accountant", false);
  Actions a = s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 1, false, true, plan));
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_FALSE(s.app.recording());
}

// -- The gestures when the pet is not listening ---------------------------------------
//
// A tap plays the waiting notice and never repeats the last answer. A double tap asks
// "what's happening": it plays what waits (the owner asked, so quiet hours and "say
// notices aloud" do not hold it back), else asks the inbox at once and, while nothing
// waits, gives one short lime blink and says nothing. The gestures arrive as the
// hardware makes them: the first tap of a double tap is a Tap, then a DoubleTap.

void test_a_tap_plays_the_waiting_notice_and_never_repeats_an_answer() {
  Sim s = readyPet();
  // A turn is answered and heard.
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // A tap with nothing waiting does nothing: no repeat of the answer, no light.
  Actions a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // A notice that waits (quiet hours) is played by the tap, once.
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 9, true, true, plan, 5, 6));
  a = s.send(EventType::Tap);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  TEST_ASSERT_EQUAL_STRING("role-developer", a.playLine);
  s.send(EventType::NoticeShown, 2000);
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(noEffects(a));
}

void test_a_double_tap_plays_what_waits_even_in_quiet_hours_or_with_notices_off() {
  // Quiet hours: the notice waits in the dark.
  Sim q = readyPet();
  NoticePlan legal = planNotice(PET_NOTICE_KIND_APPROVAL, "legal", false);
  q.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, true, true, legal));
  TEST_ASSERT_TRUE(q.app.hasPendingNotice());
  q.send(EventType::Tap);  // the first tap of the pair already plays it
  TEST_ASSERT_EQUAL_INT(State::Notice, q.app.state());
  Actions a = q.send(EventType::DoubleTap, 100);
  TEST_ASSERT_TRUE(noEffects(a));  // and the second does not stop it or ask again
  TEST_ASSERT_EQUAL_INT(State::Notice, q.app.state());

  // The double tap alone (a pet that missed the first tap) plays it too.
  Sim w = readyPet();
  w.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 3, true, true, legal));
  a = w.send(EventType::DoubleTap);
  TEST_ASSERT_EQUAL_INT(State::Notice, w.app.state());
  TEST_ASSERT_EQUAL_STRING("role-legal", a.playLine);
  TEST_ASSERT_EQUAL_STRING("notice-approval", a.playLineThen);
  TEST_ASSERT_FALSE(a.askInbox);  // it has an answer already
  TEST_ASSERT_FALSE(w.app.hasPendingNotice());

  // "Say notices aloud" off: the same.
  Sim n = readyPet();
  n.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 4, false, false, planNotice(PET_NOTICE_KIND_APPROVAL, nullptr, false)));
  a = n.send(EventType::DoubleTap);
  TEST_ASSERT_EQUAL_INT(State::Notice, n.app.state());
  TEST_ASSERT_EQUAL_STRING("needs-approve", a.playLine);
}

void test_a_double_tap_with_nothing_waiting_asks_the_inbox_and_blinks_once() {
  Sim s = readyPet();
  s.send(EventType::Tap);  // the first tap of the pair: nothing waits, nothing happens
  Actions a = s.send(EventType::DoubleTap, 120);
  TEST_ASSERT_TRUE(a.askInbox);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_STRING("", a.playLineThen);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_FALSE(a.stopPlayback);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  // One short lime blink, then the resting light again.
  TEST_ASSERT_EQUAL_INT(LightMode::Checked, a.lightMode);
  a = s.send(EventType::Tick, kCheckedBlinkMs - 20);
  TEST_ASSERT_EQUAL_INT(LightMode::Checked, a.lightMode);
  a = s.send(EventType::Tick, 20);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  TEST_ASSERT_TRUE(noEffects(a));
  // The blink is never LED 0 solid and full: that is the microphone's light.
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::Checked) == kLime);

  // In quiet hours the answer to a touch still shows, then the dark comes back.
  Sim q = readyPet();
  q.send(Event::quietChanged(true));
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, q.app.lightMode());
  a = q.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(a.askInbox);
  TEST_ASSERT_EQUAL_INT(LightMode::Checked, a.lightMode);
  a = q.send(EventType::Tick, kCheckedBlinkMs);
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);

  // A low battery pet answers too, and keeps its own light afterwards.
  Sim l = readyPet();
  l.send(EventType::BatteryLow);
  a = l.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(a.askInbox);
  TEST_ASSERT_EQUAL_INT(LightMode::Checked, a.lightMode);
  a = l.send(EventType::Tick, kCheckedBlinkMs);
  TEST_ASSERT_EQUAL_INT(LightMode::LowBattery, a.lightMode);
}

void test_a_notice_that_comes_back_to_a_double_tap_plays_whatever_the_quiet_hours_say() {
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "marketing", false);
  // In quiet hours, and with "say notices aloud" off: it plays, because the owner asked.
  for (int variant = 0; variant < 2; ++variant) {
    Sim s = readyPet();
    Actions a = s.send(EventType::DoubleTap);
    TEST_ASSERT_TRUE(a.askInbox);
    const bool quiet = variant == 0;
    a = s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 11, quiet, !quiet, plan), 900);
    TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
    TEST_ASSERT_EQUAL_STRING("role-marketing", a.playLine);
    TEST_ASSERT_FALSE(a.askInbox);
  }

  // A second notice in the same answer waits for the first, then plays too.
  Sim two = readyPet();
  two.send(Event::quietChanged(true));
  two.send(EventType::DoubleTap);
  two.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 12, true, true, plan), 500);
  TEST_ASSERT_EQUAL_INT(State::Notice, two.app.state());
  two.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 13, true, true, planNotice(PET_NOTICE_KIND_APPROVAL, "legal", false)), 20);
  Actions a = two.send(EventType::NoticeShown, 2000);
  TEST_ASSERT_EQUAL_INT(State::Notice, two.app.state());
  TEST_ASSERT_EQUAL_STRING("role-legal", a.playLine);
}

void test_the_ask_ends_after_its_window_and_quiet_hours_hold_again() {
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "marketing", false);
  Sim s = readyPet();
  s.send(EventType::DoubleTap);
  // Inside the window a notice plays; after it, one in quiet hours waits for a tap.
  Sim late = s;
  Actions a = late.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 14, true, true, plan), kAskWindowMs + 1);
  TEST_ASSERT_EQUAL_INT(State::Ready, late.app.state());
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_TRUE(late.app.hasPendingNotice());
  Sim inside = s;
  inside.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 14, true, true, plan), kAskWindowMs - 1);
  TEST_ASSERT_EQUAL_INT(State::Notice, inside.app.state());
  // A notice that was never asked for stays under the usual rules.
  Sim never = readyPet();
  never.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 14, true, true, plan));
  TEST_ASSERT_EQUAL_INT(State::Ready, never.app.state());
}

void test_a_double_tap_while_offline_cannot_ask_and_only_blinks() {
  Sim s = offlinePet();
  Actions a = s.send(EventType::DoubleTap);
  TEST_ASSERT_FALSE(a.askInbox);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_UINT32(0, a.fetchSay);
  TEST_ASSERT_EQUAL_INT(LightMode::Checked, a.lightMode);
  a = s.send(EventType::Tick, kCheckedBlinkMs);
  TEST_ASSERT_EQUAL_INT(LightMode::OfflineSaving, a.lightMode);
  // And a notice that shows up later is not an asked one.
  s.send(EventType::WifiUp);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 15, true, true, planNotice(PET_NOTICE_KIND_DONE, nullptr, false)));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(s.app.hasPendingNotice());
}

void test_a_double_tap_when_the_pet_is_busy_does_nothing() {
  // Listening: the recording goes on (only a tap or a second hold ends it).
  Sim l = listeningPet();
  Actions a = l.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_TRUE(l.app.recording());
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);

  // Sending, then speaking: it does not stop the reply.
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  a = s.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Sending, s.app.state());
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  a = s.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Speaking, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Speaking, a.lightMode);

  // Playing a notice: it does not stop it either (a tap does).
  Sim n = readyPet();
  n.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 16, false, true, planNotice(PET_NOTICE_KIND_DONE, "developer", true)));
  TEST_ASSERT_EQUAL_INT(State::Notice, n.app.state());
  a = n.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Notice, n.app.state());

  // Setting up: nothing to ask yet.
  Sim u;
  u.send(Event::bootDone(false, false));
  a = u.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(LightMode::Setup, a.lightMode);

  // A pet that never booted ignores it too.
  Sim b;
  a = b.send(EventType::DoubleTap);
  TEST_ASSERT_TRUE(noEffects(a));
}

void test_a_double_tap_does_not_dismiss_the_lights() {
  // The old double tap cleared the lights that ask for attention. It does not any more:
  // an Approve that waits in the app keeps lighting the pet.
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_NEEDS_APPROVE));
  s.send(EventType::ReplyEnded);
  s.send(EventType::DoubleTap);
  s.send(EventType::Tick, kCheckedBlinkMs);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, s.app.lightMode());
  Sim w = readyPet();
  w.send(EventType::ButtonDown);
  w.send(EventType::Tap);
  w.send(Event::replyStarted(PET_STATE_WORKING));
  w.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(LightMode::TeamWorking, w.app.lightMode());
  w.send(EventType::DoubleTap);
  w.send(EventType::Tick, kCheckedBlinkMs);
  TEST_ASSERT_EQUAL_INT(LightMode::TeamWorking, w.app.lightMode());
}

void test_tap_stops_a_playing_notice_and_barge_in_works() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", true);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 21, false, true, plan));
  Actions a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.stopPlayback);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());

  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 22, false, true, plan));
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
  TEST_ASSERT_TRUE(a.stopPlayback);
}

void test_the_notice_watchdog() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_DONE, "developer", true);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 21, false, true, plan));
  Actions a = s.send(EventType::Tick, kNoticeWatchdogMs - 1);
  TEST_ASSERT_EQUAL_INT(State::Notice, s.app.state());
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_TRUE(a.stopPlayback);
}

void test_the_nebula_blink_does_not_last_forever() {
  Sim s = readyPet();
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, nullptr, false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 4, false, false, plan));
  Actions a = s.send(EventType::Tick, kApproveLightMs - 1);
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, a.lightMode);
  a = s.send(EventType::Tick, 1);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  TEST_ASSERT_EQUAL_UINT8(0, a.overlays);
}

void test_the_team_working_light_does_not_last_forever() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_WORKING));
  s.send(EventType::ReplyEnded);
  // 6 hours in steps (the tick interval is small, but any gap works).
  Actions a = s.send(EventType::Tick, kTeamWorkingLightMs - 100);
  TEST_ASSERT_EQUAL_INT(LightMode::TeamWorking, a.lightMode);
  a = s.send(EventType::Tick, 200);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
}

void test_a_quiet_change_from_the_server_darkens_the_pet() {
  Sim s = readyPet();
  Actions a = s.send(Event::quietChanged(true));
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);
  TEST_ASSERT_TRUE((a.overlays & kOverlayQuiet) != 0);
  a = s.send(Event::quietChanged(false));
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  TEST_ASSERT_EQUAL_UINT8(0, a.overlays);
}

// -- Rule 4 in the light ---------------------------------------------------------

void test_listening_wins_over_every_overlay() {
  Sim s = readyPet();
  // Team working, a waiting Approve, charging, quiet hours and a low battery
  // flag all at once.
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_WORKING));
  s.send(EventType::ReplyEnded);
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, "developer", false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 1, false, false, plan));
  s.send(Event::charging(true));
  s.send(Event::quietChanged(true));
  Actions a = s.send(EventType::Tick);
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, a.lightMode);
  TEST_ASSERT_EQUAL_UINT8(kOverlayTeamWorking | kOverlayNeedsApprove | kOverlayCharging | kOverlayQuiet, a.overlays);

  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(s.app.recording());
  TEST_ASSERT_EQUAL_INT(LightMode::Listening, a.lightMode);
  TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);
  // The overlays are still reported; they just do not win.
  TEST_ASSERT_EQUAL_UINT8(kOverlayTeamWorking | kOverlayNeedsApprove | kOverlayCharging | kOverlayQuiet, a.overlays);
  // And the lights stay Listening through everything that can happen meanwhile.
  const Event during[] = {Event::simple(EventType::Tick),          Event::simple(EventType::WifiDown),
                          Event::simple(EventType::WifiUp),        Event::charging(false),
                          Event::quietChanged(false),              Event::simple(EventType::BatteryLow),
                          Event::simple(EventType::BatteryOk),     Event::simple(EventType::Tap),
                          Event::simple(EventType::DoubleTap),     Event::noticeArrived(PET_NOTICE_KIND_STOPPED, 2, false, true, plan)};
  for (const Event& e : during) {
    a = s.send(e, 5);
    if (s.app.recording()) {
      TEST_ASSERT_EQUAL_INT(LightMode::Listening, s.app.lightMode());
      TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);
    }
  }
}

void test_rest_light_priority() {
  Sim s = readyPet();
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, s.app.lightMode());
  s.send(Event::charging(true));
  TEST_ASSERT_EQUAL_INT(LightMode::ChargingIdle, s.app.lightMode());
  // Team working outranks charging.
  s.send(EventType::ButtonDown);
  s.send(EventType::Tap);
  s.send(Event::replyStarted(PET_STATE_WORKING));
  s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(LightMode::TeamWorking, s.app.lightMode());
  // A switched-off mic outranks both.
  s.send(Event::micSwitch(false));
  TEST_ASSERT_EQUAL_INT(LightMode::MicOff, s.app.lightMode());
  // A low battery outranks the mic (charging clears it, so unplug first).
  s.send(Event::charging(false));
  s.send(EventType::BatteryLow);
  TEST_ASSERT_EQUAL_INT(State::LowBattery, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::LowBattery, s.app.lightMode());
  // A waiting Approve outranks that.
  NoticePlan plan = planNotice(PET_NOTICE_KIND_APPROVAL, nullptr, false);
  s.send(Event::noticeArrived(PET_NOTICE_KIND_APPROVAL, 1, false, false, plan));
  TEST_ASSERT_EQUAL_INT(LightMode::NeedsApprove, s.app.lightMode());
  // Quiet hours outrank everything at rest.
  s.send(Event::quietChanged(true));
  TEST_ASSERT_EQUAL_INT(LightMode::Quiet, s.app.lightMode());
  // Peel them off again. The waiting Approve light runs out by itself.
  s.send(Event::quietChanged(false));
  s.send(EventType::Tick, kApproveLightMs);
  TEST_ASSERT_EQUAL_INT(LightMode::LowBattery, s.app.lightMode());
  s.send(EventType::BatteryOk);
  TEST_ASSERT_EQUAL_INT(LightMode::MicOff, s.app.lightMode());
  s.send(Event::micSwitch(true));
  TEST_ASSERT_EQUAL_INT(LightMode::TeamWorking, s.app.lightMode());
  // A done notice ends the team working (held, so it only flashes), and the flash ends.
  s.send(Event::noticeArrived(PET_NOTICE_KIND_DONE, 2, false, false, planNotice(PET_NOTICE_KIND_DONE, nullptr, false)));
  s.send(EventType::Tick, kFlashMs + 10);
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, s.app.lightMode());
}

// -- Power --------------------------------------------------------------------------

void test_low_battery_asks_for_the_charger_once() {
  Sim s = readyPet();
  Actions a = s.send(EventType::BatteryLow);
  TEST_ASSERT_EQUAL_INT(State::LowBattery, s.app.state());
  TEST_ASSERT_EQUAL_STRING("battery-low", a.playLine);
  TEST_ASSERT_EQUAL_INT(LightMode::LowBattery, a.lightMode);
  TEST_ASSERT_TRUE(a.heartbeat);
  a = s.send(EventType::BatteryLow);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
  TEST_ASSERT_EQUAL_INT(State::LowBattery, s.app.state());
}

void test_a_low_battery_pet_still_listens() {
  Sim s = readyPet();
  s.send(EventType::BatteryLow);
  Actions a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.startRecording);
  a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.sendTurn);
  s.send(Event::replyStarted(PET_STATE_ANSWERED));
  s.send(EventType::ReplyEnded);
  TEST_ASSERT_EQUAL_INT(State::LowBattery, s.app.state());
}

void test_a_low_battery_offline_stays_low_battery_but_saves_notes() {
  Sim s = offlinePet();
  s.send(EventType::BatteryLow);
  TEST_ASSERT_EQUAL_INT(State::LowBattery, s.app.state());
  TEST_ASSERT_FALSE(s.app.online());
  s.send(EventType::ButtonDown);
  Actions a = s.send(EventType::Tap);
  TEST_ASSERT_TRUE(a.saveNote);
  TEST_ASSERT_FALSE(a.sendTurn);
}

void test_plugging_in_clears_low_battery_and_says_charging() {
  Sim s = readyPet();
  s.send(EventType::BatteryLow);
  Actions a = s.send(Event::charging(true));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_FALSE(s.app.lowBattery());
  TEST_ASSERT_EQUAL_STRING("charging", a.playLine);
  TEST_ASSERT_EQUAL_INT(LightMode::ChargingIdle, a.lightMode);
  TEST_ASSERT_TRUE(a.heartbeat);
  // A second "charging" report changes nothing and says nothing.
  a = s.send(Event::charging(true));
  TEST_ASSERT_TRUE(noEffects(a));
  // A low reading while plugged in is ignored.
  a = s.send(EventType::BatteryLow);
  TEST_ASSERT_TRUE(noEffects(a));
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  a = s.send(Event::charging(false));
  TEST_ASSERT_TRUE(a.heartbeat);
  TEST_ASSERT_EQUAL_STRING("", a.playLine);
}

void test_battery_ok_leaves_low_battery() {
  Sim s = readyPet();
  s.send(EventType::BatteryLow);
  Actions a = s.send(EventType::BatteryOk);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Ready, a.lightMode);
  a = s.send(EventType::BatteryOk);
  TEST_ASSERT_TRUE(noEffects(a));
}

void test_critical_battery_shuts_down_and_stays_down() {
  Sim s = readyPet();
  Actions a = s.send(EventType::BatteryCritical);
  TEST_ASSERT_TRUE(a.shutdown);
  TEST_ASSERT_EQUAL_INT(LightMode::Off, a.lightMode);
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_TRUE(a.shutdown);
  TEST_ASSERT_FALSE(a.startRecording);
  TEST_ASSERT_FALSE(s.app.recording());
  a = s.send(Event::charging(true));
  TEST_ASSERT_TRUE(a.shutdown);
}

void test_critical_battery_during_a_recording_stops_it_first() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  Actions a = s.send(EventType::BatteryCritical);
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_TRUE(a.shutdown);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_FALSE(a.saveNote);
  TEST_ASSERT_FALSE(s.app.recording());
}

void test_critical_battery_on_usb_power_is_ignored() {
  Sim s = readyPet();
  s.send(Event::charging(true));
  Actions a = s.send(EventType::BatteryCritical);
  TEST_ASSERT_FALSE(a.shutdown);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());
}

// -- Reset, faults, updates ----------------------------------------------------------

void test_reset_hold_forgets_and_restarts_from_any_state() {
  for (int scenario = 0; scenario < 7; ++scenario) {
    Sim s;
    switch (scenario) {
      case 0:
        break;  // Boot
      case 1:
        s.send(Event::bootDone(false, false));
        break;  // SetupWifi
      case 2:
        s = readyPet();
        break;  // Ready
      case 3:
        s = readyPet();
        s.send(EventType::ButtonDown);
        break;  // Listening
      case 4:
        s = petWithANote();
        s.send(EventType::WifiUp);
        break;  // Syncing
      case 5:
        s = readyPet();
        s.send(EventType::ButtonDown);
        s.send(EventType::Tap);
        break;  // Sending
      case 6:
        s = offlinePet();
        break;  // Offline
    }
    const bool wasRecording = s.app.recording();
    Actions a = s.send(EventType::ResetHold);
    TEST_ASSERT_TRUE_MESSAGE(a.forgetAll, "forgetAll");
    TEST_ASSERT_TRUE_MESSAGE(a.restart, "restart");
    TEST_ASSERT_EQUAL_INT(wasRecording, a.stopRecording);
    TEST_ASSERT_FALSE(a.sendTurn);
    TEST_ASSERT_FALSE(a.saveNote);
    TEST_ASSERT_FALSE(s.app.recording());
    TEST_ASSERT_FALSE(s.app.paired());
    TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
    // Nothing else happens afterwards, whatever arrives.
    a = s.send(EventType::ButtonDown);
    TEST_ASSERT_TRUE(a.restart);
    TEST_ASSERT_FALSE(a.startRecording);
    TEST_ASSERT_FALSE(a.forgetAll);
    a = s.send(Event::bootDone(true, true));
    TEST_ASSERT_TRUE(a.restart);
    TEST_ASSERT_FALSE(s.app.recording());
  }
}

void test_a_fault_stops_everything_then_restarts() {
  Sim s = readyPet();
  s.send(EventType::ButtonDown);
  Actions a = s.send(EventType::Fault);
  TEST_ASSERT_EQUAL_INT(State::Error, s.app.state());
  TEST_ASSERT_TRUE(a.stopRecording);
  TEST_ASSERT_FALSE(a.sendTurn);
  TEST_ASSERT_EQUAL_INT(LightMode::Stopped, a.lightMode);
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_FALSE(a.startRecording);
  a = s.send(EventType::Tick, kErrorRestartMs - 100);
  TEST_ASSERT_FALSE(a.restart);
  a = s.send(EventType::Tick, 200);
  TEST_ASSERT_TRUE(a.restart);
  TEST_ASSERT_FALSE(a.forgetAll);
}

void test_an_update_only_starts_from_ready() {
  Sim s = readyPet();
  Actions a = s.send(EventType::UpdateOffered);
  TEST_ASSERT_EQUAL_INT(State::Updating, s.app.state());
  TEST_ASSERT_EQUAL_INT(LightMode::Thinking, a.lightMode);
  a = s.send(EventType::ButtonDown);
  TEST_ASSERT_FALSE(a.startRecording);
  a = s.send(EventType::Tick, kUpdatingWatchdogMs);
  TEST_ASSERT_EQUAL_INT(State::Ready, s.app.state());

  Sim off = offlinePet();
  off.send(EventType::UpdateOffered);
  TEST_ASSERT_EQUAL_INT(State::Offline, off.app.state());
  Sim low = readyPet();
  low.send(EventType::BatteryLow);
  low.send(EventType::UpdateOffered);
  TEST_ASSERT_EQUAL_INT(State::LowBattery, low.app.state());
  Sim busy = readyPet();
  busy.send(EventType::ButtonDown);
  busy.send(EventType::UpdateOffered);
  TEST_ASSERT_EQUAL_INT(State::Listening, busy.app.state());
}

void test_state_names() {
  TEST_ASSERT_EQUAL_STRING("BOOT", stateName(State::Boot));
  TEST_ASSERT_EQUAL_STRING("SETUP_WIFI", stateName(State::SetupWifi));
  TEST_ASSERT_EQUAL_STRING("LISTENING", stateName(State::Listening));
  TEST_ASSERT_EQUAL_STRING("LOW_BATTERY", stateName(State::LowBattery));
  TEST_ASSERT_EQUAL_STRING("ERROR", stateName(State::Error));
}

// -- Property tests ---------------------------------------------------------------------

namespace {

struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed) : s(seed == 0 ? 1 : seed) {}
  uint32_t next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
  }
  uint32_t below(uint32_t n) { return next() % n; }
  bool coin() { return (next() & 1u) != 0; }
};

const char* const kRoles[] = {nullptr, "developer", "marketing", "legal", "nobody", "mechanical-engineer"};
const char* const kLines[] = {"", "saved", "busy", "paused", "didnt-catch", "disconnected", "out-of-credits", "no-access"};

Event randomEvent(Rng& r) {
  // The button and time dominate; the rest are drawn evenly.
  uint32_t pick = r.below(100);
  EventType type;
  if (pick < 14) {
    type = EventType::ButtonDown;
  } else if (pick < 28) {
    type = EventType::ButtonUp;
  } else if (pick < 40) {
    type = EventType::Tick;
  } else {
    type = static_cast<EventType>(r.below(static_cast<uint32_t>(kEventCount)));
  }
  Event e = Event::simple(type);
  e.paired = r.below(4) != 0;
  e.wifiKnown = r.below(4) != 0;
  e.notesWaiting = r.coin();
  e.ok = r.coin();
  e.on = r.coin();
  e.turnState = static_cast<PetTurnState>(r.below(PET_STATE_COUNT));
  e.line = kLines[r.below(sizeof(kLines) / sizeof(kLines[0]))];
  e.noteResult = static_cast<AddResult>(r.below(3));
  e.noticeKind = static_cast<PetNoticeKind>(r.below(PET_NOTICE_KIND_COUNT));
  e.seq = 1 + r.below(50);
  e.quietNow = r.below(4) == 0;
  e.speak = r.below(4) != 0;
  // What the voice detector might say: speech or not, a silence around the limit.
  static const uint32_t kSilences[] = {0, 100, 2000, 4980, 5000, 5020, 20000};
  e.speechStarted = r.coin();
  e.silenceMs = kSilences[r.below(sizeof(kSilences) / sizeof(kSilences[0]))];
  e.bufferFull = r.below(25) == 0;
  // A few ids, so a notice and a turn answer often name the same work.
  e.chatKey = r.below(3) == 0 ? 0 : 1 + r.below(2);
  e.runKey = r.below(3) == 0 ? 0 : 1 + r.below(2);
  e.plan = planNotice(e.noticeKind, kRoles[r.below(sizeof(kRoles) / sizeof(kRoles[0]))], r.coin());
  // The destructive and rare events are thinned out so the walk reaches deep states.
  if ((type == EventType::ResetHold || type == EventType::BatteryCritical || type == EventType::Fault ||
       type == EventType::Forgotten || type == EventType::UpdateOffered) &&
      r.below(6) != 0) {
    e = Event::simple(EventType::Tick);
  }
  return e;
}

uint32_t randomGap(Rng& r) {
  uint32_t pick = r.below(100);
  if (pick < 70) {
    return 1 + r.below(300);
  }
  if (pick < 92) {
    return 300 + r.below(5000);
  }
  if (pick < 99) {
    return 5000 + r.below(70000);
  }
  return 100000 + r.below(900000);
}

// What a test knows about the recording in progress, kept apart from the state
// machine so the two can be compared: when the hold began and what the voice
// detector last reported.
struct Listen {
  bool active = false;
  uint32_t start = 0;
  bool speech = false;
  uint32_t silence = 0;
  bool full = false;
};

// The limits of a recording at a moment: which of them the recording is at.
struct Limits {
  bool noSpeech = false;  // five seconds and no speech: drop
  bool deliver = false;   // the cap, five seconds of silence after speech, or a full memory: send
};

// Takes an event the pet is about to receive into the model.
void observe(Listen& m, const Event& e) {
  if (m.active && e.type == EventType::Voice) {
    m.speech = m.speech || e.speechStarted;
    m.silence = e.silenceMs;
    m.full = m.full || e.bufferFull;
  }
}

// The limits at `now`, after the event just observed.
Limits limitsAt(const Listen& m, uint32_t now) {
  Limits l;
  if (!m.active) {
    return l;
  }
  const uint32_t listened = static_cast<uint32_t>(now - m.start);
  l.noSpeech = !m.speech && listened >= kNoSpeechMs;
  l.deliver = !l.noSpeech && (listened >= kRecordCapMs || m.full || (m.speech && m.silence >= kSilenceEndMs));
  return l;
}

// After the event: a recording that started begins its model, one that ended ends it.
void settleModel(Listen& m, bool wasRecording, bool isRecording, uint32_t now) {
  if (!wasRecording && isRecording) {
    m = Listen{true, now, false, 0, false};
  } else if (wasRecording && !isRecording) {
    m = Listen{};
  }
}

struct Snapshot {
  State state;
  bool recording;
  bool online;
  bool micOn;
  bool lowBattery;
  bool notesWaiting;
  bool charging;
  bool paired;
  bool setupOpen;
};

Snapshot snap(const PetApp& a) {
  return Snapshot{a.state(), a.recording(), a.online(), a.micOn(), a.lowBattery(), a.notesWaiting(), a.charging(), a.paired(), a.setupOpen()};
}

[[noreturn]] void fail(const char* what, const Snapshot& before, const PetApp& after, const Event& e, const Actions& a) {
  char msg[400];
  std::snprintf(msg, sizeof(msg),
                "%s [event %s, before %s rec=%d online=%d mic=%d, after %s rec=%d online=%d mic=%d, light %s]", what,
                kEventNames[static_cast<int>(e.type)], stateName(before.state), before.recording, before.online,
                before.micOn, stateName(after.state()), after.recording(), after.online(), after.micOn(),
                lightModeName(a.lightMode));
  TEST_FAIL_MESSAGE(msg);
  // TEST_FAIL_MESSAGE does not return, but the compiler cannot tell here.
  std::abort();
}

#define CHECK(cond)                                  \
  do {                                               \
    if (!(cond)) {                                   \
      fail(#cond, before, after, e, a);              \
    }                                                \
  } while (0)

// Every property that must hold after one event, whatever came before.
// `lim` says which limits the recording (if there was one) had reached by the time
// of this event, so any event may find it ended.
void checkStep(const Snapshot& before, const PetApp& after, const Event& e, const Actions& a, bool alreadyHalted,
               const Limits& lim) {
  const bool halted = alreadyHalted || a.shutdown || a.restart;

  // Rule 4: the mic is on exactly in Listening.
  CHECK(after.recording() == (after.state() == State::Listening));
  if (after.recording()) {
    CHECK(after.micOn());
    CHECK(after.lightMode() == LightMode::Listening);
    CHECK(a.lightMode == LightMode::Listening);
    CHECK(after.ledZeroColor() == kLime);
    CHECK(!halted);
  }
  // Recording starts only on a hold of the light (ButtonDown), from a state that may
  // listen, with the mic switch on; it ends with a stopRecording, and not otherwise.
  // It never starts by itself: nothing but that one event begins it.
  CHECK(a.startRecording == (after.recording() && !before.recording));
  if (e.type != EventType::ButtonDown) {
    CHECK(!a.startRecording);
    CHECK(!(after.recording() && !before.recording));
  }
  CHECK(a.stopRecording == (!after.recording() && before.recording));
  if (a.startRecording) {
    CHECK(e.type == EventType::ButtonDown);
    CHECK(before.micOn);
    CHECK(before.state == State::Ready || before.state == State::Offline || before.state == State::LowBattery ||
          before.state == State::Notice || before.state == State::Speaking);
    CHECK(a.stopPlayback);
    CHECK(!alreadyHalted);
  }
  // Letting go of the light does not end it (only a limit that is reached, whatever
  // the event, does); the owner pressing the light again does.
  if (e.type == EventType::ButtonUp && before.recording && !lim.noSpeech && !lim.deliver) {
    CHECK(after.recording());
  }
  if ((e.type == EventType::Tap || e.type == EventType::ButtonDown) && before.recording) {
    CHECK(!after.recording());
  }
  if (e.type == EventType::ButtonDown && !before.micOn) {
    CHECK(!after.recording());
  }
  // A limit that is reached ends it, whichever event finds it: it never runs past
  // the cap, a full memory, five seconds of silence or the wait for a first word.
  const bool destructive = (e.type == EventType::MicSwitch && !e.on) || e.type == EventType::Fault ||
                           e.type == EventType::Forgotten || e.type == EventType::ResetHold ||
                           e.type == EventType::BatteryCritical;
  if (before.recording && (lim.noSpeech || lim.deliver)) {
    CHECK(!after.recording());
  }

  // Offline a finished recording is saved, never sent; and a turn is sent only
  // when a recording just ended.
  CHECK(!(a.sendTurn && a.saveNote));
  if (a.sendTurn) {
    CHECK(before.recording);
    CHECK(after.online());
    CHECK(after.state() == State::Sending);
    CHECK(a.stopRecording);
  }
  if (a.saveNote) {
    CHECK(before.recording || before.state == State::Sending);
    CHECK(!after.online());
    CHECK(!after.recording());
    if (before.recording) {
      CHECK(!before.online || e.type == EventType::WifiDown || e.type == EventType::ServerUnreachable);
    }
  }
  // A recording that ends in a send or a save is the end of a talk, not a cut: the
  // owner's tap or second press, or a limit (five seconds of silence, the cap, a full memory).
  if (before.recording && !after.recording() && (a.sendTurn || a.saveNote)) {
    CHECK(e.type == EventType::Tap || e.type == EventType::ButtonDown || lim.deliver);
  }
  // A recording that is cut short without either is a discard: a mic switch, a fault, a
  // forgetting, a reset or a dying battery, or five seconds with nothing said. That one
  // says "didn't catch" and sends and saves nothing.
  if (before.recording && !after.recording() && !a.sendTurn && !a.saveNote) {
    CHECK(destructive || lim.noSpeech);
    if (lim.noSpeech && !destructive) {
      CHECK(std::strcmp(a.playLine, "didnt-catch") == 0);
    }
  }

  // Sync: started only by startSync, in the Syncing state, with notes and a connection.
  CHECK(a.startSync == (after.state() == State::Syncing && before.state != State::Syncing));
  if (a.startSync) {
    CHECK(after.notesWaiting());
    CHECK(after.online());
    CHECK(after.paired());
  }

  // The resting states match the flags.
  if (!halted) {
    if (after.state() == State::Ready) {
      CHECK(after.online());
      CHECK(!after.lowBattery());
    }
    if (after.state() == State::Offline) {
      CHECK(!after.online());
      CHECK(!after.lowBattery());
    }
    if (after.state() == State::LowBattery) {
      CHECK(after.lowBattery());
    }
  }

  // The lines are real clips, and a notice is either clips or a fetch.
  CHECK(a.playLine != nullptr && a.playLineThen != nullptr);
  if (a.playLine[0] != '\0') {
    CHECK(isPackLine(a.playLine));
  }
  if (a.playLineThen[0] != '\0') {
    CHECK(isPackLine(a.playLineThen));
    CHECK(a.playLine[0] != '\0');
  }
  CHECK(!(a.fetchSay != 0 && a.playLine[0] != '\0'));
  // Fetching a notice spoken only ever starts a notice.
  if (a.fetchSay != 0) {
    CHECK(after.state() == State::Notice);
  }

  // Overlays and the reported light mode agree with the app.
  CHECK(a.lightMode == after.lightMode());
  CHECK(a.overlays == after.overlays());
  CHECK(((a.overlays & kOverlayMicOff) != 0) == !after.micOn());
  CHECK(((a.overlays & kOverlayQuiet) != 0) == after.quiet());
  CHECK(((a.overlays & kOverlayCharging) != 0) == after.charging());

  // The double tap, "what's happening": asking the inbox is the answer of a pet at rest
  // that is online with nothing waiting, and of nothing else; it never touches the
  // microphone, and the blink it gives shows only on a pet at rest.
  if (a.askInbox) {
    CHECK(e.type == EventType::DoubleTap);
    CHECK(before.state == State::Ready || before.state == State::Offline || before.state == State::LowBattery);
    CHECK(after.online());
    CHECK(!after.recording());
    CHECK(a.playLine[0] == '\0' && a.fetchSay == 0 && !a.stopPlayback);
    CHECK(a.lightMode == LightMode::Checked);
  }
  if (a.lightMode == LightMode::Checked) {
    CHECK(!after.recording());
    CHECK(after.state() == State::Ready || after.state() == State::Offline || after.state() == State::LowBattery);
    CHECK(!halted);
  }
  if (e.type == EventType::DoubleTap && before.recording && !lim.noSpeech && !lim.deliver) {
    CHECK(after.recording());
    CHECK(!a.stopRecording && !a.sendTurn && !a.saveNote);
  }
  if (e.type == EventType::DoubleTap && before.state != State::Ready && before.state != State::Offline &&
      before.state != State::LowBattery) {
    CHECK(!a.askInbox && a.fetchSay == 0 && !a.stopPlayback);
  }

  // The setup network. It opens by itself only when the pet is powered on with no
  // pairing; a server that forgot the pet never opens it; and a tap or a hold of the
  // light opens it only on a pet that waits for it (not set up, network shut).
  if (a.startSetup) {
    CHECK(e.type == EventType::BootDone || e.type == EventType::Tap || e.type == EventType::ButtonDown ||
          e.type == EventType::WifiDown || e.type == EventType::ServerUnreachable ||
          e.type == EventType::PairRequested || e.type == EventType::PairRefused);
    CHECK(after.state() == State::SetupWifi);
    CHECK(after.setupOpen());
    if (e.type == EventType::Tap || e.type == EventType::ButtonDown) {
      CHECK(before.state == State::SetupWifi && !before.setupOpen);
    }
  }
  if (e.type == EventType::Forgotten) {
    CHECK(!a.startSetup);
    // (A halted pet only repeats its halt and takes no event.)
    CHECK(alreadyHalted || !after.setupOpen());
  }
  if (e.type == EventType::SetupTimedOut) {
    CHECK(!a.startSetup);
    if (before.state == State::SetupWifi && !alreadyHalted) {
      CHECK(!after.setupOpen());
    }
  }

  // forgetAll comes from exactly two events.
  if (a.forgetAll) {
    CHECK(e.type == EventType::ResetHold || e.type == EventType::Forgotten);
    CHECK(!after.paired());
  }
  // A halted pet only repeats its halt.
  if (alreadyHalted) {
    CHECK(!a.startRecording && !a.sendTurn && !a.saveNote && !a.startSync && !a.forgetAll);
    CHECK(a.playLine[0] == '\0' && a.fetchSay == 0);
  }
  // restart and shutdown are never both asked.
  CHECK(!(a.restart && a.shutdown));
}

}  // namespace

void test_property_random_walk_keeps_the_rules() {
  const uint32_t seeds[] = {1, 2, 3, 0xC0FFEE, 0xDEADBEEF};
  const uint32_t starts[] = {1000, 0xFFFFF000u, 123456789, 0, 0xFFFFFFFFu - 500000};
  for (size_t run = 0; run < sizeof(seeds) / sizeof(seeds[0]); ++run) {
    Rng r(seeds[run]);
    PetApp app;
    uint32_t now = starts[run];
    bool halted = false;
    Listen model;
    // Start from a booted pet half of the time so the walk spends its steps
    // in the interesting states.
    if (run % 2 == 0) {
      app.handle(Event::bootDone(true, true), now);
    }
    for (int step = 0; step < 120000; ++step) {
      Event e = randomEvent(r);
      now += randomGap(r);
      Snapshot before = snap(app);
      observe(model, e);
      const Limits lim = limitsAt(model, now);
      Actions a = app.handle(e, now);
      checkStep(before, app, e, a, halted, lim);
      settleModel(model, before.recording, app.recording(), now);
      if (a.shutdown || a.restart) {
        halted = true;
      }
      if (halted && r.below(500) == 0) {
        // A restarted pet is a new PetApp.
        app = PetApp();
        model = Listen{};
        halted = false;
        if (r.coin()) {
          app.handle(Event::bootDone(true, true), now);
        }
      }
    }
  }
}

void test_property_listening_ends_only_for_its_reasons() {
  // A model of the listening rule, checked against a long random walk of the events
  // that matter to it (the hold, its release, taps, the voice detector's reports,
  // time, the MIC switch and the Wi-Fi). It holds, whatever the order:
  //  * a recording begins only on a hold, and goes on after the release;
  //  * it ends on a tap or a second hold, five seconds of silence after speech, a full
  //    memory, the 120 second cap, a cut MIC switch, or five seconds with nothing said;
  //  * it never runs past 120 seconds, however long the gaps between events are;
  //  * the lime light is solid for all of it.
  for (uint32_t seed = 1; seed <= 6; ++seed) {
    Rng r(seed * 7919);
    Sim s = readyPet(r.next());
    Listen m;
    uint32_t longest = 0;
    for (int step = 0; step < 60000; ++step) {
      const uint32_t pick = r.below(12);
      Event e;
      if (pick < 2) {
        e = Event::simple(EventType::ButtonDown);
      } else if (pick < 4) {
        e = Event::simple(EventType::ButtonUp);
      } else if (pick < 5) {
        e = Event::simple(EventType::Tap);
      } else if (pick < 8) {
        static const uint32_t kSilences[] = {0, 0, 200, 4000, 4980, 5000, 9000};
        e = Event::voice(r.below(3) != 0, kSilences[r.below(7)], r.below(60) == 0);
      } else if (pick < 10) {
        e = Event::simple(EventType::Tick);
      } else if (pick == 10) {
        e = Event::micSwitch(r.below(8) != 0);
      } else {
        e = Event::simple(r.coin() ? EventType::WifiDown : EventType::WifiUp);
      }
      const uint32_t gap = (r.below(50) == 0) ? 20000 + r.below(2 * kRecordCapMs) : 1 + r.below(2500);
      const bool wasRecording = s.app.recording();
      const Snapshot before = snap(s.app);
      const uint32_t at = s.now + gap;
      observe(m, e);
      const Limits lim = limitsAt(m, at);
      const Actions a = s.send(e, gap);
      checkStep(before, s.app, e, a, false, lim);
      settleModel(m, wasRecording, s.app.recording(), at);

      if (s.app.recording()) {
        TEST_ASSERT_TRUE(m.active);
        TEST_ASSERT_TRUE(s.app.micOn());
        TEST_ASSERT_EQUAL_INT(LightMode::Listening, s.app.lightMode());
        TEST_ASSERT_TRUE(s.app.ledZeroColor() == kLime);
        // Never beyond the cap.
        TEST_ASSERT_TRUE(static_cast<uint32_t>(s.now - m.start) < kRecordCapMs);
        longest = std::max<uint32_t>(longest, static_cast<uint32_t>(s.now - m.start));
      }
      if (!wasRecording && s.app.recording()) {
        TEST_ASSERT_EQUAL_INT(EventType::ButtonDown, e.type);
      }
      if (wasRecording && e.type == EventType::Tap) {
        TEST_ASSERT_FALSE(s.app.recording());
      }
    }
    // The walk really listened for a long time at some point.
    TEST_ASSERT_TRUE(longest > 30000);
  }
}

void test_property_every_reachable_state_against_every_event() {
  // Collect pets in many different conditions with random walks, then apply
  // every event (with parameter variants) to each and check the same properties.
  struct Entry {
    PetApp app;
    uint32_t now;
    Listen listen;  // what the test knows of its recording, if it is recording
  };
  std::vector<Entry> corpus;
  std::set<std::vector<int>> seen;
  Rng r(424242);
  corpus.push_back(Entry{PetApp(), 5000, Listen{}});  // a pet that has not booted yet
  for (int run = 0; run < 40; ++run) {
    PetApp app;
    uint32_t now = r.next();
    Listen listen;
    app.handle(Event::bootDone(r.below(5) != 0, r.below(5) != 0), now);
    for (int step = 0; step < 4000; ++step) {
      Event e = randomEvent(r);
      now += randomGap(r);
      const bool wasRecording = app.recording();
      observe(listen, e);
      Actions a = app.handle(e, now);
      settleModel(listen, wasRecording, app.recording(), now);
      if (a.shutdown || a.restart) {
        app = PetApp();
        listen = Listen{};
        app.handle(Event::bootDone(true, true), now);
      }
      std::vector<int> sig = {static_cast<int>(app.state()),
                              app.online(),
                              app.micOn(),
                              app.lowBattery(),
                              app.notesWaiting(),
                              app.charging(),
                              app.quiet(),
                              app.hasPendingNotice(),
                              app.paired(),
                              static_cast<int>(app.overlays()),
                              static_cast<int>(app.lightMode())};
      if (seen.insert(sig).second) {
        corpus.push_back(Entry{app, now, listen});
      }
    }
  }
  // Every state was reached.
  std::set<int> states;
  for (const Entry& en : corpus) {
    states.insert(static_cast<int>(en.app.state()));
  }
  TEST_ASSERT_EQUAL_INT(13, states.size());
  TEST_ASSERT_TRUE(corpus.size() > 100);

  std::vector<Event> events;
  for (int t = 0; t < kEventCount; ++t) {
    EventType type = static_cast<EventType>(t);
    switch (type) {
      case EventType::BootDone:
        for (int bits = 0; bits < 8; ++bits) {
          events.push_back(Event::bootDone((bits & 1) != 0, (bits & 2) != 0, (bits & 4) != 0));
        }
        break;
      case EventType::PairRequested:
        events.push_back(Event::pairRequested(true));
        events.push_back(Event::pairRequested(false));
        break;
      case EventType::MicSwitch:
        events.push_back(Event::micSwitch(true));
        events.push_back(Event::micSwitch(false));
        break;
      case EventType::Charging:
        events.push_back(Event::charging(true));
        events.push_back(Event::charging(false));
        break;
      case EventType::QuietChanged:
        events.push_back(Event::quietChanged(true));
        events.push_back(Event::quietChanged(false));
        break;
      case EventType::Voice:
        events.push_back(Event::voice(false, 0));
        events.push_back(Event::voice(true, 0));
        events.push_back(Event::voice(true, kSilenceEndMs - 20));
        events.push_back(Event::voice(true, kSilenceEndMs));
        events.push_back(Event::voice(false, 9000));
        events.push_back(Event::voice(true, 20000));
        events.push_back(Event::voice(false, 0, true));
        events.push_back(Event::voice(true, 0, true));
        break;
      case EventType::ReplyStarted:
        for (int st = 0; st < PET_STATE_COUNT; ++st) {
          events.push_back(Event::replyStarted(static_cast<PetTurnState>(st)));
          events.push_back(Event::replyStarted(static_cast<PetTurnState>(st), 1, 1));
        }
        break;
      case EventType::TurnFailed:
        for (const char* line : kLines) {
          events.push_back(Event::turnFailed(line));
        }
        break;
      case EventType::NoteSaved:
        for (int res = 0; res < 3; ++res) {
          events.push_back(Event::noteSaved(static_cast<AddResult>(res)));
        }
        break;
      case EventType::NoticeArrived:
        for (int kind = 0; kind < PET_NOTICE_KIND_COUNT; ++kind) {
          for (int bits = 0; bits < 4; ++bits) {
            for (const char* role : {static_cast<const char*>(nullptr), "developer"}) {
              for (int title = 0; title < 2; ++title) {
                PetNoticeKind k = static_cast<PetNoticeKind>(kind);
                events.push_back(Event::noticeArrived(k, 5, (bits & 1) != 0, (bits & 2) != 0, planNotice(k, role, title == 1)));
                events.push_back(Event::noticeArrived(k, 5, (bits & 1) != 0, (bits & 2) != 0, planNotice(k, role, title == 1), 1, 1));
              }
            }
          }
        }
        break;
      default:
        events.push_back(Event::simple(type));
        break;
    }
  }
  TEST_ASSERT_TRUE(events.size() > 100);

  // Gaps either side of the limits: five seconds (the wait for a first word) and the
  // 120 second cap.
  const uint32_t gaps[] = {1, 4999, 5000, 59999, kRecordCapMs - 1, kRecordCapMs, 2000000};
  for (const Entry& en : corpus) {
    for (const Event& e : events) {
      for (uint32_t gap : gaps) {
        PetApp app = en.app;
        Snapshot before = snap(app);
        Listen m = en.listen;
        observe(m, e);
        const Limits lim = limitsAt(m, en.now + gap);
        Actions a = app.handle(e, en.now + gap);
        checkStep(before, app, e, a, false, lim);
      }
    }
  }
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_no_event_is_an_approve);
  RUN_TEST(test_boot_unpaired_goes_to_setup);
  RUN_TEST(test_boot_paired_without_a_known_wifi_also_goes_to_setup);
  RUN_TEST(test_boot_paired_goes_offline_until_the_wifi_is_up);
  RUN_TEST(test_the_first_wifi_after_boot_says_nothing_however_long_it_took);
  RUN_TEST(test_events_before_boot_done_do_nothing_harmful);
  RUN_TEST(test_a_wifi_that_came_up_before_boot_done_is_not_forgotten);
  RUN_TEST(test_pairing_flow);
  RUN_TEST(test_pairing_refused_goes_back_to_setup);
  RUN_TEST(test_a_wifi_that_fails_during_pairing_says_so);
  RUN_TEST(test_pairing_approved_with_the_wifi_gone_is_offline);
  RUN_TEST(test_the_pet_cannot_talk_while_it_is_being_set_up);
  RUN_TEST(test_forgotten_wipes_the_pet_and_waits_for_the_owner_to_open_setup);
  RUN_TEST(test_a_tap_opens_the_setup_network_of_a_pet_that_waits_and_says_how_to_join);
  RUN_TEST(test_a_hold_of_the_light_opens_setup_too_and_never_records);
  RUN_TEST(test_the_setup_network_closes_when_nobody_finishes_and_a_tap_opens_it_again);
  RUN_TEST(test_a_pet_with_no_wifi_saved_opens_setup_when_it_is_powered_on);
  RUN_TEST(test_a_failed_try_keeps_the_setup_network_open);
  RUN_TEST(test_a_pet_that_is_set_up_ignores_a_timeout_and_a_tap_does_not_open_setup);
  RUN_TEST(test_a_reset_hold_leaves_no_setup_network_open);
  RUN_TEST(test_forgotten_while_recording_throws_the_audio_away);
  RUN_TEST(test_hold_to_talk_online);
  RUN_TEST(test_a_reply_that_says_the_team_is_working_lights_the_team);
  RUN_TEST(test_a_reply_that_needs_the_owners_approve_lights_nebula_and_decides_nothing);
  RUN_TEST(test_a_refused_reply_flashes_rose_then_rests);
  RUN_TEST(test_a_stale_refused_flash_does_not_leak_into_the_next_turn);
  RUN_TEST(test_a_late_end_of_an_old_reply_does_not_end_the_turn_being_sent);
  RUN_TEST(test_a_reply_ends_only_while_it_is_being_spoken);
  RUN_TEST(test_the_mic_switch_cut_during_a_recording_leaves_a_waiting_notice_waiting);
  RUN_TEST(test_a_failed_turn_plays_its_line_and_flashes);
  RUN_TEST(test_a_turn_failure_outside_a_turn_is_ignored);
  RUN_TEST(test_the_mic_switch_off_means_no_recording);
  RUN_TEST(test_the_mic_switch_cut_during_a_recording_discards_it);
  RUN_TEST(test_mic_off_in_every_idle_state);
  RUN_TEST(test_the_cap_ends_the_recording);
  RUN_TEST(test_the_cap_is_the_protocols_120_seconds);
  RUN_TEST(test_the_cap_works_across_a_clock_wrap);
  RUN_TEST(test_listening_starts_on_the_hold_and_goes_on_after_the_release);
  RUN_TEST(test_a_tap_while_listening_stops_and_sends_at_once);
  RUN_TEST(test_a_tap_before_any_speech_still_sends_what_was_recorded);
  RUN_TEST(test_a_second_hold_while_listening_also_sends_at_once);
  RUN_TEST(test_five_seconds_of_silence_after_speech_ends_the_recording);
  RUN_TEST(test_the_silence_is_the_detectors_word_not_the_pets_clock);
  RUN_TEST(test_no_speech_in_the_first_five_seconds_drops_the_recording);
  RUN_TEST(test_speech_inside_the_first_five_seconds_keeps_the_pet_listening);
  RUN_TEST(test_a_dropped_recording_is_not_talked_over_by_a_waiting_notice);
  RUN_TEST(test_a_full_memory_ends_the_recording_and_sends_what_it_holds);
  RUN_TEST(test_voice_events_do_nothing_when_the_pet_is_not_listening);
  RUN_TEST(test_a_cut_microphone_ends_a_long_recording_at_once);
  RUN_TEST(test_the_lime_light_is_solid_for_the_whole_listening);
  RUN_TEST(test_recording_never_starts_without_a_hold);
  RUN_TEST(test_barge_in_while_the_pet_speaks);
  RUN_TEST(test_tap_stops_a_reply_and_a_tap_in_ready_does_nothing);
  RUN_TEST(test_the_speaking_watchdog_and_the_sending_watchdog);
  RUN_TEST(test_offline_a_recording_becomes_a_saved_note);
  RUN_TEST(test_offline_with_a_full_memory_says_so);
  RUN_TEST(test_a_server_that_cannot_be_reached_turns_the_recording_into_a_note);
  RUN_TEST(test_a_network_error_answer_also_saves_the_note);
  RUN_TEST(test_the_wifi_lost_during_the_upload_saves_the_note);
  RUN_TEST(test_the_wifi_lost_while_listening_saves_the_note_at_the_end);
  RUN_TEST(test_the_wifi_coming_back_while_listening_is_used_at_the_end);
  RUN_TEST(test_losing_the_wifi_in_ready_goes_offline);
  RUN_TEST(test_wifi_up_with_notes_waiting_syncs_them);
  RUN_TEST(test_notes_from_before_a_reboot_are_synced_at_the_first_wifi);
  RUN_TEST(test_lost_wifi_during_a_sync_keeps_the_notes);
  RUN_TEST(test_a_network_error_during_a_sync_goes_offline);
  RUN_TEST(test_a_refused_sync_waits_a_minute_before_trying_again);
  RUN_TEST(test_a_refused_sync_backs_off_each_time);
  RUN_TEST(test_a_finished_sync_starts_the_backoff_over);
  RUN_TEST(test_a_sync_that_found_only_refused_notes_says_nothing);
  RUN_TEST(test_the_sync_watchdog);
  RUN_TEST(test_the_button_while_syncing_says_busy);
  RUN_TEST(test_a_note_saved_just_as_the_wifi_returns_is_synced_not_announced_as_offline);
  RUN_TEST(test_back_online_is_said_only_after_a_real_gap);
  RUN_TEST(test_a_notice_plays_in_ready);
  RUN_TEST(test_a_done_notice_with_a_title_is_fetched_spoken);
  RUN_TEST(test_a_notice_in_quiet_hours_stays_silent_and_dark_until_a_tap);
  RUN_TEST(test_a_notice_with_say_notices_off_waits_for_a_tap_and_lights_up);
  RUN_TEST(test_a_held_done_notice_flashes_then_waits);
  RUN_TEST(test_a_stopped_notice_shows_rose);
  RUN_TEST(test_a_settings_notice_is_silent_and_asks_for_a_heartbeat);
  RUN_TEST(test_an_approval_notice_for_the_run_the_turn_just_announced_only_moves_the_light);
  RUN_TEST(test_an_approval_notice_that_names_only_the_chat_is_matched_by_the_chat);
  RUN_TEST(test_an_approval_notice_for_another_run_is_still_said);
  RUN_TEST(test_the_two_minute_window_ends);
  RUN_TEST(test_a_done_notice_for_a_run_the_turn_already_answered_only_moves_the_light);
  RUN_TEST(test_a_done_notice_is_matched_by_its_run_alone);
  RUN_TEST(test_only_the_matching_state_and_kind_are_silenced);
  RUN_TEST(test_a_turn_that_names_nothing_silences_nothing);
  RUN_TEST(test_a_repeat_in_quiet_hours_or_with_notices_off_waits_for_nothing);
  RUN_TEST(test_a_notice_that_came_in_while_sending_is_dropped_when_the_answer_says_the_same);
  RUN_TEST(test_forgetting_the_pet_forgets_the_last_turn);
  RUN_TEST(test_quiet_hours_are_the_servers_word_not_a_clock);
  RUN_TEST(test_a_notice_that_arrives_while_busy_waits_its_turn);
  RUN_TEST(test_an_error_line_is_not_talked_over_by_a_waiting_notice);
  RUN_TEST(test_a_notice_does_not_start_a_recording_or_change_the_mic);
  RUN_TEST(test_a_tap_plays_the_waiting_notice_and_never_repeats_an_answer);
  RUN_TEST(test_a_double_tap_plays_what_waits_even_in_quiet_hours_or_with_notices_off);
  RUN_TEST(test_a_double_tap_with_nothing_waiting_asks_the_inbox_and_blinks_once);
  RUN_TEST(test_a_notice_that_comes_back_to_a_double_tap_plays_whatever_the_quiet_hours_say);
  RUN_TEST(test_the_ask_ends_after_its_window_and_quiet_hours_hold_again);
  RUN_TEST(test_a_double_tap_while_offline_cannot_ask_and_only_blinks);
  RUN_TEST(test_a_double_tap_when_the_pet_is_busy_does_nothing);
  RUN_TEST(test_a_double_tap_does_not_dismiss_the_lights);
  RUN_TEST(test_tap_stops_a_playing_notice_and_barge_in_works);
  RUN_TEST(test_the_notice_watchdog);
  RUN_TEST(test_the_nebula_blink_does_not_last_forever);
  RUN_TEST(test_the_team_working_light_does_not_last_forever);
  RUN_TEST(test_a_quiet_change_from_the_server_darkens_the_pet);
  RUN_TEST(test_listening_wins_over_every_overlay);
  RUN_TEST(test_rest_light_priority);
  RUN_TEST(test_low_battery_asks_for_the_charger_once);
  RUN_TEST(test_a_low_battery_pet_still_listens);
  RUN_TEST(test_a_low_battery_offline_stays_low_battery_but_saves_notes);
  RUN_TEST(test_plugging_in_clears_low_battery_and_says_charging);
  RUN_TEST(test_battery_ok_leaves_low_battery);
  RUN_TEST(test_critical_battery_shuts_down_and_stays_down);
  RUN_TEST(test_critical_battery_during_a_recording_stops_it_first);
  RUN_TEST(test_critical_battery_on_usb_power_is_ignored);
  RUN_TEST(test_reset_hold_forgets_and_restarts_from_any_state);
  RUN_TEST(test_a_fault_stops_everything_then_restarts);
  RUN_TEST(test_an_update_only_starts_from_ready);
  RUN_TEST(test_state_names);
  RUN_TEST(test_property_random_walk_keeps_the_rules);
  RUN_TEST(test_property_listening_ends_only_for_its_reasons);
  RUN_TEST(test_property_every_reachable_state_against_every_event);
  return UNITY_END();
}
