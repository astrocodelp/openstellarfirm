// Who may use the pet's own setup network (core/setup_access.h): the passphrase it is
// made with and spelled by, the header the setup page adds to its requests, and how
// long the network stays up.
#include <unity.h>

#include <cstring>
#include <string>
#include <vector>

#include "core/setup_access.h"
#include "core/voice_pack.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

std::vector<uint8_t> bytes(std::initializer_list<int> values) {
  std::vector<uint8_t> out;
  for (int v : values) {
    out.push_back(static_cast<uint8_t>(v));
  }
  return out;
}

// A small deterministic byte source for the tests (not for anything real).
struct Lcg {
  uint32_t state;
  uint8_t next() {
    state = state * 1664525u + 1013904223u;
    return static_cast<uint8_t>(state >> 24);
  }
};

}  // namespace

void test_a_passphrase_is_twelve_lower_case_characters_of_the_code_alphabet() {
  Lcg lcg{42};
  std::vector<uint8_t> random;
  for (int i = 0; i < 64; ++i) {
    random.push_back(lcg.next());
  }
  std::string pass;
  TEST_ASSERT_TRUE(makeSetupPassphrase(random.data(), random.size(), pass));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(kSetupPassphraseLength), static_cast<int>(pass.size()));
  TEST_ASSERT_TRUE(kSetupPassphraseLength >= 10);  // at least ten, as the audit asked
  TEST_ASSERT_TRUE(isSetupPassphrase(pass));
  for (char c : pass) {
    TEST_ASSERT_TRUE(!(c >= 'A' && c <= 'Z'));
    const char upper = (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c;
    TEST_ASSERT_TRUE(std::strchr(PET_CODE_ALPHABET, upper) != nullptr);
  }
  // WPA2 needs 8 to 63 characters.
  TEST_ASSERT_TRUE(pass.size() >= 8 && pass.size() <= 63);
}

void test_the_same_bytes_make_the_same_passphrase_and_other_bytes_another() {
  const std::vector<uint8_t> a = bytes({0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13});
  const std::vector<uint8_t> b = bytes({30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18});
  std::string one, two, three;
  TEST_ASSERT_TRUE(makeSetupPassphrase(a.data(), a.size(), one));
  TEST_ASSERT_TRUE(makeSetupPassphrase(a.data(), a.size(), two));
  TEST_ASSERT_TRUE(makeSetupPassphrase(b.data(), b.size(), three));
  TEST_ASSERT_EQUAL_STRING(one.c_str(), two.c_str());
  TEST_ASSERT_TRUE(one != three);
  // Byte 0 is the alphabet's first character, byte 30 its last, in lower case.
  TEST_ASSERT_EQUAL_INT('a', one[0]);
  TEST_ASSERT_EQUAL_INT('9', three[0]);
}

void test_a_byte_above_the_limit_is_turned_away_not_folded_in() {
  // 248 is the largest multiple of 31 that fits a byte. Bytes 248 to 255 would make
  // the first characters likelier, so they are skipped.
  std::vector<uint8_t> random = bytes({255, 254, 253, 252, 251, 250, 249, 248});
  for (int i = 0; i < 12; ++i) {
    random.push_back(static_cast<uint8_t>(i));
  }
  std::string pass;
  TEST_ASSERT_TRUE(makeSetupPassphrase(random.data(), random.size(), pass));
  TEST_ASSERT_EQUAL_STRING("abcdefghjkmn", pass.c_str());
  // Every byte of a long run of a rejected value gives nothing at all.
  const std::vector<uint8_t> all(64, 250);
  TEST_ASSERT_FALSE(makeSetupPassphrase(all.data(), all.size(), pass));
  TEST_ASSERT_EQUAL_INT(0, static_cast<int>(pass.size()));
}

void test_too_few_bytes_give_no_passphrase_and_never_a_short_one() {
  std::string pass = "left over";
  const std::vector<uint8_t> few = bytes({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11});
  TEST_ASSERT_FALSE(makeSetupPassphrase(few.data(), few.size(), pass));
  TEST_ASSERT_TRUE(pass.empty());
  TEST_ASSERT_FALSE(makeSetupPassphrase(nullptr, 64, pass));
  TEST_ASSERT_FALSE(makeSetupPassphrase(few.data(), 0, pass));
}

void test_every_character_is_equally_likely() {
  // The first 240 accepted byte values, taken twelve at a time: byte b makes the
  // alphabet's character b % 31, so the first 23 characters come up eight times and
  // the last 8 seven times, and no character is likelier than that walk makes it.
  std::vector<uint8_t> random;
  for (int v = 0; v < 240; ++v) {
    random.push_back(static_cast<uint8_t>(v));
  }
  int counts[31] = {0};
  for (size_t at = 0; at + 12 <= random.size(); at += 12) {
    std::string pass;
    TEST_ASSERT_TRUE(makeSetupPassphrase(random.data() + at, 12, pass));
    for (char c : pass) {
      const char upper = (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c;
      counts[std::strchr(PET_CODE_ALPHABET, upper) - PET_CODE_ALPHABET] += 1;
    }
  }
  for (int i = 0; i < 31; ++i) {
    TEST_ASSERT_EQUAL_INT(i < 23 ? 8 : 7, counts[i]);
  }
}

void test_a_stored_value_is_a_passphrase_only_if_this_module_could_have_made_it() {
  TEST_ASSERT_TRUE(isSetupPassphrase("abcdefghjkmn"));
  TEST_ASSERT_TRUE(isSetupPassphrase("2345678923ab"));
  TEST_ASSERT_FALSE(isSetupPassphrase(""));
  TEST_ASSERT_FALSE(isSetupPassphrase("abcdefghjkm"));    // eleven
  TEST_ASSERT_FALSE(isSetupPassphrase("abcdefghjkmnp"));  // thirteen
  TEST_ASSERT_FALSE(isSetupPassphrase("ABCDEFGHJKMN"));   // upper case
  TEST_ASSERT_FALSE(isSetupPassphrase("abcdefghjkm1"));   // 1 is not in the alphabet
  TEST_ASSERT_FALSE(isSetupPassphrase("abcdefghjkmo"));   // nor o, l, i, 0
  TEST_ASSERT_FALSE(isSetupPassphrase("abcdefghjkm "));
  TEST_ASSERT_FALSE(isSetupPassphrase(std::string("abcdefghjkm\0", 12)));
}

void test_the_voice_spells_the_passphrase_one_clip_a_character() {
  const char* ids[16];
  const size_t n = spellSetupPassphrase("abcdefghjkmn", ids, 16);
  TEST_ASSERT_EQUAL_INT(12, static_cast<int>(n));
  TEST_ASSERT_EQUAL_STRING("char-A", ids[0]);
  TEST_ASSERT_EQUAL_STRING("char-N", ids[11]);
  const size_t digits = spellSetupPassphrase("2345678923ab", ids, 16);
  TEST_ASSERT_EQUAL_INT(12, static_cast<int>(digits));
  TEST_ASSERT_EQUAL_STRING("char-2", ids[0]);
  TEST_ASSERT_EQUAL_STRING("char-B", ids[11]);
  // Room for the greeting clip in front of it, as main.cpp builds the line: 1 + 12 <= 16.
  TEST_ASSERT_TRUE(1 + kSetupPassphraseLength <= 16);
  // It stops at the room it is given.
  TEST_ASSERT_EQUAL_INT(5, static_cast<int>(spellSetupPassphrase("abcdefghjkmn", ids, 5)));
}

const std::string kAp = "192.168.4.1";

void test_a_request_must_carry_the_pages_own_header() {
  TEST_ASSERT_TRUE(setupRequestAllowed("1", "", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("", "", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("0", "", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("yes", "", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1 ", "", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "", kAp));
  // No known address: nothing is allowed, rather than anything.
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "192.168.4.1", ""));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "", ""));
}

void test_an_origin_must_be_the_pages_own() {
  TEST_ASSERT_TRUE(setupRequestAllowed("1", "http://192.168.4.1", "192.168.4.1", kAp));
  // Another site's page, even one that adds the header, is refused.
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "https://evil.example", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "http://evil.example", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "http://192.168.4.1.evil.example", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "null", "192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "https://192.168.4.1", "192.168.4.1", kAp));
}

void test_a_page_the_setup_dns_rebound_to_the_pet_is_refused() {
  // The setup network's DNS answers every name with the pet, so a page already open
  // on http://evil.example is the pet's own origin once the phone joins: its Host and
  // its Origin agree, and it can add the header with no pre-flight. Only the Host
  // being the pet's address stops it.
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "evil.example", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "http://evil.example", "evil.example", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "http://captive.apple.com", "captive.apple.com", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "http://192.168.4.1.evil.example", "192.168.4.1.evil.example", kAp));
  // A port, a trailing dot or a host that merely starts with the address is another name.
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "192.168.4.1:8080", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "192.168.4.1.", kAp));
  TEST_ASSERT_FALSE(setupRequestAllowed("1", "", "192.168.4.10", kAp));
  // Only the address itself is the pet's.
  TEST_ASSERT_TRUE(setupHostIsAccessPoint("192.168.4.1", kAp));
  TEST_ASSERT_FALSE(setupHostIsAccessPoint("evil.example", kAp));
  TEST_ASSERT_FALSE(setupHostIsAccessPoint("", kAp));
  TEST_ASSERT_FALSE(setupHostIsAccessPoint("", ""));
  TEST_ASSERT_FALSE(setupHostIsAccessPoint("192.168.4.1", ""));
}

void test_any_other_name_is_sent_on_to_the_address() {
  TEST_ASSERT_EQUAL_STRING("http://192.168.4.1/", setupPortalUrl(kAp).c_str());
}

void test_the_setup_network_closes_after_ten_minutes_without_a_pairing() {
  SetupWindow window;
  // Never started: not over, so a pet that has no setup open is not told it timed out.
  TEST_ASSERT_FALSE(window.over(0xFFFFFFFFu));
  TEST_ASSERT_EQUAL_UINT32(600000u, kSetupWindowMs);
  window.restart(1000);
  TEST_ASSERT_FALSE(window.over(1000));
  TEST_ASSERT_FALSE(window.over(1000 + kSetupWindowMs - 1));
  TEST_ASSERT_TRUE(window.over(1000 + kSetupWindowMs));
  TEST_ASSERT_TRUE(window.over(1000 + 5 * kSetupWindowMs));
  // A try that did not pair starts it again.
  window.restart(1000 + kSetupWindowMs);
  TEST_ASSERT_FALSE(window.over(1000 + kSetupWindowMs + 1));
  TEST_ASSERT_TRUE(window.over(1000 + 2 * kSetupWindowMs));
}

void test_the_window_holds_across_the_wrap_of_the_millisecond_counter() {
  SetupWindow window;
  const uint32_t start = 0xFFFFFFFFu - 1000u;  // a second before the counter wraps
  window.restart(start);
  TEST_ASSERT_FALSE(window.over(start + 2000u));  // wrapped past zero
  TEST_ASSERT_FALSE(window.over(start + kSetupWindowMs - 1u));
  TEST_ASSERT_TRUE(window.over(start + kSetupWindowMs));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_a_passphrase_is_twelve_lower_case_characters_of_the_code_alphabet);
  RUN_TEST(test_the_same_bytes_make_the_same_passphrase_and_other_bytes_another);
  RUN_TEST(test_a_byte_above_the_limit_is_turned_away_not_folded_in);
  RUN_TEST(test_too_few_bytes_give_no_passphrase_and_never_a_short_one);
  RUN_TEST(test_every_character_is_equally_likely);
  RUN_TEST(test_a_stored_value_is_a_passphrase_only_if_this_module_could_have_made_it);
  RUN_TEST(test_the_voice_spells_the_passphrase_one_clip_a_character);
  RUN_TEST(test_a_request_must_carry_the_pages_own_header);
  RUN_TEST(test_an_origin_must_be_the_pages_own);
  RUN_TEST(test_a_page_the_setup_dns_rebound_to_the_pet_is_refused);
  RUN_TEST(test_any_other_name_is_sent_on_to_the_address);
  RUN_TEST(test_the_setup_network_closes_after_ten_minutes_without_a_pairing);
  RUN_TEST(test_the_window_holds_across_the_wrap_of_the_millisecond_counter);
  return UNITY_END();
}
