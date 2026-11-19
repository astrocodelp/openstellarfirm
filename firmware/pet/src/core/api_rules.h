#pragma once

// The rules of the pet's HTTPS calls that need no network to check: which base
// address is allowed, what counts as a redirect or a retry, how a path joins an
// address, how the spoken line header is decoded, and which voice pack line an
// error answer maps to. The hardware client (net/api.cpp) applies them.
//
// Rule 7 of docs/desk-pets-plan.md: HTTPS only, and no redirect is ever followed
// with the token.

#include <cstdint>
#include <string>

#include "generated/protocol.h"

namespace pet {

// True for an address that begins with exactly "https://", has a host, carries
// no user name or password ("https://user@host"), and holds no space or control
// character. A path, a port and a query are fine. nullptr is false.
bool isHttpsBase(const char* base);

// Any 3xx. The client treats it as an error and never sends the token to the
// Location it names.
bool isRedirect(int status);

// Whether the same request may be sent again later: a network error (status 0
// or below), any 5xx, 408 and 429. Other 4xx answers will not change by waiting.
bool mayRetry(int status);

// A call that got no answer to act on: no connection or one that dropped (status
// 0 or below, which covers the client's own timeout), a timeout the server or a
// proxy reports (408) or a server error (any 5xx). Nothing was decided about
// what the pet sent, so it is kept and sent again, and OpenStellarFirm counts as
// unreachable until a probe is answered. 429 is not here: that is OpenStellarFirm
// answering that it is busy.
bool isUnreachable(int status);

// base + "/" + path with exactly one slash between them, whatever the inputs
// end and begin with. An empty path gives the base without a trailing slash.
std::string joinUrl(const std::string& base, const std::string& path);

// Decodes %XX sequences (either case) back to bytes; the X-Pet-Line header
// holds spoken text from encodeURIComponent. A "%" that does not start a valid
// sequence is kept as it is; "+" stays "+" (encodeURIComponent writes %2B for it).
std::string percentDecode(const std::string& text);

// The table row for an answer, matched on the JSON error name and the status
// together ("gone" is both a 404 and a 410), or nullptr. A name the table knows
// with a different status still matches, so a server that changes a status does
// not silence the pet.
const PetErrorInfo* findError(int status, const char* errorOrNull);

// The id (a static string of PET_LINE_IDS) of a pack line that an error answer's
// body may name, or nullptr: only lines the server's error table can send count,
// so a body cannot make the pet play any other clip.
const char* errorLineId(const char* lineOrNull);

// The voice pack line to play for a failed call (an id from PET_LINE_*):
// - a known error: the table's line;
// - a network error (status 0 or below): "saved", meaning keep the note and
//   work offline;
// - any other 4xx or 5xx, or a 3xx, without a known error: "busy";
// - a 2xx is not an error: "".
const char* lineForError(int status, const char* errorOrNull);

// The same, but the body's own "line" wins when it names a clip the error table
// can send (errorLineId): the server decides what the pet says, and a new error
// that reuses an existing line needs no new firmware. Without one this is
// lineForError. The result is always a static string, safe to keep in an Event.
const char* lineFromAnswer(int status, const char* errorOrNull, const char* lineOrNull);

// True only for the 401 "forgotten" answer: the server no longer knows this pet,
// so it clears its token and goes back to setup after saying "disconnected".
// ("off", a server with the feature switched off, says "disconnected" too but
// must never make the pet forget itself.)
bool isForgotten(int status, const char* errorOrNull);

// The two answers that are about the owner's ElevenLabs key and not about the pet: 401
// "no_access" (the key is missing or was refused) and 402 "out_of_credits" (its quota is used
// up). Both are told apart from 401 "forgotten" by the body's error name alone, since they
// share a status: a refused key must never make the pet forget its pairing, and a forgotten
// pet must never say its key was refused. Each plays its own pack line (the clips
// "no-access" and "out-of-credits"); the pet stays paired and keeps its notes.
bool isVoiceKeyRefused(int status, const char* errorOrNull);
bool isVoiceQuotaUsedUp(int status, const char* errorOrNull);

// Rule 6 of docs/desk-pets-plan.md: OpenStellarFirm has a turn only when it answered 200
// or 208 ("already received"). A saved note is deleted from the pet after this
// and after nothing else; every other answer, a network error included, leaves it.
bool isTurnReceived(int status);

// What a live turn's answer means for the pet (docs/desk-pets-plan.md, "The turn").
enum class TurnVerdict : uint8_t {
  Reply,        // 200: play what came, the audio or, with an empty body, the clip for the state
  Received,     // 208: OpenStellarFirm has this turn already, there is nothing to play
  Forgotten,    // 401 "forgotten": this pet is no longer known
  Unreachable,  // no answer, a timeout or a server error: keep the recording as a saved note
  Failed,       // any other answer: play its line and stay paired
};

TurnVerdict turnVerdictFor(int status, const char* errorOrNull);

// A 200 turn answer with no sound in it (the speech failed after the run had
// started) is told by its X-Pet-State alone, so the pet plays the pack clip for
// it: working -> "working", needs-approve -> "needs-approve", refused ->
// "refused", answered -> "message" (the words are in the app).
const char* clipForSilentReply(PetTurnState state);

// What the pet plays when a notice could not be read aloud (GET /say/<seq>).
// A pet that is paused (409), a busy OpenStellarFirm (429), a refused voice key (401
// no_access) and a used up voice quota (402 out_of_credits) say their own lines from the
// answer; nothing is retried. Any other failure plays `fallback`, the clip that stands in
// for the notice (done, message, hello...).
const char* lineForFailedSay(int status, const char* errorOrNull, const char* lineOrNull, const char* fallback);

// What the sync of saved notes does after the server's answer to one note.
enum class SyncOutcome : uint8_t {
  Confirm,          // 200 or 208: OpenStellarFirm has it, delete the note and send the next
  SkipNote,         // the server refused this note's content: leave it, try the next one
  StopOffline,      // no answer at all: stop, the notes stay, back when the network is
  StopServerError,  // a server error or a timeout: unreachable, but the sync backs off before it tries again
  StopRetry,        // OpenStellarFirm cannot take notes now (busy, limits, voice quota used up, paused...): stop and try later
  Forgotten,        // 401 "forgotten": this pet is no longer known
};

// 400 bad_request, 413, 415 and 422 are about the note itself (a damaged file, a
// silent recording): waiting will not change them, and they must not hold up the
// notes behind. Every other answer is about OpenStellarFirm or the account, so the
// whole sync waits. The note is never deleted on a refusal (isTurnReceived), and
// a pass never repeats itself without waiting: every stop but Forgotten arms the
// sync's backoff or the offline probe.
SyncOutcome syncOutcomeFor(int status, const char* errorOrNull);

// Where the inbox cursor stands after an answer: `next` is the server's own word
// for it. It can be lower than the `after` the pet sent (the counter started
// over), so it is taken whenever it differs, never only when it is greater, and
// `store` says it must be written to flash.
struct InboxCursor {
  uint32_t after = 0;
  bool store = false;
};

InboxCursor inboxCursorAfter(uint32_t after, uint32_t serverNext);

// The time the app's own `Date` header gives, which is the only clock the pet has: it
// reaches no time server of the internet (the pet talks to the app on the home network and
// nowhere else), so the time of a saved note comes from the computer it is saved for.
// `Date: Sun, 06 Nov 1994 08:49:37 GMT`, the one form HTTP servers write (RFC 9110
// IMF-fixdate). False for any other shape, a date before 2024 or after 2099.
bool parseHttpDate(const char* text, int64_t& epochSeconds);

// Whether the pet's own clock should be set from a server time: it was never set (before
// 2024) or it is more than `kClockSlackSeconds` away. A small drift is left alone so a
// heartbeat does not move the clock for nothing.
constexpr int64_t kClockSlackSeconds = 5;
bool shouldSetClock(int64_t deviceSeconds, int64_t serverSeconds);

// The wire names back to the generated enums. Each returns false for a name it
// does not know and leaves `out` alone.
bool turnStateFromWire(const char* name, PetTurnState& out);
bool noticeKindFromWire(const char* name, PetNoticeKind& out);
bool petKindFromWire(const char* name, PetKind& out);

}  // namespace pet
