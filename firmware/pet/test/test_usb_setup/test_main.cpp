// pet-usb v1, the pet's side (core/usb_setup_rules.h), and the line queue the serial
// port is fed through (core/line_queue.h). Every golden line the TypeScript side
// writes (generated/usb_vectors.h, from src/shared/pets) is run through the code
// the firmware runs, so the page and the pet read the same lines.
#include <unity.h>

#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "core/line_queue.h"
#include "core/usb_setup_rules.h"
#include "generated/protocol.h"
#include "generated/usb_vectors.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

const uint32_t kNow = 1000;

// Feeds a line and its terminator byte by byte, as the port delivers it. Returns how
// many things came out; `last` holds the last of them.
int feed(UsbEndpoint& endpoint, const std::string& bytes, UsbPolicy policy, UsbInbound& last, uint32_t now = kNow) {
  int events = 0;
  for (char c : bytes) {
    UsbInbound inbound;
    if (endpoint.push(static_cast<uint8_t>(c), now, policy, inbound)) {
      ++events;
      last = std::move(inbound);
    }
  }
  return events;
}

int indexOf(const char* const* ids, int count, const char* word) {
  for (int i = 0; i < count; ++i) {
    if (std::strcmp(ids[i], word) == 0) {
      return i;
    }
  }
  return -1;
}

std::string lineOf(size_t length, char fill) { return std::string(length, fill); }

// The reply a golden row describes, built with the firmware's own builders.
size_t buildReply(const PetUsbReplyVector& row, char* out, size_t cap) {
  if (std::strcmp(row.type, "hello") == 0) {
    const int kind = indexOf(PET_KIND_IDS, PET_KIND_COUNT, row.kind);
    TEST_ASSERT_TRUE_MESSAGE(kind >= 0, row.name);
    return usbHelloLine(out, cap, static_cast<PetKind>(kind), row.firmware, row.paired, row.setupOpen);
  }
  if (std::strcmp(row.type, "net") == 0) {
    return usbNetLine(out, cap, row.ssid, row.ssidLength, row.rssi, row.locked);
  }
  if (std::strcmp(row.type, "scan-done") == 0) {
    return usbScanDoneLine(out, cap, static_cast<size_t>(row.count));
  }
  if (std::strcmp(row.type, "state") == 0) {
    const int state = indexOf(PET_USB_STATE_IDS, PET_USB_STATE_COUNT, row.state);
    TEST_ASSERT_TRUE_MESSAGE(state >= 0, row.name);
    int error = 0;
    if (state == PET_USB_STATE_ERROR) {
      error = indexOf(PET_USB_ERROR_IDS, PET_USB_ERROR_COUNT, row.error);
      TEST_ASSERT_TRUE_MESSAGE(error >= 0, row.name);
    }
    return usbStateLine(out, cap, static_cast<PetUsbState>(state), static_cast<PetUsbError>(error));
  }
  if (std::strcmp(row.type, "refused") == 0) {
    const int reason = indexOf(PET_USB_REFUSAL_IDS, PET_USB_REFUSAL_COUNT, row.reason);
    TEST_ASSERT_TRUE_MESSAGE(reason >= 0, row.name);
    return usbRefusedLine(out, cap, static_cast<PetUsbRefusal>(reason));
  }
  TEST_FAIL_MESSAGE(row.name);
  return 0;
}

// Every reply the firmware can build, for the never-echo checks.
std::vector<std::string> everyReply() {
  std::vector<std::string> all;
  char out[kUsbReplyCapacity];
  for (int kind = 0; kind < PET_KIND_COUNT; ++kind) {
    for (int flags = 0; flags < 4; ++flags) {
      const size_t n = usbHelloLine(out, sizeof(out), static_cast<PetKind>(kind), "0.1.0", flags & 1, flags & 2);
      all.emplace_back(out, n);
    }
  }
  const uint8_t ssid[] = {'H', 'o', 'm', 'e'};
  for (int rssi = -127; rssi <= 0; rssi += 9) {
    for (int locked = 0; locked < 2; ++locked) {
      all.emplace_back(out, usbNetLine(out, sizeof(out), ssid, sizeof(ssid), rssi, locked != 0));
    }
  }
  for (size_t count = 0; count <= PET_USB_MAX_NETWORKS; ++count) {
    all.emplace_back(out, usbScanDoneLine(out, sizeof(out), count));
  }
  for (int state = 0; state < PET_USB_STATE_COUNT; ++state) {
    for (int error = 0; error < PET_USB_ERROR_COUNT; ++error) {
      all.emplace_back(out, usbStateLine(out, sizeof(out), static_cast<PetUsbState>(state), static_cast<PetUsbError>(error)));
    }
  }
  for (int reason = 0; reason < PET_USB_REFUSAL_COUNT; ++reason) {
    all.emplace_back(out, usbRefusedLine(out, sizeof(out), static_cast<PetUsbRefusal>(reason)));
  }
  return all;
}


// The firmware's own source, for the few promises that are about what the code says and
// not about what it does (no log line names a secret; the port cannot reboot the chip).
// PlatformIO runs a test from the project folder.
std::string sourceOf(const char* relative) {
  std::ifstream file(relative);
  TEST_ASSERT_TRUE_MESSAGE(file.good(), relative);
  std::stringstream text;
  text << file.rdbuf();
  return text.str();
}

std::string lowerCase(std::string text) {
  for (char& c : text) {
    if (c >= 'A' && c <= 'Z') {
      c = static_cast<char>(c - 'A' + 'a');
    }
  }
  return text;
}

// The text of every PET_LOG or Serial call in a source file, joined across the lines a
// call is wrapped over (a call ends at its semicolon).
std::vector<std::string> printCallsIn(const std::string& source) {
  std::vector<std::string> calls;
  size_t at = 0;
  while (at < source.size()) {
    size_t next = std::string::npos;
    for (const char* marker : {"PET_LOG(", "Serial.print", "logLine("}) {
      const size_t found = source.find(marker, at);
      if (found != std::string::npos && (next == std::string::npos || found < next)) {
        next = found;
      }
    }
    if (next == std::string::npos) {
      break;
    }
    const size_t end = source.find(';', next);
    calls.push_back(source.substr(next, end == std::string::npos ? std::string::npos : end - next));
    at = end == std::string::npos ? source.size() : end;
  }
  return calls;
}

}  // namespace

// -- The golden lines --------------------------------------------------------------------

void test_every_golden_request_is_read_the_way_the_page_says() {
  for (int i = 0; i < PET_USB_REQUEST_VECTOR_COUNT; ++i) {
    const PetUsbRequestVector& row = PET_USB_REQUEST_VECTORS[i];
    UsbEndpoint endpoint;
    UsbInbound last;
    UsbPolicy policy;
    policy.paired = row.paired;
    policy.busy = row.busy;
    const int events = feed(endpoint, std::string(row.line) + "\n", policy, last);

    if (std::strcmp(row.outcome, "ignored") == 0) {
      TEST_ASSERT_EQUAL_INT_MESSAGE(0, events, row.name);
    } else if (std::strcmp(row.outcome, "refused") == 0) {
      TEST_ASSERT_EQUAL_INT_MESSAGE(1, events, row.name);
      TEST_ASSERT_TRUE_MESSAGE(last.what == UsbWhat::Refusal, row.name);
      TEST_ASSERT_EQUAL_STRING_MESSAGE(row.refusal, PET_USB_REFUSAL_IDS[last.refusal], row.name);
    } else {
      TEST_ASSERT_EQUAL_STRING_MESSAGE("ok", row.outcome, row.name);
      TEST_ASSERT_EQUAL_INT_MESSAGE(1, events, row.name);
      TEST_ASSERT_TRUE_MESSAGE(last.what == UsbWhat::Request, row.name);
      TEST_ASSERT_EQUAL_STRING_MESSAGE(row.op, PET_USB_OP_IDS[last.request.op], row.name);
      if (std::strcmp(row.op, "join") == 0) {
        TEST_ASSERT_EQUAL_UINT_MESSAGE(row.ssidLength, last.request.join.ssid.size(), row.name);
        TEST_ASSERT_EQUAL_MEMORY_MESSAGE(row.ssid, last.request.join.ssid.data(), row.ssidLength, row.name);
        TEST_ASSERT_EQUAL_STRING_MESSAGE(row.password, last.request.join.password.c_str(), row.name);
        TEST_ASSERT_EQUAL_STRING_MESSAGE(row.setupCode, last.request.join.code.c_str(), row.name);
      } else {
        TEST_ASSERT_TRUE_MESSAGE(last.request.join.ssid.empty() && last.request.join.password.empty() && last.request.join.code.empty(), row.name);
      }
    }
  }
}

void test_a_carriage_return_before_the_newline_changes_nothing() {
  for (int i = 0; i < PET_USB_REQUEST_VECTOR_COUNT; ++i) {
    const PetUsbRequestVector& row = PET_USB_REQUEST_VECTORS[i];
    if (std::strlen(row.line) >= PET_USB_MAX_LINE) {
      continue;  // the carriage return would be the byte that makes it too long
    }
    UsbEndpoint plain;
    UsbEndpoint crlf;
    UsbPolicy policy;
    policy.paired = row.paired;
    policy.busy = row.busy;
    UsbInbound a;
    UsbInbound b;
    const int plainEvents = feed(plain, std::string(row.line) + "\n", policy, a);
    const int crlfEvents = feed(crlf, std::string(row.line) + "\r\n", policy, b);
    TEST_ASSERT_EQUAL_INT_MESSAGE(plainEvents, crlfEvents, row.name);
    if (plainEvents > 0) {
      TEST_ASSERT_TRUE_MESSAGE(a.what == b.what, row.name);
      TEST_ASSERT_TRUE_MESSAGE(a.refusal == b.refusal, row.name);
      TEST_ASSERT_TRUE_MESSAGE(a.request.op == b.request.op, row.name);
      TEST_ASSERT_TRUE_MESSAGE(a.request.join.ssid == b.request.join.ssid, row.name);
    }
  }
}

void test_every_golden_reply_is_built_the_way_the_page_expects() {
  for (int i = 0; i < PET_USB_REPLY_VECTOR_COUNT; ++i) {
    const PetUsbReplyVector& row = PET_USB_REPLY_VECTORS[i];
    char out[kUsbReplyCapacity];
    const size_t n = buildReply(row, out, sizeof(out));
    const std::string expected = std::string(row.line) + "\n";
    TEST_ASSERT_EQUAL_UINT_MESSAGE(expected.size(), n, row.name);
    TEST_ASSERT_EQUAL_STRING_MESSAGE(expected.c_str(), out, row.name);
  }
}

void test_a_reply_fits_exactly_and_not_one_byte_less() {
  for (int i = 0; i < PET_USB_REPLY_VECTOR_COUNT; ++i) {
    const PetUsbReplyVector& row = PET_USB_REPLY_VECTORS[i];
    const size_t need = std::strlen(row.line) + 2;  // the newline and the closing zero byte
    char out[kUsbReplyCapacity];
    TEST_ASSERT_TRUE_MESSAGE(need <= kUsbReplyCapacity, row.name);
    TEST_ASSERT_EQUAL_UINT_MESSAGE(need - 1, buildReply(row, out, need), row.name);
    TEST_ASSERT_EQUAL_UINT_MESSAGE(0, buildReply(row, out, need - 1), row.name);
  }
}

// -- The line assembler ------------------------------------------------------------------

void test_a_line_is_held_up_to_512_bytes_and_a_longer_one_is_thrown_away_to_the_newline() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;

  // 512 bytes before the newline: a whole line (an unknown op, the body is one word).
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, std::string(PET_USB_PREFIX) + lineOf(PET_USB_MAX_LINE - PET_USB_PREFIX_LENGTH, 'a') + "\n", idle, last));
  TEST_ASSERT_TRUE(last.refusal == PET_USB_REFUSAL_UNKNOWN_OP);

  // 513: thrown away, answered bad_line, and the next line is read normally.
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, std::string(PET_USB_PREFIX) + lineOf(PET_USB_MAX_LINE - PET_USB_PREFIX_LENGTH + 1, 'a') + "\n", idle, last, kNow + 1));
  TEST_ASSERT_TRUE(last.refusal == PET_USB_REFUSAL_BAD_LINE);
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last, kNow + 2));
  TEST_ASSERT_TRUE(last.what == UsbWhat::Request && last.request.op == PET_USB_OP_HELLO);
}

void test_a_very_long_line_costs_one_answer_and_no_memory_beyond_one_line() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  // 20 KB with the prefix and no newline until the end: one bad_line, nothing else.
  const std::string huge = std::string(PET_USB_PREFIX) + lineOf(20000, 'x') + "\n";
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, huge, idle, last));
  TEST_ASSERT_TRUE(last.refusal == PET_USB_REFUSAL_BAD_LINE);
  // The same without the prefix is not ours: no answer at all.
  TEST_ASSERT_EQUAL_INT(0, feed(endpoint, lineOf(20000, 'x') + "\n", idle, last));
}

void test_a_line_in_pieces_is_the_same_line() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  TEST_ASSERT_EQUAL_INT(0, feed(endpoint, "@pet1 jo", idle, last));
  TEST_ASSERT_EQUAL_INT(0, feed(endpoint, "in 486f6d65 -", idle, last));
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, " K7QXM2PA9T\n", idle, last));
  TEST_ASSERT_TRUE(last.what == UsbWhat::Request && last.request.op == PET_USB_OP_JOIN);
  TEST_ASSERT_EQUAL_STRING("Home", last.request.join.ssid.c_str());
  TEST_ASSERT_TRUE(last.request.join.password.empty());
}

void test_a_new_connection_forgets_a_half_read_line() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  TEST_ASSERT_EQUAL_INT(0, feed(endpoint, "@pet1 sc", idle, last));
  endpoint.reset();
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last));
  TEST_ASSERT_TRUE(last.request.op == PET_USB_OP_HELLO);
}

void test_the_assembler_hands_back_the_line_and_wipes_it_on_request() {
  UsbLineAssembler assembler;
  const char* text = "@pet1 hello";
  UsbPush result = UsbPush::Nothing;
  for (const char* p = text; *p != '\0'; ++p) {
    TEST_ASSERT_TRUE(assembler.push(static_cast<uint8_t>(*p)) == UsbPush::Nothing);
  }
  result = assembler.push('\n');
  TEST_ASSERT_TRUE(result == UsbPush::Line);
  TEST_ASSERT_EQUAL_UINT(std::strlen(text), assembler.length());
  TEST_ASSERT_EQUAL_STRING(text, assembler.line());
  assembler.wipe();
  TEST_ASSERT_EQUAL_UINT8(0, static_cast<uint8_t>(assembler.line()[0]));
}

void test_the_line_after_a_join_is_read_clean() {
  // The join's line holds the password as hex and is wiped once read (UsbEndpoint); the
  // next line must come out as itself, with nothing of the join left in it.
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  const std::string join = "@pet1 join 486f6d65 636f727265637420686f727365 K7QXM2PA9T\n";
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, join, idle, last));
  TEST_ASSERT_EQUAL_STRING("correct horse", last.request.join.password.c_str());
  // The next line starts clean: an empty one is ignored, and a hello is a hello.
  TEST_ASSERT_EQUAL_INT(0, feed(endpoint, "\n", idle, last, kNow + 1));
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last, kNow + 1));
  TEST_ASSERT_TRUE(last.request.op == PET_USB_OP_HELLO);
}

// -- The state rules ---------------------------------------------------------------------

void test_a_paired_pet_allows_hello_and_nothing_else() {
  UsbPolicy paired;
  paired.paired = true;
  PetUsbRefusal why = PET_USB_REFUSAL_BAD_LINE;
  TEST_ASSERT_FALSE(usbRefuses(PET_USB_OP_HELLO, paired, why));
  const PetUsbOp others[] = {PET_USB_OP_SCAN, PET_USB_OP_JOIN, PET_USB_OP_STATUS, PET_USB_OP_CANCEL};
  for (PetUsbOp op : others) {
    why = PET_USB_REFUSAL_BAD_LINE;
    TEST_ASSERT_TRUE(usbRefuses(op, paired, why));
    TEST_ASSERT_TRUE(why == PET_USB_REFUSAL_PAIRED);
  }
  // Busy as well makes no difference: paired comes first.
  paired.busy = true;
  why = PET_USB_REFUSAL_BAD_LINE;
  TEST_ASSERT_TRUE(usbRefuses(PET_USB_OP_SCAN, paired, why));
  TEST_ASSERT_TRUE(why == PET_USB_REFUSAL_PAIRED);
}

void test_a_busy_pet_turns_away_only_scan_and_join() {
  UsbPolicy busy;
  busy.busy = true;
  PetUsbRefusal why = PET_USB_REFUSAL_BAD_LINE;
  TEST_ASSERT_TRUE(usbRefuses(PET_USB_OP_SCAN, busy, why));
  TEST_ASSERT_TRUE(why == PET_USB_REFUSAL_BUSY);
  TEST_ASSERT_TRUE(usbRefuses(PET_USB_OP_JOIN, busy, why));
  TEST_ASSERT_FALSE(usbRefuses(PET_USB_OP_HELLO, busy, why));
  TEST_ASSERT_FALSE(usbRefuses(PET_USB_OP_STATUS, busy, why));
  TEST_ASSERT_FALSE(usbRefuses(PET_USB_OP_CANCEL, busy, why));
  UsbPolicy idle;
  for (int op = 0; op < PET_USB_OP_COUNT; ++op) {
    TEST_ASSERT_FALSE(usbRefuses(static_cast<PetUsbOp>(op), idle, why));
  }
}

void test_a_paired_or_busy_pet_never_reads_the_values_of_a_join() {
  // Values that would be bad_value on an idle pet are answered by the state instead.
  const char* garbage = "@pet1 join zz zz zz";
  UsbPolicy paired;
  paired.paired = true;
  UsbPolicy busy;
  busy.busy = true;
  UsbParse parse = parseUsbLine(garbage, std::strlen(garbage), paired);
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Refused && parse.refusal == PET_USB_REFUSAL_PAIRED);
  parse = parseUsbLine(garbage, std::strlen(garbage), busy);
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Refused && parse.refusal == PET_USB_REFUSAL_BUSY);
  parse = parseUsbLine(garbage, std::strlen(garbage), UsbPolicy());
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Refused && parse.refusal == PET_USB_REFUSAL_BAD_VALUE);
}

void test_a_name_that_is_not_utf8_comes_through_as_the_bytes_the_page_sent() {
  const char* line = "@pet1 join fffe41 68756e7465723232 K7QXM2PA9T";
  const UsbParse parse = parseUsbLine(line, std::strlen(line), UsbPolicy());
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Request);
  TEST_ASSERT_EQUAL_UINT(3, parse.request.join.ssid.size());
  TEST_ASSERT_EQUAL_UINT8(0xff, static_cast<uint8_t>(parse.request.join.ssid[0]));
  TEST_ASSERT_EQUAL_UINT8(0xfe, static_cast<uint8_t>(parse.request.join.ssid[1]));
  TEST_ASSERT_EQUAL_UINT8('A', static_cast<uint8_t>(parse.request.join.ssid[2]));
}

void test_a_byte_that_is_not_printable_ascii_after_the_prefix_is_a_bad_line() {
  const char withNul[] = {'@', 'p', 'e', 't', '1', ' ', 'h', 'e', '\0', 'l', 'o'};
  UsbParse parse = parseUsbLine(withNul, sizeof(withNul), UsbPolicy());
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Refused && parse.refusal == PET_USB_REFUSAL_BAD_LINE);
  // And before the prefix is complete it is simply not ours.
  const char shortPrefix[] = {'@', 'p', 'e', 't', '1'};
  parse = parseUsbLine(shortPrefix, sizeof(shortPrefix), UsbPolicy());
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Ignored);
  parse = parseUsbLine(nullptr, 0, UsbPolicy());
  TEST_ASSERT_TRUE(parse.kind == UsbParseKind::Ignored);
}

// -- The rate limit ----------------------------------------------------------------------

void test_ten_lines_a_second_are_taken_and_the_eleventh_is_not() {
  UsbRateLimit limit;
  for (int i = 0; i < PET_USB_MAX_LINES_PER_SECOND; ++i) {
    TEST_ASSERT_TRUE(limit.allow(5000));
  }
  TEST_ASSERT_FALSE(limit.allow(5000));
  TEST_ASSERT_FALSE(limit.allow(5999));
  // A second after the oldest line the port is open again, for as many lines as left.
  TEST_ASSERT_TRUE(limit.allow(6000));
}

void test_the_limit_is_a_sliding_second_not_a_fixed_one() {
  UsbRateLimit limit;
  // Ten lines spread over the second: one every 100 ms from 0 to 900.
  for (int i = 0; i < PET_USB_MAX_LINES_PER_SECOND; ++i) {
    TEST_ASSERT_TRUE(limit.allow(static_cast<uint32_t>(i * 100)));
  }
  TEST_ASSERT_FALSE(limit.allow(999));  // the line at 0 is not yet a second old
  TEST_ASSERT_TRUE(limit.allow(1000));  // now it is
  TEST_ASSERT_FALSE(limit.allow(1050));  // the line at 100 is not
  TEST_ASSERT_TRUE(limit.allow(1100));
  // Never more than ten in any window of a second: walk a long run and count.
  UsbRateLimit walk;
  std::vector<uint32_t> taken;
  for (uint32_t t = 0; t < 10000; t += 7) {
    if (walk.allow(t)) {
      taken.push_back(t);
    }
  }
  for (size_t i = 0; i + PET_USB_MAX_LINES_PER_SECOND < taken.size(); ++i) {
    TEST_ASSERT_TRUE(taken[i + PET_USB_MAX_LINES_PER_SECOND] - taken[i] >= 1000);
  }
}

void test_the_limit_holds_across_the_wrap_of_the_millisecond_counter() {
  UsbRateLimit limit;
  const uint32_t start = 0xFFFFFFFFu - 100u;
  for (int i = 0; i < PET_USB_MAX_LINES_PER_SECOND; ++i) {
    TEST_ASSERT_TRUE(limit.allow(start));
  }
  TEST_ASSERT_FALSE(limit.allow(start + 500u));  // wrapped past zero, still inside the second
  TEST_ASSERT_TRUE(limit.allow(start + 1000u));
}

void test_the_eleventh_line_in_a_second_is_refused_rate_limited() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  for (int i = 0; i < PET_USB_MAX_LINES_PER_SECOND; ++i) {
    TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last, 2000));
    TEST_ASSERT_TRUE(last.what == UsbWhat::Request);
  }
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last, 2500));
  TEST_ASSERT_TRUE(last.what == UsbWhat::Refusal);
  TEST_ASSERT_EQUAL_STRING("rate_limited", PET_USB_REFUSAL_IDS[last.refusal]);
  // A too-long line counts too, and is answered rate_limited while the port is flooded.
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, std::string(PET_USB_PREFIX) + lineOf(600, 'a') + "\n", idle, last, 2600));
  TEST_ASSERT_EQUAL_STRING("rate_limited", PET_USB_REFUSAL_IDS[last.refusal]);
  // A second later hello works again.
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last, 3000));
  TEST_ASSERT_TRUE(last.what == UsbWhat::Request);
}

void test_lines_that_are_not_ours_do_not_use_up_the_limit() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  for (int i = 0; i < 100; ++i) {
    TEST_ASSERT_EQUAL_INT(0, feed(endpoint, "[pet] wifi up\n", idle, last, 3000));
  }
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1 hello\n", idle, last, 3000));
  TEST_ASSERT_TRUE(last.what == UsbWhat::Request);
}

void test_the_limit_is_checked_before_the_shape_of_the_line() {
  UsbEndpoint endpoint;
  UsbInbound last;
  UsbPolicy idle;
  for (int i = 0; i < PET_USB_MAX_LINES_PER_SECOND; ++i) {
    feed(endpoint, "@pet1 hello\n", idle, last, 4000);
  }
  // A malformed line in a flood is answered rate_limited, not bad_line.
  TEST_ASSERT_EQUAL_INT(1, feed(endpoint, "@pet1  hello\n", idle, last, 4000));
  TEST_ASSERT_EQUAL_STRING("rate_limited", PET_USB_REFUSAL_IDS[last.refusal]);
}

// -- Never echo --------------------------------------------------------------------------

void test_no_reply_can_carry_what_the_page_sent() {
  // A join with a password and a code goes in; nothing the pet can say contains either,
  // in the clear or as hex, because no builder takes them.
  const std::string password = "correct horse";
  const std::string passwordHex = "636f727265637420686f727365";
  const std::string code = "K7QXM2PA9T";
  const std::string codeDashed = "K7QXM-2PA9T";
  for (const std::string& reply : everyReply()) {
    TEST_ASSERT_TRUE_MESSAGE(reply.size() > 0, "a reply was not built");
    TEST_ASSERT_TRUE(reply.find(password) == std::string::npos);
    TEST_ASSERT_TRUE(reply.find(passwordHex) == std::string::npos);
    TEST_ASSERT_TRUE(reply.find("correct") == std::string::npos);
    TEST_ASSERT_TRUE(reply.find(code) == std::string::npos);
    TEST_ASSERT_TRUE(reply.find(codeDashed) == std::string::npos);
    TEST_ASSERT_TRUE(reply.find("K7QXM") == std::string::npos);
  }
}

void test_every_reply_is_a_known_word_followed_by_known_words_and_numbers() {
  const std::string prefix = PET_USB_PREFIX;
  for (const std::string& reply : everyReply()) {
    TEST_ASSERT_TRUE(reply.compare(0, prefix.size(), prefix) == 0);
    TEST_ASSERT_EQUAL_CHAR('\n', reply.back());
    TEST_ASSERT_TRUE(reply.size() < kUsbReplyCapacity);
    const size_t space = reply.find(' ', prefix.size());
    const std::string type = reply.substr(prefix.size(), space - prefix.size());
    TEST_ASSERT_TRUE(indexOf(PET_USB_REPLY_IDS, PET_USB_REPLY_COUNT, type.c_str()) >= 0);
    for (size_t i = 0; i + 1 < reply.size(); ++i) {
      const unsigned char c = static_cast<unsigned char>(reply[i]);
      TEST_ASSERT_TRUE(c >= 0x20 && c <= 0x7e);
    }
  }
}

void test_a_firmware_slot_takes_a_version_and_nothing_else() {
  char out[kUsbReplyCapacity];
  const char* fine[] = {"0.1.0", "1.2.3", "1.2.3-rc.1", "10.20.30+build.5", "0.0.0-a"};
  for (const char* version : fine) {
    TEST_ASSERT_TRUE_MESSAGE(usbHelloLine(out, sizeof(out), PET_KIND_ASTRONAUT, version, false, true) > 0, version);
  }
  // A password, a code, an id, a token, or a version with something after it.
  const char* notVersions[] = {"hunter22",       "correct horse",   "K7QXM2PA9T", "",
                               "0.1",            "0.1.0 extra",     "0.1.0-",     "0.1.0-rc 1",
                               "v0.1.0",         "0.1.0\n",         "1.2.3-rc.1.2.3.4.5.67",  "0b0d0b2e-4a43-4a8e-9a0e-5f3a6c1d7e11",
                               "a.b.c"};
  for (const char* version : notVersions) {
    TEST_ASSERT_EQUAL_UINT_MESSAGE(0, usbHelloLine(out, sizeof(out), PET_KIND_ASTRONAUT, version, false, true), version);
  }
  TEST_ASSERT_EQUAL_UINT(0, usbHelloLine(out, sizeof(out), PET_KIND_ASTRONAUT, nullptr, false, true));
}

void test_a_builder_refuses_an_argument_outside_its_fixed_words() {
  char out[kUsbReplyCapacity];
  TEST_ASSERT_EQUAL_UINT(0, usbHelloLine(out, sizeof(out), static_cast<PetKind>(3), "0.1.0", false, true));
  TEST_ASSERT_EQUAL_UINT(0, usbScanDoneLine(out, sizeof(out), PET_USB_MAX_NETWORKS + 1));
  TEST_ASSERT_EQUAL_UINT(0, usbStateLine(out, sizeof(out), static_cast<PetUsbState>(PET_USB_STATE_COUNT), PET_USB_ERROR_WIFI_FAILED));
  TEST_ASSERT_EQUAL_UINT(0, usbStateLine(out, sizeof(out), static_cast<PetUsbState>(7), PET_USB_ERROR_WIFI_FAILED));
  TEST_ASSERT_EQUAL_UINT(0, usbStateLine(out, sizeof(out), PET_USB_STATE_ERROR, static_cast<PetUsbError>(PET_USB_ERROR_COUNT)));
  TEST_ASSERT_EQUAL_UINT(0, usbRefusedLine(out, sizeof(out), static_cast<PetUsbRefusal>(PET_USB_REFUSAL_COUNT)));
  TEST_ASSERT_EQUAL_UINT(0, usbRefusedLine(out, sizeof(out), static_cast<PetUsbRefusal>(7)));
  // The error code is read only for the error state: a stray value on another state
  // does not turn into a word.
  const size_t n = usbStateLine(out, sizeof(out), PET_USB_STATE_CONFIRM, static_cast<PetUsbError>(99));
  TEST_ASSERT_TRUE(n > 0);
  TEST_ASSERT_EQUAL_STRING("@pet1 state confirm\n", out);
}

void test_a_network_name_must_be_one_the_radio_would_take() {
  char out[kUsbReplyCapacity];
  std::vector<uint8_t> name(33, 'a');
  TEST_ASSERT_EQUAL_UINT(0, usbNetLine(out, sizeof(out), name.data(), 0, -50, true));
  TEST_ASSERT_EQUAL_UINT(0, usbNetLine(out, sizeof(out), name.data(), 33, -50, true));
  TEST_ASSERT_EQUAL_UINT(0, usbNetLine(out, sizeof(out), nullptr, 4, -50, true));
  const uint8_t withControl[] = {'o', 'k', 0x0a};
  TEST_ASSERT_EQUAL_UINT(0, usbNetLine(out, sizeof(out), withControl, sizeof(withControl), -50, true));
  const uint8_t withNul[] = {'o', 0x00, 'k'};
  TEST_ASSERT_EQUAL_UINT(0, usbNetLine(out, sizeof(out), withNul, sizeof(withNul), -50, true));
  // 32 bytes is the most, and it is the longest reply there is.
  TEST_ASSERT_TRUE(usbNetLine(out, sizeof(out), name.data(), 32, -127, true) > 0);
  TEST_ASSERT_EQUAL_UINT(87, std::strlen(out));
  TEST_ASSERT_TRUE(std::strlen(out) < kUsbReplyCapacity);
}

void test_a_signal_strength_is_kept_inside_the_range_the_page_reads() {
  char out[kUsbReplyCapacity];
  const uint8_t name[] = {'A'};
  TEST_ASSERT_TRUE(usbNetLine(out, sizeof(out), name, 1, 12, false) > 0);
  TEST_ASSERT_EQUAL_STRING("@pet1 net 41 0 open\n", out);
  TEST_ASSERT_TRUE(usbNetLine(out, sizeof(out), name, 1, -200, false) > 0);
  TEST_ASSERT_EQUAL_STRING("@pet1 net 41 -127 open\n", out);
  TEST_ASSERT_TRUE(usbNetLine(out, sizeof(out), name, 1, -1, true) > 0);
  TEST_ASSERT_EQUAL_STRING("@pet1 net 41 -1 locked\n", out);
}

void test_a_builder_never_writes_past_the_room_it_was_given() {
  char guarded[kUsbReplyCapacity + 8];
  std::memset(guarded, 0x5a, sizeof(guarded));
  const uint8_t name[] = {'H', 'o', 'm', 'e'};
  // Too small: nothing useful, and nothing beyond cap.
  TEST_ASSERT_EQUAL_UINT(0, usbNetLine(guarded, 12, name, sizeof(name), -42, true));
  for (size_t i = 12; i < sizeof(guarded); ++i) {
    TEST_ASSERT_EQUAL_UINT8(0x5a, static_cast<uint8_t>(guarded[i]));
  }
  TEST_ASSERT_EQUAL_UINT(0, usbRefusedLine(guarded, 0, PET_USB_REFUSAL_PAIRED));
  TEST_ASSERT_EQUAL_UINT(0, usbRefusedLine(nullptr, 40, PET_USB_REFUSAL_PAIRED));
}

// -- The line queue ----------------------------------------------------------------------

void test_the_queue_holds_whole_lines_and_gives_them_back_in_order() {
  LineQueue queue;
  const uint8_t a[] = {'a', 'a', 'a'};
  const uint8_t b[] = {'b', 'b'};
  TEST_ASSERT_TRUE(queue.empty());
  TEST_ASSERT_TRUE(queue.push(a, sizeof(a)));
  TEST_ASSERT_TRUE(queue.push(b, sizeof(b)));
  TEST_ASSERT_EQUAL_UINT(5, queue.size());
  const uint8_t* data = nullptr;
  TEST_ASSERT_EQUAL_UINT(5, queue.front(data));
  TEST_ASSERT_EQUAL_MEMORY("aaabb", data, 5);
  queue.consume(2);
  TEST_ASSERT_EQUAL_UINT(3, queue.front(data));
  TEST_ASSERT_EQUAL_MEMORY("abb", data, 3);
  queue.consume(3);
  TEST_ASSERT_TRUE(queue.empty());
}

void test_a_line_that_does_not_fit_is_dropped_whole_and_leaves_the_rest_alone() {
  LineQueue queue;
  std::vector<uint8_t> big(LineQueue::kCapacity - 10, 'x');
  TEST_ASSERT_TRUE(queue.push(big.data(), big.size()));
  const uint8_t line[] = {'0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X'};  // 11 bytes, room for 10
  TEST_ASSERT_FALSE(queue.push(line, sizeof(line)));
  TEST_ASSERT_EQUAL_UINT(big.size(), queue.size());
  TEST_ASSERT_TRUE(queue.push(line, 10));  // exactly the room left
  TEST_ASSERT_EQUAL_UINT(0, queue.room());
  TEST_ASSERT_FALSE(queue.push(line, 1));
  TEST_ASSERT_FALSE(queue.push(line, 0));
  TEST_ASSERT_FALSE(queue.push(nullptr, 3));
}

void test_the_queue_wraps_and_hands_out_each_run_separately() {
  LineQueue queue;
  std::vector<uint8_t> first(LineQueue::kCapacity - 4, 'a');
  TEST_ASSERT_TRUE(queue.push(first.data(), first.size()));
  queue.consume(first.size() - 2);  // two bytes left, close to the end of the ring
  const uint8_t more[] = {'b', 'b', 'b', 'b', 'b', 'b'};
  TEST_ASSERT_TRUE(queue.push(more, sizeof(more)));
  TEST_ASSERT_EQUAL_UINT(8, queue.size());
  const uint8_t* data = nullptr;
  size_t run = queue.front(data);
  TEST_ASSERT_EQUAL_UINT(6, run);  // 'a' 'a' and four 'b' up to the end of the ring
  TEST_ASSERT_EQUAL_MEMORY("aabbbb", data, 6);
  queue.consume(run);
  run = queue.front(data);
  TEST_ASSERT_EQUAL_UINT(2, run);  // then the rest from the start
  TEST_ASSERT_EQUAL_MEMORY("bb", data, 2);
  queue.consume(run);
  TEST_ASSERT_TRUE(queue.empty());
  TEST_ASSERT_EQUAL_UINT(0, queue.front(data));
}

void test_clearing_the_queue_drops_what_was_waiting_for_a_computer_that_left() {
  LineQueue queue;
  const uint8_t line[] = {'h', 'i', '\n'};
  TEST_ASSERT_TRUE(queue.push(line, sizeof(line)));
  queue.clear();
  TEST_ASSERT_TRUE(queue.empty());
  TEST_ASSERT_EQUAL_UINT(LineQueue::kCapacity, queue.room());
  queue.consume(100);  // more than it holds is harmless
  TEST_ASSERT_TRUE(queue.empty());
}

// -- What the code says -------------------------------------------------------------------

void test_no_log_line_of_the_usb_code_can_name_a_secret() {
  const char* files[] = {"src/net/usb_setup.cpp", "src/core/usb_setup_rules.cpp", "src/core/line_queue.cpp", "src/hw/log.cpp"};
  const char* forbidden[] = {"ssid", "password", "passphrase", "code", "token", "secret", "request", "device id", "deviceid"};
  for (const char* file : files) {
    for (const std::string& call : printCallsIn(sourceOf(file))) {
      const std::string text = lowerCase(call);
      for (const char* word : forbidden) {
        // The generic logger itself passes a caller's format on; it names nothing.
        if (std::strcmp(file, "src/hw/log.cpp") == 0 && text.find("logline(const char* format") != std::string::npos) {
          continue;
        }
        TEST_ASSERT_TRUE_MESSAGE(text.find(word) == std::string::npos, (std::string(file) + ": " + call).c_str());
      }
    }
  }
}

void test_the_setup_status_mirrored_to_the_cable_has_no_place_for_the_page_text_or_the_confirm_code() {
  // The observer's signature is a state and a fixed failure; the setup page's message and
  // the confirm code are arguments of setStatus() that it never forwards.
  const std::string header = sourceOf("src/net/wifi_setup.h");
  TEST_ASSERT_TRUE(header.find("void (*)(void* context, SetupState state, SetupFailure failure)") != std::string::npos);
  const std::string source = sourceOf("src/net/wifi_setup.cpp");
  TEST_ASSERT_TRUE(source.find("observer_(observerContext_, state, failure);") != std::string::npos);
  // And nothing in the USB glue reads the confirm code from the network worker.
  const std::string glue = sourceOf("src/net/usb_setup.cpp");
  TEST_ASSERT_TRUE(glue.find("confirmCode") == std::string::npos);
}

void test_the_port_is_set_up_so_the_computer_cannot_reboot_the_chip() {
  // The board's build has the Arduino core start the port before setup() runs
  // (ARDUINO_USB_CDC_ON_BOOT=1), so the source can only promise that setup() resizes the
  // running port's queue and switches rebooting off before it starts the network task,
  // which is what serves the cable. The first milliseconds before that are a known limit.
  const std::string main = sourceOf("src/main.cpp");
  const size_t setup = main.find("void setup() {");
  const size_t loop = main.find("void loop() {");
  const size_t tasks = main.find("net->start()");
  const size_t buffer = main.find("Serial.setRxBufferSize(1024);");
  const size_t begin = main.find("Serial.begin(115200);");
  const size_t reboot = main.find("Serial.enableReboot(false);");
  TEST_ASSERT_TRUE(setup != std::string::npos && loop != std::string::npos && tasks != std::string::npos);
  TEST_ASSERT_TRUE(buffer != std::string::npos && begin != std::string::npos && reboot != std::string::npos);
  TEST_ASSERT_TRUE(setup < loop && setup < tasks && tasks < loop);
  for (const size_t call : {buffer, begin, reboot}) {
    TEST_ASSERT_TRUE(call > setup && call < tasks);
  }
  TEST_ASSERT_TRUE(main.find("enableReboot(true)") == std::string::npos);
}

void test_the_microphone_stops_without_waiting_for_the_audio_task() {
  // Mic::pump() holds the lock while it waits for the receiver and takes it again at
  // once; stop() must drop the flag before it asks for the lock, or the main loop
  // waits for ever with the microphone on (found on a bare Nano ESP32).
  const std::string mic = sourceOf("src/audio/mic.cpp");
  const size_t stop = mic.find("Recording Mic::stop() {");
  TEST_ASSERT_TRUE(stop != std::string::npos);
  const size_t flag = mic.find("recording_.exchange(false", stop);
  const size_t lock = mic.find("xSemaphoreTake(mutex_", stop);
  TEST_ASSERT_TRUE(flag != std::string::npos && lock != std::string::npos);
  TEST_ASSERT_TRUE(flag < lock);
  // The receive channel is made once, in begin(), never per recording.
  const size_t begin = mic.find("bool Mic::begin() {");
  const size_t made = mic.find("i2s_new_channel(");
  TEST_ASSERT_TRUE(begin != std::string::npos && made != std::string::npos);
  TEST_ASSERT_TRUE(made > begin && made < mic.find("void Mic::setIndicator"));
  TEST_ASSERT_TRUE(mic.find("i2s_new_channel(", made + 1) == std::string::npos);
}

void test_i2s_channels_are_made_with_psram_held() {
  // On this core a small MALLOC_CAP_DEFAULT allocation lands in PSRAM, and the I2S
  // driver's DMA interrupt refuses a context there: every start failed until the
  // channels were made inside withPsramHeld (hw/internal_alloc.h).
  const std::string mic = sourceOf("src/audio/mic.cpp");
  const std::string speaker = sourceOf("src/audio/speaker.cpp");
  TEST_ASSERT_TRUE(mic.find("withPsramHeld(") != std::string::npos);
  const size_t held = speaker.find("withPsramHeld(");
  const size_t begin = speaker.find("i2s_.begin(");
  TEST_ASSERT_TRUE(held != std::string::npos && begin != std::string::npos && held < begin);
}

void test_the_serial_port_is_written_only_by_the_log_queue_and_the_protocol_reads_it_only_there() {
  // Serial.write() spins until the computer reads: only hw/log.cpp may call it, and
  // only with what availableForWrite() reported.
  const char* files[] = {"src/main.cpp",           "src/net/usb_setup.cpp", "src/net/net_worker.cpp", "src/net/wifi_setup.cpp",
                         "src/net/api.cpp",        "src/audio/mic.cpp",     "src/store/voicepack.cpp", "src/store/note_store_fs.cpp"};
  for (const char* file : files) {
    const std::string source = sourceOf(file);
    TEST_ASSERT_TRUE_MESSAGE(source.find("Serial.write") == std::string::npos, file);
    TEST_ASSERT_TRUE_MESSAGE(source.find("Serial.print") == std::string::npos, file);
  }
  const std::string log = sourceOf("src/hw/log.cpp");
  TEST_ASSERT_TRUE(log.find("Serial.availableForWrite()") != std::string::npos);
  TEST_ASSERT_TRUE(log.find("run = static_cast<size_t>(room);") != std::string::npos);
  TEST_ASSERT_TRUE(log.find("Serial.setDebugOutput") == std::string::npos);
}

void test_the_pet_image_has_no_dfu_interface_so_nothing_on_the_computer_can_replace_it() {
  // The board turns its in-app DFU on with -DARDUINO_USB_DFU_ON_BOOT=1; with it any
  // program on the computer, or a page with a WebUSB grant, writes a new image into the
  // next slot with no button pressed. The pet's environment takes it out, and the
  // environments that extend it (the first-flash one) inherit that.
  const std::string ini = sourceOf("platformio.ini");
  const size_t section = ini.find("[env:nano_esp32]");
  TEST_ASSERT_TRUE(section != std::string::npos);
  const size_t next = ini.find("\n[", section + 1);
  const std::string pet = ini.substr(section, next == std::string::npos ? std::string::npos : next - section);
  const size_t unflag = pet.find("-DARDUINO_USB_DFU_ON_BOOT=1");
  const size_t flag = pet.find("-DARDUINO_USB_DFU_ON_BOOT=0");
  TEST_ASSERT_TRUE(unflag != std::string::npos && flag != std::string::npos);
  TEST_ASSERT_TRUE(pet.find("build_unflags") < unflag);
  TEST_ASSERT_TRUE(pet.find("build_flags") < flag);
  // Nowhere else is it switched on: every other mention is a comment or the unflag line.
  std::string key;
  std::stringstream lines(ini);
  for (std::string line; std::getline(lines, line);) {
    if (!line.empty() && line[0] != ' ' && line[0] != ';' && line.find('=') != std::string::npos) {
      key = line.substr(0, line.find(' '));
    }
    if (line.find("ARDUINO_USB_DFU_ON_BOOT=1") != std::string::npos && line[0] != ';') {
      TEST_ASSERT_EQUAL_STRING("build_unflags", key.c_str());
    }
  }
  TEST_ASSERT_TRUE(sourceOf("src/main.cpp").find("enableDFU") == std::string::npos);
}

void test_a_cancel_from_the_cable_ends_only_a_try_that_the_cable_started() {
  // The computer's page mirrors the states of a try the phone started, and its Stop sends
  // cancel; the pet must not end the phone's try for it. The cable's cancel is read in one
  // place, which looks at who started the try, and both waits in a try go through it.
  const std::string worker = sourceOf("src/net/net_worker.cpp");
  TEST_ASSERT_TRUE(worker.find("bool NetWorker::cableStops(TrySource source) {") != std::string::npos);
  TEST_ASSERT_TRUE(worker.find("return asked && source == TrySource::Usb;") != std::string::npos);
  TEST_ASSERT_TRUE(worker.find("bool NetWorker::claimToken(const PairOut& pairOut, TrySource source) {") != std::string::npos);
  TEST_ASSERT_TRUE(worker.find("claimToken(pairOut, source)") != std::string::npos);
  size_t uses = 0;
  for (size_t at = worker.find("cableStops(source)"); at != std::string::npos; at = worker.find("cableStops(source)", at + 1)) {
    ++uses;
  }
  TEST_ASSERT_EQUAL_UINT32(2, uses);  // the join wait and the claim wait
  // And no other code takes the cancel for a try: the one bare read is the stale cancel
  // of an earlier try, thrown away as a new try starts, and the one inside cableStops.
  size_t takes = 0;
  for (size_t at = worker.find("usb_.takeCancel()"); at != std::string::npos; at = worker.find("usb_.takeCancel()", at + 1)) {
    ++takes;
  }
  TEST_ASSERT_EQUAL_UINT32(2, takes);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_every_golden_request_is_read_the_way_the_page_says);
  RUN_TEST(test_a_carriage_return_before_the_newline_changes_nothing);
  RUN_TEST(test_every_golden_reply_is_built_the_way_the_page_expects);
  RUN_TEST(test_a_reply_fits_exactly_and_not_one_byte_less);
  RUN_TEST(test_a_line_is_held_up_to_512_bytes_and_a_longer_one_is_thrown_away_to_the_newline);
  RUN_TEST(test_a_very_long_line_costs_one_answer_and_no_memory_beyond_one_line);
  RUN_TEST(test_a_line_in_pieces_is_the_same_line);
  RUN_TEST(test_a_new_connection_forgets_a_half_read_line);
  RUN_TEST(test_the_assembler_hands_back_the_line_and_wipes_it_on_request);
  RUN_TEST(test_the_line_after_a_join_is_read_clean);
  RUN_TEST(test_a_paired_pet_allows_hello_and_nothing_else);
  RUN_TEST(test_a_busy_pet_turns_away_only_scan_and_join);
  RUN_TEST(test_a_paired_or_busy_pet_never_reads_the_values_of_a_join);
  RUN_TEST(test_a_name_that_is_not_utf8_comes_through_as_the_bytes_the_page_sent);
  RUN_TEST(test_a_byte_that_is_not_printable_ascii_after_the_prefix_is_a_bad_line);
  RUN_TEST(test_ten_lines_a_second_are_taken_and_the_eleventh_is_not);
  RUN_TEST(test_the_limit_is_a_sliding_second_not_a_fixed_one);
  RUN_TEST(test_the_limit_holds_across_the_wrap_of_the_millisecond_counter);
  RUN_TEST(test_the_eleventh_line_in_a_second_is_refused_rate_limited);
  RUN_TEST(test_lines_that_are_not_ours_do_not_use_up_the_limit);
  RUN_TEST(test_the_limit_is_checked_before_the_shape_of_the_line);
  RUN_TEST(test_no_reply_can_carry_what_the_page_sent);
  RUN_TEST(test_every_reply_is_a_known_word_followed_by_known_words_and_numbers);
  RUN_TEST(test_a_firmware_slot_takes_a_version_and_nothing_else);
  RUN_TEST(test_a_builder_refuses_an_argument_outside_its_fixed_words);
  RUN_TEST(test_a_network_name_must_be_one_the_radio_would_take);
  RUN_TEST(test_a_signal_strength_is_kept_inside_the_range_the_page_reads);
  RUN_TEST(test_a_builder_never_writes_past_the_room_it_was_given);
  RUN_TEST(test_the_queue_holds_whole_lines_and_gives_them_back_in_order);
  RUN_TEST(test_a_line_that_does_not_fit_is_dropped_whole_and_leaves_the_rest_alone);
  RUN_TEST(test_the_queue_wraps_and_hands_out_each_run_separately);
  RUN_TEST(test_clearing_the_queue_drops_what_was_waiting_for_a_computer_that_left);
  RUN_TEST(test_no_log_line_of_the_usb_code_can_name_a_secret);
  RUN_TEST(test_the_setup_status_mirrored_to_the_cable_has_no_place_for_the_page_text_or_the_confirm_code);
  RUN_TEST(test_the_port_is_set_up_so_the_computer_cannot_reboot_the_chip);
  RUN_TEST(test_the_microphone_stops_without_waiting_for_the_audio_task);
  RUN_TEST(test_i2s_channels_are_made_with_psram_held);
  RUN_TEST(test_the_serial_port_is_written_only_by_the_log_queue_and_the_protocol_reads_it_only_there);
  RUN_TEST(test_the_pet_image_has_no_dfu_interface_so_nothing_on_the_computer_can_replace_it);
  RUN_TEST(test_a_cancel_from_the_cable_ends_only_a_try_that_the_cable_started);
  return UNITY_END();
}
