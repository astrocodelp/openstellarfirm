#pragma once

// pet-usb v1, the pet's side: the small line protocol OpenStellarFirm web speaks to a
// pet over its data USB cable while the person sets it up (Web Serial in Chrome or
// Edge). The page sends the Wi-Fi name, the Wi-Fi password and the setup code it made;
// from there the pet joins the Wi-Fi, asks OpenStellarFirm to pair over HTTPS and speaks
// its confirm code, exactly as it does for the setup network. This file is the whole
// wire, with no Arduino header so it is tested on the computer; net/usb_setup.cpp
// only moves bytes between it and the port. The words, the limits and the golden
// lines come from the same generator as the page's side (src/shared/pets/usb.ts,
//  generated/protocol.h and generated/usb_vectors.h), and test_usb_setup
// runs every golden line through the code below.
//
//   page to pet:  hello | scan | status | cancel
//                 join <ssidHex> <passwordHex or -> <setupCode>
//   pet to page:  hello <version> <kind> <firmware> paired|unpaired open|closed
//                 net <ssidHex> <rssi> open|locked
//                 scan-done <count>
//                 state joining|pairing|confirm|done
//                 state error <code>
//                 refused <reason>
//
// A line is "@pet1 ", space separated tokens and a newline, at most PET_USB_MAX_LINE
// bytes before the newline; a longer one is thrown away up to the newline. The Wi-Fi
// name and password travel as lower case hex. The pet checks a line in this order: no
// prefix (no reply), the rate limit, the shape (bad_line), the op (unknown_op), the
// state (paired, busy), then the values (bad_value). A paired pet answers only hello
// and never looks at the values of anything else.
//
// Never across the cable, in either direction: the device token, the device secret,
// the device id, a request id or a URL with an id, the confirm code, an echo of the
// Wi-Fi password or the setup code, the setup passphrase, audio, notes and
// transcripts. The state "confirm" only means "listen to your pet". The reply
// builders below take only enums, counts, a network name from a scan and a figure's
// version string, and check every slot against the fixed words, so there is no
// argument a password, a code or an id could be passed in (never-echo by
// construction); test_usb_setup pins it.

#include <cstddef>
#include <cstdint>
#include <string>

#include "generated/protocol.h"

namespace pet {

// What the pet knows about itself when a line arrives.
struct UsbPolicy {
  bool paired = false;  // a paired pet answers hello and nothing else
  bool busy = false;    // a setup try is running (or a join is waiting): no scan or join
};

// Whether the pet turns this op away in this state, before it looks at any value.
// False when the op is allowed; otherwise `why` is paired or busy.
bool usbRefuses(PetUsbOp op, UsbPolicy policy, PetUsbRefusal& why);

// -- Lines in --------------------------------------------------------------------------

// Whether a line starts with "@pet1 ". A line that does not is not ours (the serial
// monitor, a stray byte) and gets no reply and no count against the rate limit.
bool usbHasPrefix(const char* line, size_t length);

enum class UsbPush : uint8_t {
  Nothing,   // the line is not finished
  Line,      // a whole line is ready: line() and length()
  Overflow,  // a line was longer than PET_USB_MAX_LINE and has now been thrown away
};

// Puts lines back together from bytes, one at a time. At most PET_USB_MAX_LINE bytes
// are held; the byte after that starts a discard up to the next newline, so a long
// line never costs more memory than one line's worth.
class UsbLineAssembler {
 public:
  UsbPush push(uint8_t byte);

  // After Line: the bytes before the newline (one carriage return before it dropped),
  // followed by a zero byte. Valid until the next push, reset or wipe.
  const char* line() const { return buffer_; }
  size_t length() const { return lineLength_; }

  // After Overflow: whether the line thrown away began with the prefix (it is then
  // answered bad_line; one without is not ours and gets no answer).
  bool overflowPrefixed() const { return overflowPrefixed_; }

  // Forgets a half-read line, for a new connection.
  void reset();

  // Zeroes the buffer. The line of a join holds the Wi-Fi password in hex, so it is
  // wiped as soon as it has been read.
  void wipe();

 private:
  char buffer_[PET_USB_MAX_LINE + 1] = {0};
  size_t held_ = 0;  // bytes of the line being read
  size_t lineLength_ = 0;
  bool discarding_ = false;
  bool overflowPrefixed_ = false;
};

// What a join asks for, already checked with the same rules as the setup page
// (core/text_rules.h): a name of 1 to 32 bytes with no control character (any other
// byte is fine, so a name that is not UTF-8 works), a password of 8 to 63 printable
// characters or 64 hex digits (empty for an open network), and the normalized
// ten-character setup code.
struct UsbJoin {
  std::string ssid;
  std::string password;
  std::string code;
};

struct UsbRequest {
  PetUsbOp op = PET_USB_OP_HELLO;
  UsbJoin join;  // only for PET_USB_OP_JOIN
};

enum class UsbParseKind : uint8_t {
  Ignored,  // not a pet-usb line: no reply
  Request,
  Refused,
};

struct UsbParse {
  UsbParseKind kind = UsbParseKind::Ignored;
  PetUsbRefusal refusal = PET_USB_REFUSAL_BAD_LINE;  // Refused
  UsbRequest request;                                // Request
};

// What the pet makes of one line (the bytes before the newline). Everything but the
// rate limit, which needs a clock and is UsbRateLimit's.
UsbParse parseUsbLine(const char* line, size_t length, UsbPolicy policy);

// At most PET_USB_MAX_LINES_PER_SECOND lines in any one second: a computer that floods
// the port gets "refused rate_limited" and costs the pet nothing more. The time is
// passed in (milliseconds from any steady clock; the wrap of the counter is fine), so
// the tests are deterministic. A refused line is not counted, so the port is open
// again one second after the oldest line that was taken.
class UsbRateLimit {
 public:
  bool allow(uint32_t nowMs);

 private:
  uint32_t taken_[PET_USB_MAX_LINES_PER_SECOND] = {0};
  uint8_t count_ = 0;  // lines held in taken_
  uint8_t next_ = 0;   // the oldest of them
};

// What came out of the bytes so far.
enum class UsbWhat : uint8_t {
  Nothing,
  Request,  // `request` is a line the pet should act on
  Refusal,  // `refusal` is what to answer, with refused <reason>
};

struct UsbInbound {
  UsbWhat what = UsbWhat::Nothing;
  PetUsbRefusal refusal = PET_USB_REFUSAL_BAD_LINE;
  UsbRequest request;
};

// The whole inbound side: bytes in, then a request to act on or a refusal to send. The
// firmware and the tests drive this one class, so what the golden lines check is what
// runs on the pet.
class UsbEndpoint {
 public:
  // Feeds one byte. True when `out` now holds a request or a refusal. `policy` is the
  // pet's state when a line is completed (it can change between two lines).
  bool push(uint8_t byte, uint32_t nowMs, UsbPolicy policy, UsbInbound& out);

  // A new connection: forgets a half-read line.
  void reset() { assembler_.reset(); }

 private:
  UsbLineAssembler assembler_;
  UsbRateLimit limit_;
};

// -- Lines out -------------------------------------------------------------------------

// Room for any reply, with its newline and a closing zero byte (the longest, a net
// line with a 32-byte name, is 87 bytes).
constexpr size_t kUsbReplyCapacity = 96;

// Each builder writes "@pet1 ...", a newline and a closing zero byte to `out` and
// returns the length without the zero byte, or 0 (and writes nothing useful) when an
// argument is not allowed or `cap` is too small. Nothing but fixed words and numbers
// is ever put in a line.

// hello: `firmware` must have the shape of a version ("0.1.0", "1.2.3-rc.1"), at most
// PET_USB_FIRMWARE_MAX_CHARS characters, which is also what keeps any other text out.
size_t usbHelloLine(char* out, size_t cap, PetKind kind, const char* firmware, bool paired, bool setupOpen);

// net: one network a scan found. The name is its raw bytes (1 to 32, no control
// character) and goes out as hex; `rssi` is clamped to 0 .. -127.
size_t usbNetLine(char* out, size_t cap, const uint8_t* ssid, size_t ssidLength, int rssi, bool locked);

// scan-done: how many net lines were sent, 0 to PET_USB_MAX_NETWORKS.
size_t usbScanDoneLine(char* out, size_t cap, size_t count);

// state: where a setup try stands. `error` is read only for PET_USB_STATE_ERROR.
size_t usbStateLine(char* out, size_t cap, PetUsbState state, PetUsbError error);

// refused: why a line was not acted on.
size_t usbRefusedLine(char* out, size_t cap, PetUsbRefusal reason);

}  // namespace pet
