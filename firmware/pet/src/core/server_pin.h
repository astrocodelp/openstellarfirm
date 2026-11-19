#pragma once

// The computer the pet talks to, and how the pet knows it is the right one.
//
// The pet does not trust a certificate authority for the app. USB setup hands it the
// computer's address, port, mDNS name and the SHA-256 of the app's own certificate
// (pet-usb v2, core/usb_setup_rules.h); from then on every connection to that computer,
// pairing and claim included, is allowed only when the SHA-256 of the DER certificate the
// computer shows is exactly that fingerprint, checked inside the TLS handshake before a
// single byte of a request, the device token above all, is written (net/api.cpp). This
// file is the part of that which needs no network: the checks of the values the cable
// carries (the same rules as src/shared/pets/usb.ts, so the page and the pet read the
// same words), the constant-time comparison, the decision a certificate gets at each
// depth of the chain, how the address of one call is written, and the name the mDNS
// fallback asks for. It includes no Arduino header, so it is tested on the computer.
//
// Never log a fingerprint, an address or the name with a token next to it: they are not
// secrets (the app's page shows them), but the rule that no log line names what is in a
// request is simpler to keep whole.

#include <cstddef>
#include <cstdint>
#include <string>

namespace pet {

// SHA-256 of the certificate's DER bytes.
constexpr size_t kPinBytes = 32;
// The same as lowercase hex, plus a closing zero byte.
constexpr size_t kPinHexChars = 64;

// -- The values of a `server` line -------------------------------------------------------

// Four decimal numbers 0 to 255, no leading zero ("192.168.1.20").
bool isIpv4Address(const std::string& text);
// A lowercase IPv6 address: groups of one to four hex digits, at most one "::", eight
// groups in all (fewer with "::"). No zone ("%en0"), no dotted tail, no brackets.
bool isIpv6Address(const std::string& text);
// `osf-` and eight lowercase hex digits, then `.local`.
bool isServerName(const std::string& text);
// 1 to 65535, written with no sign and no leading zero.
bool parseServerPort(const std::string& text, uint16_t& out);
// Exactly 64 lowercase hex digits.
bool isFingerprintHex(const std::string& text);

// What the pet keeps about the computer. `address` is the last address that worked: empty
// when the computer gave none (the token "-" on the cable), and then the pet finds it by
// `name`. `fingerprint` is the pin.
struct ServerRecord {
  std::string address;
  uint16_t port = 0;
  uint8_t fingerprint[kPinBytes] = {0};
  std::string name;

  bool operator==(const ServerRecord& other) const;
};

// A record the pet may use: a name of the right shape, a port, and an address that is
// empty or an IPv4 or IPv6 address. (Any fingerprint is a pin; the all-zero one is a
// record that is never matched, which the tests of this file and the devboard use.)
bool isUsableServer(const ServerRecord& record);

// Decodes 64 lowercase hex digits into 32 bytes. False for anything else (upper case,
// another length, a non hex character), leaving `out` zeroed.
bool parseFingerprint(const char* text, size_t length, uint8_t out[kPinBytes]);
// Writes 64 lowercase hex digits and a closing zero byte.
void fingerprintToHex(const uint8_t fingerprint[kPinBytes], char out[kPinHexChars + 1]);

// -- The pin ---------------------------------------------------------------------------

// Whether two 32-byte digests are the same, in time that does not depend on where they
// first differ. Two null pointers are not equal.
bool pinEqual(const uint8_t* a, const uint8_t* b);

// What the TLS stack does with one certificate of the chain the computer showed.
enum class PinAction : uint8_t {
  Pass,    // not the certificate the pin names (a certificate above the first): no opinion
  Accept,  // the first certificate, and it is the pinned one
  Reject,  // the first certificate and it is not, or there is no pin to hold it against
};

// `depth` is the position in the chain: 0 is the certificate the computer presented
// first (its own), which is the only one the pin is about. `leafDigest` is the SHA-256 of
// that certificate's DER bytes. With no pin at all (`pinKnown` false) every certificate at
// depth 0 is rejected: a pet that has not been told which computer to trust connects to
// none.
PinAction pinAction(int depth, bool pinKnown, const uint8_t* expected, const uint8_t* leafDigest);

// -- Where a call goes ------------------------------------------------------------------

// "https://192.168.1.20:4801" or "https://[fd12::1]:4801": always https, never a user
// name, a path or a query. Empty when the host is not an IPv4 or IPv6 address or the port
// is 0.
std::string serverBaseUrl(const std::string& address, uint16_t port);

// The host an mDNS question is asked for: `osf-3fa91c0d.local` without its suffix
// ("osf-3fa91c0d"). Empty for a name that is not a server name.
std::string mdnsHostOf(const std::string& name);

// A host the pet found by asking mDNS for the name, as "a.b.c.d" (four bytes, network
// order, first byte first). Always a well formed IPv4 address.
std::string ipv4Text(const uint8_t bytes[4]);

// Whether the name is worth asking mDNS about: the record has a name, and either it has no
// address (the cable gave none) or the address it has was tried and did not connect.
// `triedAddress` is whether the pet has already made a connection attempt to the address.
bool shouldAskName(const ServerRecord& record, bool triedAddress);

}  // namespace pet
