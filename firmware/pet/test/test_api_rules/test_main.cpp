// The pet's HTTPS rules: which address is allowed, redirects, retries, joining
// paths, the spoken line header, and error answers to voice pack lines.
#include <unity.h>

#include <cstring>
#include <string>

#include "core/api_rules.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

void test_https_base_accepts_only_https_with_a_host() {
  TEST_ASSERT_TRUE(isHttpsBase("https://app.example"));
  TEST_ASSERT_TRUE(isHttpsBase("https://app.example/"));
  TEST_ASSERT_TRUE(isHttpsBase("https://staging.app.example"));
  TEST_ASSERT_TRUE(isHttpsBase("https://dev.example:8443"));
  TEST_ASSERT_TRUE(isHttpsBase("https://dev.example:8443/base/path"));
  TEST_ASSERT_TRUE(isHttpsBase("https://203.0.113.7"));
  TEST_ASSERT_TRUE(isHttpsBase("https://host?x=1"));
}

void test_https_base_refuses_everything_else() {
  TEST_ASSERT_FALSE(isHttpsBase(nullptr));
  TEST_ASSERT_FALSE(isHttpsBase(""));
  TEST_ASSERT_FALSE(isHttpsBase("http://app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("ftp://app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("//app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("https:/app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("https://"));
  TEST_ASSERT_FALSE(isHttpsBase("https:///path"));
  TEST_ASSERT_FALSE(isHttpsBase("https://:443"));
  TEST_ASSERT_FALSE(isHttpsBase("https://user@app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("https://user:pass@app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("https://app.example @evil.example"));
  TEST_ASSERT_FALSE(isHttpsBase("https://app example.test"));
  TEST_ASSERT_FALSE(isHttpsBase(" https://app.example"));
  TEST_ASSERT_FALSE(isHttpsBase("https://app.example\n"));
  TEST_ASSERT_FALSE(isHttpsBase("https://app.example\t/x"));
  TEST_ASSERT_FALSE(isHttpsBase("HTTPS://app.example"));
  // An "@" in the path is not userinfo.
  TEST_ASSERT_TRUE(isHttpsBase("https://app.example/a@b"));
}

void test_the_default_base_is_https() {
  // config.h's default address passes its own check.
  TEST_ASSERT_TRUE(isHttpsBase("https://app.example"));
}

void test_redirects() {
  TEST_ASSERT_FALSE(isRedirect(200));
  TEST_ASSERT_FALSE(isRedirect(299));
  TEST_ASSERT_TRUE(isRedirect(300));
  TEST_ASSERT_TRUE(isRedirect(301));
  TEST_ASSERT_TRUE(isRedirect(302));
  TEST_ASSERT_TRUE(isRedirect(307));
  TEST_ASSERT_TRUE(isRedirect(308));
  TEST_ASSERT_TRUE(isRedirect(399));
  TEST_ASSERT_FALSE(isRedirect(400));
  TEST_ASSERT_FALSE(isRedirect(0));
  TEST_ASSERT_FALSE(isRedirect(-1));
}

void test_retry_rules() {
  TEST_ASSERT_TRUE(mayRetry(0));
  TEST_ASSERT_TRUE(mayRetry(-1));
  TEST_ASSERT_TRUE(mayRetry(-1000));
  TEST_ASSERT_TRUE(mayRetry(500));
  TEST_ASSERT_TRUE(mayRetry(502));
  TEST_ASSERT_TRUE(mayRetry(503));
  TEST_ASSERT_TRUE(mayRetry(599));
  TEST_ASSERT_TRUE(mayRetry(408));
  TEST_ASSERT_TRUE(mayRetry(429));
  TEST_ASSERT_FALSE(mayRetry(400));
  TEST_ASSERT_FALSE(mayRetry(401));
  TEST_ASSERT_FALSE(mayRetry(402));
  TEST_ASSERT_FALSE(mayRetry(404));
  TEST_ASSERT_FALSE(mayRetry(409));
  TEST_ASSERT_FALSE(mayRetry(410));
  TEST_ASSERT_FALSE(mayRetry(413));
  TEST_ASSERT_FALSE(mayRetry(415));
  TEST_ASSERT_FALSE(mayRetry(422));
  TEST_ASSERT_FALSE(mayRetry(200));
  TEST_ASSERT_FALSE(mayRetry(208));
  TEST_ASSERT_FALSE(mayRetry(302));
  TEST_ASSERT_FALSE(mayRetry(600));
}

void test_join_url() {
  TEST_ASSERT_EQUAL_STRING("https://a.example/api/pets/turn", joinUrl("https://a.example", "/api/pets/turn").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/api/pets/turn", joinUrl("https://a.example/", "api/pets/turn").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/api/pets/turn", joinUrl("https://a.example//", "//api/pets/turn").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/api/pets/turn", joinUrl("https://a.example", "api/pets/turn").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/base/x", joinUrl("https://a.example/base", "/x").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example", joinUrl("https://a.example/", "").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example", joinUrl("https://a.example", "/").c_str());
  TEST_ASSERT_EQUAL_STRING("/x", joinUrl("", "x").c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/api/pets/say/12", joinUrl("https://a.example", "/api/pets/say/12").c_str());
}

void test_percent_decode() {
  TEST_ASSERT_EQUAL_STRING("Your Coder finished.", percentDecode("Your%20Coder%20finished.").c_str());
  TEST_ASSERT_EQUAL_STRING("Hi, I'm Nova.", percentDecode("Hi%2C%20I'm%20Nova.").c_str());
  TEST_ASSERT_EQUAL_STRING("a+b", percentDecode("a+b").c_str());
  TEST_ASSERT_EQUAL_STRING("a+b", percentDecode("a%2Bb").c_str());
  TEST_ASSERT_EQUAL_STRING("lower", percentDecode("%6c%6F%77%65%72").c_str());
  TEST_ASSERT_EQUAL_STRING("", percentDecode("").c_str());
  TEST_ASSERT_EQUAL_STRING("plain", percentDecode("plain").c_str());
  // A "%" that does not start a valid sequence stays.
  TEST_ASSERT_EQUAL_STRING("100%", percentDecode("100%").c_str());
  TEST_ASSERT_EQUAL_STRING("50%2", percentDecode("50%2").c_str());
  TEST_ASSERT_EQUAL_STRING("%zz!", percentDecode("%zz!").c_str());
  TEST_ASSERT_EQUAL_STRING("%G1", percentDecode("%G1").c_str());
  // UTF-8 bytes come back as bytes: "Caf" + e-acute (C3 A9).
  const std::string cafe = percentDecode("Caf%C3%A9");
  TEST_ASSERT_EQUAL_INT(5, cafe.size());
  TEST_ASSERT_EQUAL_UINT8(0xC3, static_cast<uint8_t>(cafe[3]));
  TEST_ASSERT_EQUAL_UINT8(0xA9, static_cast<uint8_t>(cafe[4]));
  // A decoded NUL is kept as a byte, not a terminator.
  const std::string nul = percentDecode("a%00b");
  TEST_ASSERT_EQUAL_INT(3, nul.size());
}

void test_every_table_error_maps_to_its_line() {
  for (int i = 0; i < PET_ERROR_COUNT; ++i) {
    const PetErrorInfo& e = PET_ERRORS[i];
    TEST_ASSERT_EQUAL_STRING(e.line, lineForError(e.status, e.error));
    const PetErrorInfo* found = findError(e.status, e.error);
    TEST_ASSERT_NOT_NULL(found);
    TEST_ASSERT_EQUAL_INT(e.status, found->status);
    TEST_ASSERT_EQUAL_STRING(e.error, found->error);
  }
}

void test_the_two_gone_errors_are_told_apart_by_status() {
  TEST_ASSERT_EQUAL_STRING(PET_LINE_BUSY, lineForError(404, "gone"));
  TEST_ASSERT_EQUAL_STRING(PET_LINE_SETUP_REFUSED, lineForError(410, "gone"));
}

void test_named_lines_from_the_contract() {
  TEST_ASSERT_EQUAL_STRING("disconnected", lineForError(401, "forgotten"));
  TEST_ASSERT_EQUAL_STRING("no-access", lineForError(401, "no_access"));
  TEST_ASSERT_EQUAL_STRING("out-of-credits", lineForError(402, "out_of_credits"));
  TEST_ASSERT_EQUAL_STRING("spending-limit", lineForError(402, "spending_limit"));
  TEST_ASSERT_EQUAL_STRING("disconnected", lineForError(404, "off"));
  TEST_ASSERT_EQUAL_STRING("paused", lineForError(409, "paused"));
  TEST_ASSERT_EQUAL_STRING("didnt-catch", lineForError(413, "too_long"));
  TEST_ASSERT_EQUAL_STRING("didnt-catch", lineForError(415, "bad_audio"));
  TEST_ASSERT_EQUAL_STRING("didnt-catch", lineForError(422, "heard_nothing"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(429, "too_many"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(503, "voice_off"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(503, "store_off"));
  TEST_ASSERT_EQUAL_STRING("setup-refused", lineForError(400, "bad_code"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(400, "bad_request"));
}

void test_a_known_error_with_another_status_still_matches() {
  // A server that moves an error to a nearby status does not silence the pet.
  TEST_ASSERT_EQUAL_STRING("paused", lineForError(403, "paused"));
  TEST_ASSERT_EQUAL_STRING("out-of-credits", lineForError(403, "out_of_credits"));
}

void test_network_and_unknown_errors() {
  TEST_ASSERT_EQUAL_STRING("saved", lineForError(0, nullptr));
  TEST_ASSERT_EQUAL_STRING("saved", lineForError(-1, nullptr));
  TEST_ASSERT_EQUAL_STRING("saved", lineForError(-5, "paused"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(500, nullptr));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(502, ""));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(404, nullptr));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(418, "teapot"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(401, nullptr));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(302, nullptr));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(400, "nonsense"));
  TEST_ASSERT_EQUAL_STRING("", lineForError(200, nullptr));
  TEST_ASSERT_EQUAL_STRING("", lineForError(208, nullptr));
}

void test_find_error_without_a_name_finds_nothing() {
  TEST_ASSERT_NULL(findError(400, nullptr));
  TEST_ASSERT_NULL(findError(400, ""));
  TEST_ASSERT_NULL(findError(400, "no_such_error"));
}

void test_only_401_forgotten_forgets() {
  TEST_ASSERT_TRUE(isForgotten(401, "forgotten"));
  TEST_ASSERT_FALSE(isForgotten(401, "no_access"));
  TEST_ASSERT_FALSE(isForgotten(404, "off"));
  TEST_ASSERT_FALSE(isForgotten(404, "forgotten"));
  TEST_ASSERT_FALSE(isForgotten(401, nullptr));
  TEST_ASSERT_FALSE(isForgotten(401, ""));
  TEST_ASSERT_FALSE(isForgotten(0, "forgotten"));
}

void test_every_error_line_is_a_pack_line() {
  for (int i = 0; i < PET_ERROR_COUNT; ++i) {
    bool found = false;
    for (int k = 0; k < PET_LINE_COUNT; ++k) {
      if (std::strcmp(PET_ERRORS[i].line, PET_LINE_IDS[k]) == 0) {
        found = true;
      }
    }
    TEST_ASSERT_TRUE_MESSAGE(found, PET_ERRORS[i].error);
  }
  // The two lines the rules add themselves.
  bool saved = false;
  bool busy = false;
  for (int k = 0; k < PET_LINE_COUNT; ++k) {
    saved = saved || std::strcmp(PET_LINE_SAVED, PET_LINE_IDS[k]) == 0;
    busy = busy || std::strcmp(PET_LINE_BUSY, PET_LINE_IDS[k]) == 0;
  }
  TEST_ASSERT_TRUE(saved);
  TEST_ASSERT_TRUE(busy);
}

void test_wire_names_back_to_enums() {
  PetTurnState state = PET_STATE_ANSWERED;
  TEST_ASSERT_TRUE(turnStateFromWire("working", state));
  TEST_ASSERT_EQUAL_INT(PET_STATE_WORKING, state);
  TEST_ASSERT_TRUE(turnStateFromWire("needs-approve", state));
  TEST_ASSERT_EQUAL_INT(PET_STATE_NEEDS_APPROVE, state);
  TEST_ASSERT_TRUE(turnStateFromWire("refused", state));
  TEST_ASSERT_EQUAL_INT(PET_STATE_REFUSED, state);
  TEST_ASSERT_TRUE(turnStateFromWire("answered", state));
  TEST_ASSERT_EQUAL_INT(PET_STATE_ANSWERED, state);
  state = PET_STATE_REFUSED;
  TEST_ASSERT_FALSE(turnStateFromWire("Working", state));
  TEST_ASSERT_FALSE(turnStateFromWire("", state));
  TEST_ASSERT_FALSE(turnStateFromWire(nullptr, state));
  TEST_ASSERT_EQUAL_INT(PET_STATE_REFUSED, state);

  PetNoticeKind kind = PET_NOTICE_KIND_DONE;
  TEST_ASSERT_TRUE(noticeKindFromWire("approval", kind));
  TEST_ASSERT_EQUAL_INT(PET_NOTICE_KIND_APPROVAL, kind);
  TEST_ASSERT_TRUE(noticeKindFromWire("settings", kind));
  TEST_ASSERT_EQUAL_INT(PET_NOTICE_KIND_SETTINGS, kind);
  TEST_ASSERT_FALSE(noticeKindFromWire("approve", kind));
  TEST_ASSERT_EQUAL_INT(PET_NOTICE_KIND_SETTINGS, kind);

  PetKind pk = PET_KIND_ASTRONAUT;
  TEST_ASSERT_TRUE(petKindFromWire("cat", pk));
  TEST_ASSERT_EQUAL_INT(PET_KIND_CAT, pk);
  TEST_ASSERT_TRUE(petKindFromWire("alien", pk));
  TEST_ASSERT_EQUAL_INT(PET_KIND_ALIEN, pk);
  TEST_ASSERT_FALSE(petKindFromWire("dog", pk));
  TEST_ASSERT_FALSE(petKindFromWire(nullptr, pk));
}

void test_a_turn_is_received_only_on_200_or_208() {
  // Rule 6: a saved note is deleted after these two answers and after nothing else.
  TEST_ASSERT_TRUE(isTurnReceived(200));
  TEST_ASSERT_TRUE(isTurnReceived(208));
  const int others[] = {0, -1, -1000, 100, 199, 201, 202, 204, 206, 207, 209, 299, 300, 302, 400, 401, 402, 404,
                        409, 410, 413, 415, 422, 429, 500, 502, 503, 504, 599};
  for (int status : others) {
    TEST_ASSERT_FALSE_MESSAGE(isTurnReceived(status), "only 200 and 208 count");
  }
}

void test_the_sync_confirms_only_what_the_server_received() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::Confirm), static_cast<int>(syncOutcomeFor(200, nullptr)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::Confirm), static_cast<int>(syncOutcomeFor(208, nullptr)));
  for (int status = -5; status < 600; ++status) {
    const bool confirm = syncOutcomeFor(status, nullptr) == SyncOutcome::Confirm;
    TEST_ASSERT_EQUAL_INT(isTurnReceived(status) ? 1 : 0, confirm ? 1 : 0);
  }
}

void test_the_sync_skips_a_note_the_server_refuses_for_its_content() {
  // The note stays on the pet (it is not confirmed) but the notes behind it go on.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::SkipNote), static_cast<int>(syncOutcomeFor(413, "too_long")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::SkipNote), static_cast<int>(syncOutcomeFor(415, "bad_audio")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::SkipNote), static_cast<int>(syncOutcomeFor(422, "heard_nothing")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::SkipNote), static_cast<int>(syncOutcomeFor(400, "bad_request")));
}

void test_the_sync_stops_when_the_trouble_is_not_the_note() {
  const int waits[] = {401, 402, 403, 404, 409, 410, 418, 429, 302};
  for (int status : waits) {
    TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopRetry), static_cast<int>(syncOutcomeFor(status, nullptr)));
  }
  // A paused pet, voice quota used up, a flag that is off: all wait.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopRetry), static_cast<int>(syncOutcomeFor(409, "paused")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopRetry), static_cast<int>(syncOutcomeFor(402, "out_of_credits")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopRetry), static_cast<int>(syncOutcomeFor(404, "off")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopRetry), static_cast<int>(syncOutcomeFor(401, "no_access")));
  // No answer at all means offline.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopOffline), static_cast<int>(syncOutcomeFor(0, nullptr)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopOffline), static_cast<int>(syncOutcomeFor(-1, nullptr)));
  // Only the 401 "forgotten" answer says the pet is no longer known.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::Forgotten), static_cast<int>(syncOutcomeFor(401, "forgotten")));
}

void test_the_sync_treats_a_server_error_or_a_timeout_as_unreachable_and_backs_off() {
  const int unreachable[] = {408, 500, 501, 502, 503, 504, 599};
  for (int status : unreachable) {
    TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopServerError), static_cast<int>(syncOutcomeFor(status, nullptr)));
  }
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopServerError), static_cast<int>(syncOutcomeFor(503, "voice_off")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopServerError), static_cast<int>(syncOutcomeFor(503, "store_off")));
}

void test_a_repeat_of_a_turn_that_is_still_starting_is_retry_later_not_a_confirmation() {
  // The server answers 429 "busy" to a turn id whose first try has not started a
  // run (208 comes only once it has): the note stays, the sync waits and backs off.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::StopRetry), static_cast<int>(syncOutcomeFor(429, "too_many")));
  TEST_ASSERT_FALSE(isTurnReceived(429));
  TEST_ASSERT_TRUE(mayRetry(429));
  TEST_ASSERT_EQUAL_STRING("busy", lineForError(429, "too_many"));
  TEST_ASSERT_EQUAL_STRING("busy", lineFromAnswer(429, "too_many", "busy"));
}

void test_a_saved_note_is_deleted_after_a_200_whatever_the_body_says() {
  // 200 {status:"sent"}, {status:"draft"} and {status:"empty"} are all a 200: the
  // body is not read, so a new status can never keep a note that was received.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::Confirm), static_cast<int>(syncOutcomeFor(200, nullptr)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::Confirm), static_cast<int>(syncOutcomeFor(200, "")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(SyncOutcome::Confirm), static_cast<int>(syncOutcomeFor(208, nullptr)));
}

void test_unreachable_means_no_answer_a_timeout_or_a_server_error() {
  TEST_ASSERT_TRUE(isUnreachable(0));
  TEST_ASSERT_TRUE(isUnreachable(-1));
  TEST_ASSERT_TRUE(isUnreachable(-2));
  TEST_ASSERT_TRUE(isUnreachable(408));
  TEST_ASSERT_TRUE(isUnreachable(500));
  TEST_ASSERT_TRUE(isUnreachable(502));
  TEST_ASSERT_TRUE(isUnreachable(503));
  TEST_ASSERT_TRUE(isUnreachable(504));
  // OpenStellarFirm answered: busy, voice quota used up, paused, a refusal, or a good answer.
  const int answered[] = {200, 208, 302, 400, 401, 402, 404, 409, 413, 415, 422, 429};
  for (int status : answered) {
    TEST_ASSERT_FALSE_MESSAGE(isUnreachable(status), "OpenStellarFirm answered");
  }
}

void test_every_turn_answer_the_server_can_send_has_a_verdict() {
  // The statuses and bodies the turn route sends (the server's pet routes, a later phase of docs/desk-pets-plan.md).
  TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Reply), static_cast<int>(turnVerdictFor(200, nullptr)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Received), static_cast<int>(turnVerdictFor(208, nullptr)));
  for (int i = 0; i < PET_ERROR_COUNT; ++i) {
    const PetErrorInfo& e = PET_ERRORS[i];
    const TurnVerdict verdict = turnVerdictFor(e.status, e.error);
    if (std::strcmp(e.error, "forgotten") == 0) {
      // Only this one clears the token and goes back to setup.
      TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Forgotten), static_cast<int>(verdict));
    } else if (e.status >= 500) {
      // A server error counts as unreachable: the recording becomes a saved note.
      TEST_ASSERT_EQUAL_INT_MESSAGE(static_cast<int>(TurnVerdict::Unreachable), static_cast<int>(verdict), e.error);
    } else {
      // Everything else is an answer: its line is played and the pet stays paired.
      TEST_ASSERT_EQUAL_INT_MESSAGE(static_cast<int>(TurnVerdict::Failed), static_cast<int>(verdict), e.error);
      TEST_ASSERT_FALSE(isForgotten(e.status, e.error));
    }
  }
  // 401 no_access, 402, 409, 413, 415, 422 and 429 keep the pet paired.
  const struct {
    int status;
    const char* error;
    const char* line;
  } stays[] = {{401, "no_access", "no-access"}, {402, "out_of_credits", "out-of-credits"},
               {402, "spending_limit", "spending-limit"}, {409, "paused", "paused"},
               {413, "too_long", "didnt-catch"},  {415, "bad_audio", "didnt-catch"},
               {422, "heard_nothing", "didnt-catch"}, {429, "too_many", "busy"}};
  for (const auto& answer : stays) {
    TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Failed), static_cast<int>(turnVerdictFor(answer.status, answer.error)));
    TEST_ASSERT_EQUAL_STRING(answer.line, lineFromAnswer(answer.status, answer.error, answer.line));
  }
}

void test_a_dropped_connection_a_timeout_or_a_5xx_saves_the_recording() {
  const int status[] = {0, -1, -2, 408, 500, 502, 503, 504};
  for (int s : status) {
    TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Unreachable), static_cast<int>(turnVerdictFor(s, nullptr)));
  }
  // The same body on a 5xx changes nothing: it is still unreachable.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Unreachable), static_cast<int>(turnVerdictFor(503, "voice_off")));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Unreachable), static_cast<int>(turnVerdictFor(503, "store_off")));
  // A 401 that is not "forgotten" is not it either.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(TurnVerdict::Failed), static_cast<int>(turnVerdictFor(401, nullptr)));
}

void test_a_reply_with_no_sound_plays_the_clip_for_its_state() {
  TEST_ASSERT_EQUAL_STRING("working", clipForSilentReply(PET_STATE_WORKING));
  TEST_ASSERT_EQUAL_STRING("needs-approve", clipForSilentReply(PET_STATE_NEEDS_APPROVE));
  TEST_ASSERT_EQUAL_STRING("refused", clipForSilentReply(PET_STATE_REFUSED));
  TEST_ASSERT_EQUAL_STRING("message", clipForSilentReply(PET_STATE_ANSWERED));
  // Every one is a clip of the pack, and none of them is the pet reading step text.
  for (int state = 0; state < PET_STATE_COUNT; ++state) {
    const char* clip = clipForSilentReply(static_cast<PetTurnState>(state));
    bool found = false;
    for (int k = 0; k < PET_LINE_COUNT; ++k) {
      found = found || std::strcmp(clip, PET_LINE_IDS[k]) == 0;
    }
    TEST_ASSERT_TRUE_MESSAGE(found, clip);
  }
}

void test_the_line_in_the_body_wins_when_the_server_can_send_it() {
  // The server decides what the pet says: a line the table can send is played even when
  // this firmware's own table maps the error to another one.
  TEST_ASSERT_EQUAL_STRING("paused", lineFromAnswer(409, "paused", "paused"));
  TEST_ASSERT_EQUAL_STRING("out-of-credits", lineFromAnswer(402, "future_error", "out-of-credits"));
  TEST_ASSERT_EQUAL_STRING("busy", lineFromAnswer(400, "bad_request", "busy"));
  // No line, or one the server's table cannot send: the table decides.
  TEST_ASSERT_EQUAL_STRING("paused", lineFromAnswer(409, "paused", nullptr));
  TEST_ASSERT_EQUAL_STRING("paused", lineFromAnswer(409, "paused", ""));
  TEST_ASSERT_EQUAL_STRING("paused", lineFromAnswer(409, "paused", "no-such-clip"));
  TEST_ASSERT_EQUAL_STRING("paused", lineFromAnswer(409, "paused", "setup-code"));
  TEST_ASSERT_EQUAL_STRING("busy", lineFromAnswer(418, "teapot", "char-A"));
  // A network error is a saved note, and a good answer has no error line.
  TEST_ASSERT_EQUAL_STRING("saved", lineFromAnswer(0, nullptr, "paused"));
  TEST_ASSERT_EQUAL_STRING("saved", lineFromAnswer(-1, "paused", "paused"));
  TEST_ASSERT_EQUAL_STRING("", lineFromAnswer(200, nullptr, "paused"));
  // What comes back can be kept in an event: it is a static string, not the body's buffer.
  char body[24] = "paused";
  const char* line = lineFromAnswer(409, "paused", body);
  body[0] = 'X';
  TEST_ASSERT_EQUAL_STRING("paused", line);
}

void test_every_error_line_the_table_can_send_is_accepted_from_a_body() {
  for (int i = 0; i < PET_ERROR_COUNT; ++i) {
    TEST_ASSERT_NOT_NULL(errorLineId(PET_ERRORS[i].line));
    TEST_ASSERT_EQUAL_STRING(PET_ERRORS[i].line, errorLineId(PET_ERRORS[i].line));
  }
  TEST_ASSERT_NULL(errorLineId(nullptr));
  TEST_ASSERT_NULL(errorLineId(""));
  TEST_ASSERT_NULL(errorLineId("hello"));
  TEST_ASSERT_NULL(errorLineId("done"));
}

void test_a_notice_that_cannot_be_read_aloud_says_paused_or_busy_and_never_retries() {
  // 409: the pet is paused. 429: OpenStellarFirm is busy. Each plays its own line.
  TEST_ASSERT_EQUAL_STRING("paused", lineForFailedSay(409, "paused", "paused", "done"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForFailedSay(429, "too_many", "busy", "done"));
  TEST_ASSERT_EQUAL_STRING("paused", lineForFailedSay(409, nullptr, nullptr, "message"));
  TEST_ASSERT_EQUAL_STRING("busy", lineForFailedSay(429, nullptr, nullptr, "message"));
  // Anything else plays the clip that stands in for the notice.
  const int others[] = {-1, 0, 400, 401, 402, 404, 500, 503};
  for (int status : others) {
    TEST_ASSERT_EQUAL_STRING("hello", lineForFailedSay(status, nullptr, nullptr, "hello"));
    TEST_ASSERT_EQUAL_STRING("done", lineForFailedSay(status, "gone", "busy", "done"));
  }
}

void test_the_inbox_cursor_follows_the_server_even_when_it_goes_down() {
  InboxCursor up = inboxCursorAfter(5, 9);
  TEST_ASSERT_EQUAL_UINT32(9, up.after);
  TEST_ASSERT_TRUE(up.store);
  // The counter started over: the server's next is lower than what the pet sent.
  InboxCursor restarted = inboxCursorAfter(40, 3);
  TEST_ASSERT_EQUAL_UINT32(3, restarted.after);
  TEST_ASSERT_TRUE(restarted.store);
  InboxCursor toZero = inboxCursorAfter(40, 0);
  TEST_ASSERT_EQUAL_UINT32(0, toZero.after);
  TEST_ASSERT_TRUE(toZero.store);
  // Nothing new: nothing to write to flash.
  InboxCursor same = inboxCursorAfter(7, 7);
  TEST_ASSERT_EQUAL_UINT32(7, same.after);
  TEST_ASSERT_FALSE(same.store);
  InboxCursor fresh = inboxCursorAfter(0, 0);
  TEST_ASSERT_EQUAL_UINT32(0, fresh.after);
  TEST_ASSERT_FALSE(fresh.store);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_https_base_accepts_only_https_with_a_host);
  RUN_TEST(test_https_base_refuses_everything_else);
  RUN_TEST(test_the_default_base_is_https);
  RUN_TEST(test_redirects);
  RUN_TEST(test_retry_rules);
  RUN_TEST(test_join_url);
  RUN_TEST(test_percent_decode);
  RUN_TEST(test_every_table_error_maps_to_its_line);
  RUN_TEST(test_the_two_gone_errors_are_told_apart_by_status);
  RUN_TEST(test_named_lines_from_the_contract);
  RUN_TEST(test_a_known_error_with_another_status_still_matches);
  RUN_TEST(test_network_and_unknown_errors);
  RUN_TEST(test_find_error_without_a_name_finds_nothing);
  RUN_TEST(test_only_401_forgotten_forgets);
  RUN_TEST(test_every_error_line_is_a_pack_line);
  RUN_TEST(test_wire_names_back_to_enums);
  RUN_TEST(test_a_turn_is_received_only_on_200_or_208);
  RUN_TEST(test_the_sync_confirms_only_what_the_server_received);
  RUN_TEST(test_the_sync_skips_a_note_the_server_refuses_for_its_content);
  RUN_TEST(test_the_sync_stops_when_the_trouble_is_not_the_note);
  RUN_TEST(test_the_sync_treats_a_server_error_or_a_timeout_as_unreachable_and_backs_off);
  RUN_TEST(test_a_repeat_of_a_turn_that_is_still_starting_is_retry_later_not_a_confirmation);
  RUN_TEST(test_a_saved_note_is_deleted_after_a_200_whatever_the_body_says);
  RUN_TEST(test_unreachable_means_no_answer_a_timeout_or_a_server_error);
  RUN_TEST(test_every_turn_answer_the_server_can_send_has_a_verdict);
  RUN_TEST(test_a_dropped_connection_a_timeout_or_a_5xx_saves_the_recording);
  RUN_TEST(test_a_reply_with_no_sound_plays_the_clip_for_its_state);
  RUN_TEST(test_the_line_in_the_body_wins_when_the_server_can_send_it);
  RUN_TEST(test_every_error_line_the_table_can_send_is_accepted_from_a_body);
  RUN_TEST(test_a_notice_that_cannot_be_read_aloud_says_paused_or_busy_and_never_retries);
  RUN_TEST(test_the_inbox_cursor_follows_the_server_even_when_it_goes_down);
  return UNITY_END();
}
