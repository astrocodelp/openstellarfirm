// The text rules of the setup page and the network code: what is escaped into
// HTML, what the owner typed as a setup code, the pet's own network name, the
// recording time stamp and the pairing greeting.
#include <unity.h>

#include <cstring>
#include <string>

#include "core/text_rules.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

void test_html_escape_neutralizes_markup() {
  TEST_ASSERT_EQUAL_STRING("Home Wi-Fi", htmlEscape("Home Wi-Fi").c_str());
  TEST_ASSERT_EQUAL_STRING("&lt;script&gt;alert(1)&lt;/script&gt;", htmlEscape("<script>alert(1)</script>").c_str());
  TEST_ASSERT_EQUAL_STRING("Tom &amp; Jerry&#39;s &quot;net&quot;", htmlEscape("Tom & Jerry's \"net\"").c_str());
  TEST_ASSERT_EQUAL_STRING("&amp;lt;", htmlEscape("&lt;").c_str());
  TEST_ASSERT_EQUAL_STRING("", htmlEscape("").c_str());
}

void test_html_escape_leaves_nothing_that_can_close_an_attribute_or_a_tag() {
  const std::string hostile = "\"><img src=x onerror=alert(1)>'";
  const std::string out = htmlEscape(hostile);
  TEST_ASSERT_TRUE(out.find('<') == std::string::npos);
  TEST_ASSERT_TRUE(out.find('>') == std::string::npos);
  TEST_ASSERT_TRUE(out.find('"') == std::string::npos);
  TEST_ASSERT_TRUE(out.find('\'') == std::string::npos);
}

void test_html_escape_writes_control_characters_as_references_and_keeps_utf8() {
  TEST_ASSERT_EQUAL_STRING("a&#10;b&#9;c&#127;", htmlEscape("a\nb\tc\x7f").c_str());
  const std::string withNul = htmlEscape(std::string("a\0b", 3));
  TEST_ASSERT_EQUAL_STRING("a&#0;b", withNul.c_str());
  // Café: the two bytes of the e-acute pass through untouched.
  const std::string cafe = htmlEscape("Caf\xC3\xA9");
  TEST_ASSERT_EQUAL_INT(5, cafe.size());
  TEST_ASSERT_EQUAL_UINT8(0xC3, static_cast<uint8_t>(cafe[3]));
}

void test_a_typed_setup_code_is_cleaned() {
  std::string out;
  TEST_ASSERT_TRUE(normalizeSetupCode("K7QXM-2PA9T", out));
  TEST_ASSERT_EQUAL_STRING("K7QXM2PA9T", out.c_str());
  TEST_ASSERT_TRUE(normalizeSetupCode("  k7qxm 2pa9t  ", out));
  TEST_ASSERT_EQUAL_STRING("K7QXM2PA9T", out.c_str());
  TEST_ASSERT_TRUE(normalizeSetupCode("k7qxm-2pa9t\n", out));
  TEST_ASSERT_EQUAL_STRING("K7QXM2PA9T", out.c_str());
}

void test_a_wrong_setup_code_is_refused_and_leaves_nothing() {
  std::string out = "left";
  TEST_ASSERT_FALSE(normalizeSetupCode("", out));
  TEST_ASSERT_EQUAL_STRING("", out.c_str());
  TEST_ASSERT_FALSE(normalizeSetupCode("K7QXM-2PA9", out));    // nine characters
  TEST_ASSERT_FALSE(normalizeSetupCode("K7QXM-2PA9TT", out));  // eleven
  // I, L, O, 0 and 1 are not in the alphabet.
  TEST_ASSERT_FALSE(normalizeSetupCode("K7QXM-2PA9I", out));
  TEST_ASSERT_FALSE(normalizeSetupCode("K7QXM-2PA90", out));
  TEST_ASSERT_FALSE(normalizeSetupCode("K7QXM-2PA91", out));
  TEST_ASSERT_FALSE(normalizeSetupCode("LOLOL-OLOLO", out));
  TEST_ASSERT_EQUAL_STRING("", out.c_str());
}

void test_network_names() {
  TEST_ASSERT_TRUE(isPlausibleSsid("Home"));
  TEST_ASSERT_TRUE(isPlausibleSsid(std::string(32, 'x')));
  TEST_ASSERT_TRUE(isPlausibleSsid("Caf\xC3\xA9 Wi-Fi"));
  TEST_ASSERT_FALSE(isPlausibleSsid(""));
  TEST_ASSERT_FALSE(isPlausibleSsid(std::string(33, 'x')));
  TEST_ASSERT_FALSE(isPlausibleSsid("a\nb"));
  TEST_ASSERT_FALSE(isPlausibleSsid(std::string("a\0b", 3)));
  TEST_ASSERT_FALSE(isPlausibleSsid("a\x7f"));
}

void test_passphrases() {
  TEST_ASSERT_TRUE(isPlausiblePassword(""));  // an open network
  TEST_ASSERT_TRUE(isPlausiblePassword("12345678"));
  TEST_ASSERT_TRUE(isPlausiblePassword(std::string(63, 'p')));
  TEST_ASSERT_TRUE(isPlausiblePassword("correct horse battery staple"));
  TEST_ASSERT_FALSE(isPlausiblePassword("1234567"));
  TEST_ASSERT_FALSE(isPlausiblePassword(std::string(65, 'p')));
  TEST_ASSERT_FALSE(isPlausiblePassword("tab\there1"));
  TEST_ASSERT_FALSE(isPlausiblePassword("caf\xC3\xA9-caf\xC3\xA9"));
  // 64 characters is a raw key: hex digits only.
  TEST_ASSERT_TRUE(isPlausiblePassword(std::string(64, 'a')));
  TEST_ASSERT_TRUE(isPlausiblePassword(std::string(64, 'F')));
  TEST_ASSERT_FALSE(isPlausiblePassword(std::string(64, 'g')));
}

void test_the_pets_own_network_name() {
  TEST_ASSERT_EQUAL_STRING("OpenStellarFirm Nova 1A2B", apName(PET_KIND_ASTRONAUT, 0x1A, 0x2B).c_str());
  TEST_ASSERT_EQUAL_STRING("OpenStellarFirm Zib 0009", apName(PET_KIND_ALIEN, 0x00, 0x09).c_str());
  TEST_ASSERT_EQUAL_STRING("OpenStellarFirm Comet FFFF", apName(PET_KIND_CAT, 0xFF, 0xFF).c_str());
  // The name fits a Wi-Fi network name (32 bytes).
  TEST_ASSERT_TRUE(apName(PET_KIND_CAT, 0xFF, 0xFF).size() <= 32);
  // An out-of-range figure falls back to the default one.
  TEST_ASSERT_EQUAL_STRING("OpenStellarFirm Nova 0102", apName(static_cast<PetKind>(9), 0x01, 0x02).c_str());
}

void test_the_recording_time_stamp() {
  char out[21];
  TEST_ASSERT_TRUE(formatIsoUtc(2026, 10, 21, 14, 2, 0, out));
  TEST_ASSERT_EQUAL_STRING("2026-10-21T14:02:00Z", out);
  TEST_ASSERT_EQUAL_INT(20, std::strlen(out));
  TEST_ASSERT_TRUE(formatIsoUtc(2024, 1, 1, 0, 0, 0, out));
  TEST_ASSERT_EQUAL_STRING("2024-01-01T00:00:00Z", out);
  TEST_ASSERT_TRUE(formatIsoUtc(2099, 12, 31, 23, 59, 59, out));
}

void test_a_clock_that_was_not_set_gives_no_time_stamp() {
  char out[21] = "left";
  // The chip starts counting from 1970 until the network time arrives.
  TEST_ASSERT_FALSE(formatIsoUtc(1970, 1, 1, 0, 0, 5, out));
  TEST_ASSERT_EQUAL_STRING("", out);
  TEST_ASSERT_FALSE(formatIsoUtc(2023, 12, 31, 23, 59, 59, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 13, 1, 0, 0, 0, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 0, 1, 0, 0, 0, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 1, 0, 0, 0, 0, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 1, 32, 0, 0, 0, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 1, 1, 24, 0, 0, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 1, 1, 0, 60, 0, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 1, 1, 0, 0, 61, out));
  TEST_ASSERT_FALSE(formatIsoUtc(2026, 1, 1, -1, 0, 0, out));
  TEST_ASSERT_EQUAL_STRING("", out);
}

void test_the_pairing_greeting_is_spotted() {
  TEST_ASSERT_TRUE(isPairingHello("Hi, I'm Nova. Hold my lime light and talk to me."));
  TEST_ASSERT_TRUE(isPairingHello("Hi, I'm Comet the Cat. Hold my lime light and talk to me."));
  TEST_ASSERT_FALSE(isPairingHello(nullptr));
  TEST_ASSERT_FALSE(isPairingHello(""));
  TEST_ASSERT_FALSE(isPairingHello("Hi, I'm . Hold my lime light and talk to me."));
  TEST_ASSERT_FALSE(isPairingHello("Hi! Hold my lime light and talk to me."));
  TEST_ASSERT_FALSE(isPairingHello("Your team has a message for you."));
  TEST_ASSERT_FALSE(isPairingHello("Hi, I'm Nova. Open OpenStellarFirm to read it."));
  TEST_ASSERT_FALSE(isPairingHello("Say: Hi, I'm Nova. Hold my lime light and talk to me."));
}

void test_an_id_key_tells_ids_apart_and_zero_means_none() {
  TEST_ASSERT_EQUAL_UINT32(0, idKey(nullptr));
  TEST_ASSERT_EQUAL_UINT32(0, idKey(""));
  TEST_ASSERT_TRUE(0u != idKey("run_1"));
  TEST_ASSERT_EQUAL_UINT32(idKey("run_1"), idKey("run_1"));
  TEST_ASSERT_TRUE(idKey("run_1") != idKey("run_2"));
  TEST_ASSERT_TRUE(idKey("chat_1") != idKey("run_1"));
  // The ids are compared as they are: no case folding, no trimming.
  TEST_ASSERT_TRUE(idKey("Run_1") != idKey("run_1"));
  TEST_ASSERT_TRUE(idKey("run_1 ") != idKey("run_1"));
  // FNV-1a of "a" is a well known value.
  TEST_ASSERT_EQUAL_UINT32(0xE40C292Cu, idKey("a"));
  // An id longer than the 64 characters the server sends is not an id.
  const std::string sixtyFour(64, 'x');
  const std::string sixtyFive(65, 'x');
  TEST_ASSERT_TRUE(0u != idKey(sixtyFour.c_str()));
  TEST_ASSERT_EQUAL_UINT32(0, idKey(sixtyFive.c_str()));
  // A uuid, the usual shape of an id, gives a key.
  TEST_ASSERT_TRUE(0u != idKey("0b0d0b2e-4a43-4a8e-9a0e-5f3a6c1d7e11"));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_html_escape_neutralizes_markup);
  RUN_TEST(test_html_escape_leaves_nothing_that_can_close_an_attribute_or_a_tag);
  RUN_TEST(test_html_escape_writes_control_characters_as_references_and_keeps_utf8);
  RUN_TEST(test_a_typed_setup_code_is_cleaned);
  RUN_TEST(test_a_wrong_setup_code_is_refused_and_leaves_nothing);
  RUN_TEST(test_network_names);
  RUN_TEST(test_passphrases);
  RUN_TEST(test_the_pets_own_network_name);
  RUN_TEST(test_the_recording_time_stamp);
  RUN_TEST(test_a_clock_that_was_not_set_gives_no_time_stamp);
  RUN_TEST(test_the_pairing_greeting_is_spotted);
  RUN_TEST(test_an_id_key_tells_ids_apart_and_zero_means_none);
  return UNITY_END();
}
