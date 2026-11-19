// The computer a pet talks to and the pin that says it is the right one
// (core/server_pin.h): the values the cable carries, the comparison of a certificate's
// SHA-256, what a certificate at each depth of a chain is given, how a call's address is
// written and the name the mDNS fallback asks for.
#include <unity.h>

#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "core/api_rules.h"
#include "core/server_pin.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

const char* const kHex = "a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718a1b2c3d4e5f60718";

std::string sourceOf(const char* relative) {
  std::ifstream file(relative);
  TEST_ASSERT_TRUE_MESSAGE(file.good(), relative);
  std::stringstream text;
  text << file.rdbuf();
  return text.str();
}

}  // namespace

void test_an_ipv4_address_is_four_plain_numbers() {
  const char* good[] = {"0.0.0.0", "192.168.1.20", "10.0.0.1", "255.255.255.255", "1.2.3.4"};
  for (const char* text : good) {
    TEST_ASSERT_TRUE_MESSAGE(isIpv4Address(text), text);
  }
  const char* bad[] = {"",         "1.2.3",       "1.2.3.4.5", "1.2.3.",     ".1.2.3",       "192.168.01.20", "192.168.1.256",
                       "1.2.3.-4", "1.2.3.4 ",    " 1.2.3.4",  "1..2.3",     "a.b.c.d",      "1.2.3.4a",      "1.2.3.1000",
                       "0x1.2.3.4", "1.2.3.00",   "computer.local", "[1.2.3.4]", "1.2.3.4:80", "01.2.3.4"};
  for (const char* text : bad) {
    TEST_ASSERT_FALSE_MESSAGE(isIpv4Address(text), text);
  }
}

void test_an_ipv6_address_is_lowercase_hex_groups_with_at_most_one_double_colon() {
  const char* good[] = {"fd12:3456:789a::1", "fd12:3456:789a:1:2:3:4:5", "::1", "::", "1::", "fe80::1", "1:2:3:4:5:6:7::",
                        "::2:3:4:5:6:7:8", "2001:db8::ff00:42:8329"};
  for (const char* text : good) {
    TEST_ASSERT_TRUE_MESSAGE(isIpv6Address(text), text);
  }
  const char* bad[] = {"",
                       ":",
                       "FD12::1",
                       "fe80::1%en0",
                       "1:2:3:4:5:6:7",
                       "1:2:3:4:5:6:7:8:9",
                       "1::2::3",
                       ":::",
                       "1:::2",
                       "12345::1",
                       "g::1",
                       ":1:2:3:4:5:6:7",
                       "1:2:3:4:5:6:7:",
                       "1::2:",
                       "[fd12::1]",
                       "::ffff:1.2.3.4",
                       "1:2:3:4:5:6:7:8::",
                       "1:2:3:4::5:6:7:8",
                       "fd12::1 ",
                       "192.168.1.20"};
  for (const char* text : bad) {
    TEST_ASSERT_FALSE_MESSAGE(isIpv6Address(text), text);
  }
}

void test_the_computers_name_is_osf_eight_hex_digits_dot_local() {
  TEST_ASSERT_TRUE(isServerName("osf-3fa91c0d.local"));
  TEST_ASSERT_TRUE(isServerName("osf-00000000.local"));
  const char* bad[] = {"",
                       "osf-3fa91c0.local",
                       "osf-3fa91c0d1.local",
                       "osf-3FA91C0D.local",
                       "pet-3fa91c0d.local",
                       "osf-3fa91c0d.example.com",
                       "osf-3fa91c0d",
                       "osf-3fa91c0d.local.",
                       "osf-3fa91c0g.local",
                       "xosf-3fa91c0d.local",
                       " osf-3fa91c0d.local",
                       "osf-3fa91c0d.localx"};
  for (const char* text : bad) {
    TEST_ASSERT_FALSE_MESSAGE(isServerName(text), text);
  }
}

void test_a_port_is_one_to_65535_with_no_leading_zero() {
  uint16_t port = 0;
  TEST_ASSERT_TRUE(parseServerPort("1", port));
  TEST_ASSERT_EQUAL_UINT16(1, port);
  TEST_ASSERT_TRUE(parseServerPort("4801", port));
  TEST_ASSERT_EQUAL_UINT16(4801, port);
  TEST_ASSERT_TRUE(parseServerPort("65535", port));
  TEST_ASSERT_EQUAL_UINT16(65535, port);
  port = 9;
  const char* bad[] = {"", "0", "00", "04801", "65536", "70000", "123456", "-1", "+5", "48 1", "48a", "1.5", " 5", "5 "};
  for (const char* text : bad) {
    TEST_ASSERT_FALSE_MESSAGE(parseServerPort(text, port), text);
  }
  TEST_ASSERT_EQUAL_UINT16(9, port);  // untouched by a refusal
}

void test_a_fingerprint_is_64_lowercase_hex_digits_and_nothing_else() {
  uint8_t pin[kPinBytes];
  TEST_ASSERT_TRUE(parseFingerprint(kHex, std::strlen(kHex), pin));
  TEST_ASSERT_EQUAL_UINT8(0xa1, pin[0]);
  TEST_ASSERT_EQUAL_UINT8(0xb2, pin[1]);
  TEST_ASSERT_EQUAL_UINT8(0x18, pin[7]);
  TEST_ASSERT_EQUAL_UINT8(0x18, pin[31]);
  char hex[kPinHexChars + 1];
  fingerprintToHex(pin, hex);
  TEST_ASSERT_EQUAL_STRING(kHex, hex);

  const std::string good = kHex;
  const std::string bad[] = {good.substr(1),
                             good + "0",
                             "",
                             std::string(64, 'A'),
                             std::string(64, 'g'),
                             "A" + good.substr(1),
                             good.substr(0, 63) + " ",
                             good.substr(0, 63) + "\n",
                             std::string(kPinHexChars, '-')};
  for (const std::string& text : bad) {
    uint8_t out[kPinBytes];
    std::memset(out, 0x55, sizeof(out));
    TEST_ASSERT_FALSE_MESSAGE(parseFingerprint(text.c_str(), text.size(), out), text.c_str());
    // A refusal leaves no half-read pin behind.
    for (size_t i = 0; i < kPinBytes; ++i) {
      TEST_ASSERT_EQUAL_UINT8(0, out[i]);
    }
  }
  TEST_ASSERT_FALSE(parseFingerprint(nullptr, 64, pin));
  TEST_ASSERT_TRUE(isFingerprintHex(kHex));
  TEST_ASSERT_FALSE(isFingerprintHex(std::string(kHex).substr(1)));
  TEST_ASSERT_FALSE(isFingerprintHex(std::string(64, 'F')));
}

void test_the_pin_comparison_sees_a_difference_in_any_byte_and_any_bit() {
  uint8_t a[kPinBytes];
  uint8_t b[kPinBytes];
  parseFingerprint(kHex, kPinHexChars, a);
  std::memcpy(b, a, kPinBytes);
  TEST_ASSERT_TRUE(pinEqual(a, b));
  TEST_ASSERT_TRUE(pinEqual(a, a));
  for (size_t byte = 0; byte < kPinBytes; ++byte) {
    for (int bit = 0; bit < 8; ++bit) {
      b[byte] = static_cast<uint8_t>(a[byte] ^ (1u << bit));
      TEST_ASSERT_FALSE(pinEqual(a, b));
      b[byte] = a[byte];
    }
  }
  TEST_ASSERT_FALSE(pinEqual(nullptr, b));
  TEST_ASSERT_FALSE(pinEqual(a, nullptr));
  TEST_ASSERT_FALSE(pinEqual(nullptr, nullptr));
}

void test_only_the_first_certificate_is_held_to_the_pin_and_only_when_there_is_one() {
  uint8_t pin[kPinBytes];
  uint8_t other[kPinBytes];
  parseFingerprint(kHex, kPinHexChars, pin);
  std::memcpy(other, pin, kPinBytes);
  other[31] ^= 1;

  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Accept), static_cast<int>(pinAction(0, true, pin, pin)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Reject), static_cast<int>(pinAction(0, true, pin, other)));
  // No pin: every certificate is turned away. A pet that was not told which computer to
  // trust connects to none, whatever the computer shows.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Reject), static_cast<int>(pinAction(0, false, pin, pin)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Reject), static_cast<int>(pinAction(0, false, nullptr, other)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Reject), static_cast<int>(pinAction(0, true, nullptr, pin)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Reject), static_cast<int>(pinAction(0, true, pin, nullptr)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Reject), static_cast<int>(pinAction(-1, true, pin, pin)));
  // A certificate above the first has no opinion of its own.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Pass), static_cast<int>(pinAction(1, true, pin, other)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(PinAction::Pass), static_cast<int>(pinAction(2, false, nullptr, nullptr)));
}

// What a TLS stack that calls pinAction once for each certificate of a chain, the top one
// first and the computer's own last (how mbedtls does it), ends up doing: it connects only
// when the last call accepted, and the first rejection ends it at once.
bool connects(const std::vector<const uint8_t*>& chainTopFirst, bool pinKnown, const uint8_t* pin) {
  bool accepted = false;
  for (size_t i = 0; i < chainTopFirst.size(); ++i) {
    const int depth = static_cast<int>(chainTopFirst.size() - 1 - i);
    const PinAction action = pinAction(depth, pinKnown, pin, chainTopFirst[i]);
    if (action == PinAction::Reject) {
      return false;
    }
    if (action == PinAction::Accept) {
      accepted = true;
    }
  }
  return accepted;
}

void test_a_chain_connects_only_when_the_computers_own_certificate_is_the_pinned_one() {
  uint8_t pin[kPinBytes];
  uint8_t forged[kPinBytes];
  uint8_t ca[kPinBytes];
  parseFingerprint(kHex, kPinHexChars, pin);
  std::memcpy(forged, pin, kPinBytes);
  forged[0] ^= 0x80;
  std::memset(ca, 0x42, sizeof(ca));

  TEST_ASSERT_TRUE(connects({pin}, true, pin));             // the app's own self-signed certificate
  TEST_ASSERT_TRUE(connects({ca, pin}, true, pin));         // the same one behind another certificate
  TEST_ASSERT_FALSE(connects({forged}, true, pin));         // another device on the network
  TEST_ASSERT_FALSE(connects({pin, forged}, true, pin));    // the pinned one as the issuer of a forged leaf
  TEST_ASSERT_FALSE(connects({ca, forged}, true, pin));
  TEST_ASSERT_FALSE(connects({pin}, false, pin));           // no pin: nothing connects
  TEST_ASSERT_FALSE(connects({}, true, pin));               // no certificate at all
  TEST_ASSERT_FALSE(connects({ca}, true, pin));             // an ordinary certificate, never the pin
}

void test_a_calls_address_is_always_https_and_names_the_computer_alone() {
  TEST_ASSERT_EQUAL_STRING("https://192.168.1.20:4801", serverBaseUrl("192.168.1.20", 4801).c_str());
  TEST_ASSERT_EQUAL_STRING("https://[fd12:3456:789a::1]:65535", serverBaseUrl("fd12:3456:789a::1", 65535).c_str());
  TEST_ASSERT_EQUAL_STRING("https://10.0.0.2:1", serverBaseUrl("10.0.0.2", 1).c_str());
  const char* notHosts[] = {"", "computer.local", "192.168.1.20@evil.example", "192.168.1.20/x", "evil.example", "fe80::1%en0",
                            "http://192.168.1.20", "192.168.1.20 ", "[fd12::1]", "192.168.01.20"};
  for (const char* host : notHosts) {
    TEST_ASSERT_EQUAL_STRING_MESSAGE("", serverBaseUrl(host, 4801).c_str(), host);
  }
  TEST_ASSERT_EQUAL_STRING("", serverBaseUrl("192.168.1.20", 0).c_str());
  // What it makes always passes the one https check the client keeps.
  TEST_ASSERT_TRUE(isHttpsBase(serverBaseUrl("192.168.1.20", 4801).c_str()));
  TEST_ASSERT_TRUE(isHttpsBase(serverBaseUrl("fd12::1", 4801).c_str()));
  // And a path joins it with one slash.
  TEST_ASSERT_EQUAL_STRING("https://192.168.1.20:4801/api/pets/heartbeat",
                           joinUrl(serverBaseUrl("192.168.1.20", 4801), "/api/pets/heartbeat").c_str());
}

void test_the_name_is_asked_for_without_its_suffix_and_an_answer_is_a_plain_address() {
  TEST_ASSERT_EQUAL_STRING("osf-3fa91c0d", mdnsHostOf("osf-3fa91c0d.local").c_str());
  TEST_ASSERT_EQUAL_STRING("", mdnsHostOf("computer.local").c_str());
  TEST_ASSERT_EQUAL_STRING("", mdnsHostOf("").c_str());
  TEST_ASSERT_EQUAL_STRING("", mdnsHostOf("osf-3fa91c0d.example.com").c_str());
  const uint8_t bytes[4] = {192, 168, 1, 20};
  TEST_ASSERT_EQUAL_STRING("192.168.1.20", ipv4Text(bytes).c_str());
  const uint8_t edge[4] = {0, 255, 0, 1};
  TEST_ASSERT_EQUAL_STRING("0.255.0.1", ipv4Text(edge).c_str());
  TEST_ASSERT_TRUE(isIpv4Address(ipv4Text(bytes)));
}

void test_the_name_is_asked_only_when_there_is_no_address_or_it_did_not_connect() {
  ServerRecord record;
  record.name = "osf-3fa91c0d.local";
  record.port = 4801;
  // No address: ask at once.
  TEST_ASSERT_TRUE(shouldAskName(record, false));
  TEST_ASSERT_TRUE(shouldAskName(record, true));
  // An address that has not been tried is tried first.
  record.address = "192.168.1.20";
  TEST_ASSERT_FALSE(shouldAskName(record, false));
  TEST_ASSERT_TRUE(shouldAskName(record, true));
  // No name: nothing to ask.
  record.name.clear();
  TEST_ASSERT_FALSE(shouldAskName(record, true));
  record.address.clear();
  TEST_ASSERT_FALSE(shouldAskName(record, true));
}

void test_a_record_is_usable_with_a_name_a_port_and_an_empty_or_real_address() {
  ServerRecord record;
  record.name = "osf-3fa91c0d.local";
  record.port = 4801;
  TEST_ASSERT_TRUE(isUsableServer(record));  // the address is found by name
  record.address = "192.168.1.20";
  TEST_ASSERT_TRUE(isUsableServer(record));
  record.address = "fd12::1";
  TEST_ASSERT_TRUE(isUsableServer(record));
  record.address = "computer.local";
  TEST_ASSERT_FALSE(isUsableServer(record));
  record.address = "192.168.1.20";
  record.port = 0;
  TEST_ASSERT_FALSE(isUsableServer(record));
  record.port = 4801;
  record.name = "pet-3fa91c0d.local";
  TEST_ASSERT_FALSE(isUsableServer(record));
  record.name.clear();
  TEST_ASSERT_FALSE(isUsableServer(record));

  ServerRecord a;
  a.address = "192.168.1.20";
  a.port = 4801;
  a.name = "osf-3fa91c0d.local";
  ServerRecord b = a;
  TEST_ASSERT_TRUE(a == b);
  b.fingerprint[5] = 1;
  TEST_ASSERT_FALSE(a == b);
  b = a;
  b.address = "192.168.1.21";
  TEST_ASSERT_FALSE(a == b);
}

// What the client's source says, for the promises that are about what the code does not
// say: no server address in the build, no certificate bundle, a pin on every connection.
void test_the_client_trusts_no_certificate_authority_and_holds_every_connection_to_the_pin() {
  const std::string api = sourceOf("src/net/api.cpp");
  const std::string header = sourceOf("src/net/api.h");
  const std::string config = sourceOf("include/config.h");
  TEST_ASSERT_TRUE(api.find("PET_API_BASE") == std::string::npos);
  TEST_ASSERT_TRUE(header.find("PET_API_BASE") == std::string::npos);
  TEST_ASSERT_TRUE(config.find("#define PET_API_BASE") == std::string::npos);
  // The public certificate bundle is never what the pet checks the app against.
  TEST_ASSERT_TRUE(api.find("config.crt_bundle_attach = esp_crt_bundle_attach") == std::string::npos);
  TEST_ASSERT_TRUE(api.find("config.crt_bundle_attach = &attachPin;") != std::string::npos);
  TEST_ASSERT_TRUE(api.find("config.skip_cert_common_name_check = true;") != std::string::npos);
  TEST_ASSERT_TRUE(api.find("mbedtls_ssl_conf_verify(") != std::string::npos);
  TEST_ASSERT_TRUE(api.find("MBEDTLS_SSL_VERIFY_REQUIRED") != std::string::npos);
  // Only https, and no redirect that could carry the token elsewhere.
  TEST_ASSERT_TRUE(api.find("config.transport_type = HTTP_TRANSPORT_OVER_SSL;") != std::string::npos);
  TEST_ASSERT_TRUE(api.find("config.disable_auto_redirect = true;") != std::string::npos);
  TEST_ASSERT_TRUE(api.find("http://") == std::string::npos);
  TEST_ASSERT_TRUE(api.find("HTTP_TRANSPORT_OVER_TCP") == std::string::npos);
  // The client reaches no time server and nothing but the computer: no NTP, no other host.
  const std::string wifi = sourceOf("src/net/wifi_setup.cpp");
  TEST_ASSERT_TRUE(wifi.find("configTime") == std::string::npos);
  TEST_ASSERT_TRUE(wifi.find("ntp") == std::string::npos);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_an_ipv4_address_is_four_plain_numbers);
  RUN_TEST(test_an_ipv6_address_is_lowercase_hex_groups_with_at_most_one_double_colon);
  RUN_TEST(test_the_computers_name_is_osf_eight_hex_digits_dot_local);
  RUN_TEST(test_a_port_is_one_to_65535_with_no_leading_zero);
  RUN_TEST(test_a_fingerprint_is_64_lowercase_hex_digits_and_nothing_else);
  RUN_TEST(test_the_pin_comparison_sees_a_difference_in_any_byte_and_any_bit);
  RUN_TEST(test_only_the_first_certificate_is_held_to_the_pin_and_only_when_there_is_one);
  RUN_TEST(test_a_chain_connects_only_when_the_computers_own_certificate_is_the_pinned_one);
  RUN_TEST(test_a_calls_address_is_always_https_and_names_the_computer_alone);
  RUN_TEST(test_the_name_is_asked_for_without_its_suffix_and_an_answer_is_a_plain_address);
  RUN_TEST(test_the_name_is_asked_only_when_there_is_no_address_or_it_did_not_connect);
  RUN_TEST(test_a_record_is_usable_with_a_name_a_port_and_an_empty_or_real_address);
  RUN_TEST(test_the_client_trusts_no_certificate_authority_and_holds_every_connection_to_the_pin);
  return UNITY_END();
}
