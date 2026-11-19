// The small pure modules: the skin ID, the battery, base64url, UUIDs, the notice
// clip plan, the audio helpers, and the pin map and config sanity checks.
#include <unity.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <set>
#include <string>
#include <vector>

#include "config.h"
#include "core/api_rules.h"
#include "core/audio_dsp.h"
#include "core/base64url.h"
#include "core/battery.h"
#include "core/notice_clips.h"
#include "core/skin_id.h"
#include "core/uuid_format.h"
#include "generated/protocol.h"
#include "pins.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

// -- Skin ID -----------------------------------------------------------------

void test_skin_bands_and_edges() {
  TEST_ASSERT_TRUE(skinFromMillivolts(-5) == PetKindOrNone::none());
  TEST_ASSERT_TRUE(skinFromMillivolts(0) == PetKindOrNone::none());
  TEST_ASSERT_TRUE(skinFromMillivolts(1199) == PetKindOrNone::none());
  TEST_ASSERT_TRUE(skinFromMillivolts(1200) == PetKindOrNone::of(PET_KIND_ASTRONAUT));
  TEST_ASSERT_TRUE(skinFromMillivolts(1650) == PetKindOrNone::of(PET_KIND_ASTRONAUT));
  TEST_ASSERT_TRUE(skinFromMillivolts(1959) == PetKindOrNone::of(PET_KIND_ASTRONAUT));
  TEST_ASSERT_TRUE(skinFromMillivolts(1960) == PetKindOrNone::of(PET_KIND_ALIEN));
  TEST_ASSERT_TRUE(skinFromMillivolts(2270) == PetKindOrNone::of(PET_KIND_ALIEN));
  TEST_ASSERT_TRUE(skinFromMillivolts(2494) == PetKindOrNone::of(PET_KIND_ALIEN));
  TEST_ASSERT_TRUE(skinFromMillivolts(2495) == PetKindOrNone::of(PET_KIND_CAT));
  TEST_ASSERT_TRUE(skinFromMillivolts(2720) == PetKindOrNone::of(PET_KIND_CAT));
  TEST_ASSERT_TRUE(skinFromMillivolts(3000) == PetKindOrNone::of(PET_KIND_CAT));
  TEST_ASSERT_TRUE(skinFromMillivolts(3001) == PetKindOrNone::none());
  TEST_ASSERT_TRUE(skinFromMillivolts(3300) == PetKindOrNone::none());
  TEST_ASSERT_TRUE(skinFromMillivolts(4095) == PetKindOrNone::none());
}

void test_skin_from_the_real_resistors() {
  // The pin reads the 10 k pull-up to 3.3 V against the figure's resistor.
  const struct {
    long ohms;
    PetKind kind;
  } figures[] = {{10000, PET_KIND_ASTRONAUT}, {22000, PET_KIND_ALIEN}, {47000, PET_KIND_CAT}};
  for (const auto& f : figures) {
    // Allow a 5 percent resistor tolerance and a 3.3 V rail that is 2 percent off.
    for (double tol : {0.95, 1.0, 1.05}) {
      for (double rail : {3234.0, 3300.0, 3366.0}) {
        double r = static_cast<double>(f.ohms) * tol;
        int mv = static_cast<int>(rail * r / (10000.0 + r));
        TEST_ASSERT_TRUE(skinFromMillivolts(mv) == PetKindOrNone::of(f.kind));
      }
    }
  }
}

void test_skin_names_and_the_default_figure() {
  TEST_ASSERT_EQUAL_STRING("astronaut", skinWireName(PetKindOrNone::of(PET_KIND_ASTRONAUT)));
  TEST_ASSERT_EQUAL_STRING("alien", skinWireName(PetKindOrNone::of(PET_KIND_ALIEN)));
  TEST_ASSERT_EQUAL_STRING("cat", skinWireName(PetKindOrNone::of(PET_KIND_CAT)));
  TEST_ASSERT_EQUAL_STRING("none", skinWireName(PetKindOrNone::none()));
  TEST_ASSERT_EQUAL_INT(PET_KIND_ASTRONAUT, kindOrDefault(PetKindOrNone::none()));
  TEST_ASSERT_EQUAL_INT(PET_KIND_CAT, kindOrDefault(PetKindOrNone::of(PET_KIND_CAT)));
  TEST_ASSERT_TRUE(PetKindOrNone::none() != PetKindOrNone::of(PET_KIND_ASTRONAUT));
  TEST_ASSERT_TRUE(PetKindOrNone::of(PET_KIND_ALIEN) != PetKindOrNone::of(PET_KIND_CAT));
}

// -- Battery -----------------------------------------------------------------

void test_battery_volts_from_the_divider() {
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 3.7f, batteryVoltsFromSense(1850));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 4.2f, batteryVoltsFromSense(2100));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.0f, batteryVoltsFromSense(0));
}

void test_battery_fraction_curve() {
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.0f, batteryFraction(3.0f));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.0f, batteryFraction(3.5f));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.35f, batteryFraction(3.7f));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.6f, batteryFraction(3.85f));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.85f, batteryFraction(4.0f));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 1.0f, batteryFraction(4.15f));
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 1.0f, batteryFraction(4.4f));
  // Halfway along each segment.
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.175f, batteryFraction(3.6f));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.475f, batteryFraction(3.775f));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.725f, batteryFraction(3.925f));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.925f, batteryFraction(4.075f));
  // Not a number counts as empty rather than full.
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.0f, batteryFraction(std::nanf("")));
}

void test_battery_fraction_never_goes_down_as_the_voltage_rises() {
  float last = 0.0f;
  for (int mv = 3000; mv <= 4500; mv += 5) {
    float f = batteryFraction(static_cast<float>(mv) / 1000.0f);
    TEST_ASSERT_TRUE(f >= last);
    TEST_ASSERT_TRUE(f >= 0.0f && f <= 1.0f);
    last = f;
  }
}

void test_low_and_critical() {
  TEST_ASSERT_FALSE(isLow(3.6f));
  TEST_ASSERT_TRUE(isLow(3.599f));
  TEST_ASSERT_FALSE(isLow(3.9f));
  TEST_ASSERT_FALSE(isCritical(3.5f));
  TEST_ASSERT_TRUE(isCritical(3.499f));
  TEST_ASSERT_FALSE(isCritical(3.55f));
  TEST_ASSERT_TRUE(isLow(3.55f));
  // Critical is always low too.
  for (int mv = 3000; mv <= 4300; mv += 10) {
    float v = static_cast<float>(mv) / 1000.0f;
    if (isCritical(v)) {
      TEST_ASSERT_TRUE(isLow(v));
    }
  }
}

void test_battery_bands() {
  TEST_ASSERT_EQUAL_INT(0, batteryBand(0.0f));
  TEST_ASSERT_EQUAL_INT(0, batteryBand(-1.0f));
  TEST_ASSERT_EQUAL_INT(0, batteryBand(0.19f));
  TEST_ASSERT_EQUAL_INT(1, batteryBand(0.21f));
  TEST_ASSERT_EQUAL_INT(2, batteryBand(0.5f));
  TEST_ASSERT_EQUAL_INT(3, batteryBand(0.7f));
  TEST_ASSERT_EQUAL_INT(4, batteryBand(0.99f));
  TEST_ASSERT_EQUAL_INT(4, batteryBand(1.0f));
  TEST_ASSERT_EQUAL_INT(4, batteryBand(5.0f));
  TEST_ASSERT_EQUAL_INT(0, batteryBand(std::nanf("")));
}

// -- base64url ---------------------------------------------------------------

namespace {

std::string enc(const std::string& s) {
  return base64urlEncode(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

}  // namespace

void test_base64url_rfc_vectors() {
  TEST_ASSERT_EQUAL_STRING("", enc("").c_str());
  TEST_ASSERT_EQUAL_STRING("Zg", enc("f").c_str());
  TEST_ASSERT_EQUAL_STRING("Zm8", enc("fo").c_str());
  TEST_ASSERT_EQUAL_STRING("Zm9v", enc("foo").c_str());
  TEST_ASSERT_EQUAL_STRING("Zm9vYg", enc("foob").c_str());
  TEST_ASSERT_EQUAL_STRING("Zm9vYmE", enc("fooba").c_str());
  TEST_ASSERT_EQUAL_STRING("Zm9vYmFy", enc("foobar").c_str());
}

void test_base64url_uses_the_url_alphabet_and_no_padding() {
  const uint8_t a[] = {0xfb, 0xff};
  TEST_ASSERT_EQUAL_STRING("-_8", base64urlEncode(a, 2).c_str());
  const uint8_t b[] = {0xfb, 0xff, 0xfe};
  TEST_ASSERT_EQUAL_STRING("-__-", base64urlEncode(b, 3).c_str());
  for (size_t n = 0; n < 100; ++n) {
    std::vector<uint8_t> bytes(n, 0xfb);
    std::string e = base64urlEncode(bytes.data(), n);
    TEST_ASSERT_EQUAL_INT(base64urlEncodedLength(n), e.size());
    TEST_ASSERT_TRUE(e.find('=') == std::string::npos);
    TEST_ASSERT_TRUE(e.find('+') == std::string::npos);
    TEST_ASSERT_TRUE(e.find('/') == std::string::npos);
  }
}

void test_base64url_of_32_bytes_is_43_characters() {
  // SHA-256 of the empty string.
  const uint8_t digest[32] = {0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14, 0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f, 0xb9, 0x24,
                              0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c, 0xa4, 0x95, 0x99, 0x1b, 0x78, 0x52, 0xb8, 0x55};
  std::string e = base64urlEncode(digest, 32);
  TEST_ASSERT_EQUAL_INT(43, e.size());
  TEST_ASSERT_EQUAL_INT(43, base64urlEncodedLength(32));
  TEST_ASSERT_EQUAL_STRING("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", e.c_str());
}

void test_base64url_round_trip() {
  uint32_t seed = 99;
  for (size_t n = 0; n < 200; ++n) {
    std::vector<uint8_t> bytes(n);
    for (auto& b : bytes) {
      seed = seed * 1664525u + 1013904223u;
      b = static_cast<uint8_t>(seed >> 24);
    }
    std::string e = base64urlEncode(bytes.data(), n);
    std::vector<uint8_t> back;
    TEST_ASSERT_TRUE(base64urlDecode(e, back));
    TEST_ASSERT_EQUAL_INT(n, back.size());
    if (n > 0) {
      TEST_ASSERT_EQUAL_UINT8_ARRAY(bytes.data(), back.data(), n);
    }
  }
}

void test_base64url_decode_is_strict() {
  std::vector<uint8_t> out;
  TEST_ASSERT_TRUE(base64urlDecode("", out));
  TEST_ASSERT_EQUAL_INT(0, out.size());
  TEST_ASSERT_TRUE(base64urlDecode("Zg", out));
  TEST_ASSERT_FALSE(base64urlDecode("Zg==", out));   // padding
  TEST_ASSERT_FALSE(base64urlDecode("Zh", out));     // leftover bits are not zero
  TEST_ASSERT_FALSE(base64urlDecode("Z", out));      // one char left over
  TEST_ASSERT_FALSE(base64urlDecode("Zm9vY", out));  // 5 characters
  TEST_ASSERT_FALSE(base64urlDecode("-+8", out));    // standard alphabet
  TEST_ASSERT_FALSE(base64urlDecode("_/8", out));
  TEST_ASSERT_FALSE(base64urlDecode("Zm 9v", out));
  TEST_ASSERT_FALSE(base64urlDecode("Zm9v\n", out));
  TEST_ASSERT_EQUAL_INT(0, out.size());
}

// -- UUID --------------------------------------------------------------------

void test_uuid_v4_formatting() {
  uint8_t zero_to_f[16];
  for (int i = 0; i < 16; ++i) {
    zero_to_f[i] = static_cast<uint8_t>(i);
  }
  TEST_ASSERT_EQUAL_STRING("00010203-0405-4607-8809-0a0b0c0d0e0f", uuidV4(zero_to_f).c_str());
  uint8_t ones[16];
  std::memset(ones, 0xff, sizeof(ones));
  TEST_ASSERT_EQUAL_STRING("ffffffff-ffff-4fff-bfff-ffffffffffff", uuidV4(ones).c_str());
  uint8_t zeros[16] = {0};
  TEST_ASSERT_EQUAL_STRING("00000000-0000-4000-8000-000000000000", uuidV4(zeros).c_str());
  char text[kUuidTextLength + 1];
  formatUuidV4(zero_to_f, text);
  TEST_ASSERT_EQUAL_INT(36, std::strlen(text));
  TEST_ASSERT_EQUAL_INT(36, kUuidTextLength);
}

void test_uuid_version_and_variant_for_any_bytes() {
  uint32_t seed = 7;
  for (int n = 0; n < 500; ++n) {
    uint8_t r[16];
    for (auto& b : r) {
      seed = seed * 1664525u + 1013904223u;
      b = static_cast<uint8_t>(seed >> 24);
    }
    std::string u = uuidV4(r);
    TEST_ASSERT_TRUE(isUuidText(u.c_str()));
    TEST_ASSERT_EQUAL_INT('4', u[14]);
    TEST_ASSERT_TRUE(u[19] == '8' || u[19] == '9' || u[19] == 'a' || u[19] == 'b');
    TEST_ASSERT_TRUE(u.find_first_not_of("0123456789abcdef-") == std::string::npos);
  }
}

void test_uuid_text_check() {
  TEST_ASSERT_TRUE(isUuidText("11111111-1111-4111-8111-111111111111"));
  TEST_ASSERT_TRUE(isUuidText("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"));
  TEST_ASSERT_FALSE(isUuidText(nullptr));
  TEST_ASSERT_FALSE(isUuidText(""));
  TEST_ASSERT_FALSE(isUuidText("11111111-1111-4111-8111-11111111111"));
  TEST_ASSERT_FALSE(isUuidText("11111111-1111-4111-8111-1111111111111"));
  TEST_ASSERT_FALSE(isUuidText("11111111_1111-4111-8111-111111111111"));
  TEST_ASSERT_FALSE(isUuidText("1111111g-1111-4111-8111-111111111111"));
  TEST_ASSERT_FALSE(isUuidText("111111111111411181111111111111111111"));
}

// -- Notice clip plan --------------------------------------------------------

namespace {

bool isPackLine(const char* id) {
  for (int i = 0; i < PET_LINE_COUNT; ++i) {
    if (std::strcmp(id, PET_LINE_IDS[i]) == 0) {
      return true;
    }
  }
  return false;
}

}  // namespace

void test_every_role_has_a_clip_named_after_it() {
  for (int i = 0; i < PET_ROLE_COUNT; ++i) {
    const char* clip = roleClipId(PET_ROLE_IDS[i]);
    TEST_ASSERT_NOT_NULL(clip);
    std::string want = std::string("role-") + PET_ROLE_IDS[i];
    TEST_ASSERT_EQUAL_STRING(want.c_str(), clip);
    TEST_ASSERT_TRUE(isPackLine(clip));
  }
  TEST_ASSERT_NULL(roleClipId(nullptr));
  TEST_ASSERT_NULL(roleClipId(""));
  TEST_ASSERT_NULL(roleClipId("   "));
  TEST_ASSERT_NULL(roleClipId("\t\n"));
  // Spaces around a known role are ignored, as in the TypeScript package.
  TEST_ASSERT_EQUAL_STRING("role-developer", roleClipId("  developer\n"));
  // A role the pack has no clip for is "Your assistant".
  TEST_ASSERT_EQUAL_STRING("role-assistant", roleClipId("nobody"));
  TEST_ASSERT_EQUAL_STRING("role-assistant", roleClipId("assistant"));
  TEST_ASSERT_EQUAL_STRING("role-assistant", roleClipId("Developer"));
  TEST_ASSERT_EQUAL_STRING("role-assistant", roleClipId("develope"));
  TEST_ASSERT_EQUAL_STRING("role-assistant", roleClipId("developers"));
  // The server sends canonical ids; an alias is not resolved on the pet.
  TEST_ASSERT_EQUAL_STRING("role-assistant", roleClipId("coder"));
  TEST_ASSERT_TRUE(isPackLine(roleClipId("nobody")));
}

void test_done_notices() {
  NoticePlan withTitle = planNotice(PET_NOTICE_KIND_DONE, "developer", true);
  TEST_ASSERT_TRUE(withTitle.fetch);
  TEST_ASSERT_EQUAL_STRING("", withTitle.first);
  TEST_ASSERT_EQUAL_STRING("", withTitle.second);
  TEST_ASSERT_EQUAL_STRING("done", withTitle.fallback);
  TEST_ASSERT_FALSE(withTitle.silent);

  NoticePlan role = planNotice(PET_NOTICE_KIND_DONE, "developer", false);
  TEST_ASSERT_FALSE(role.fetch);
  TEST_ASSERT_EQUAL_STRING("role-developer", role.first);
  TEST_ASSERT_EQUAL_STRING("notice-done", role.second);

  NoticePlan noRole = planNotice(PET_NOTICE_KIND_DONE, nullptr, false);
  TEST_ASSERT_EQUAL_STRING("done", noRole.first);
  TEST_ASSERT_EQUAL_STRING("", noRole.second);
  NoticePlan blank = planNotice(PET_NOTICE_KIND_DONE, "  ", false);
  TEST_ASSERT_EQUAL_STRING("done", blank.first);
  TEST_ASSERT_EQUAL_STRING("", blank.second);
  // A role the pack has no clip for: "Your assistant finished."
  NoticePlan unknown = planNotice(PET_NOTICE_KIND_DONE, "nobody", false);
  TEST_ASSERT_EQUAL_STRING("role-assistant", unknown.first);
  TEST_ASSERT_EQUAL_STRING("notice-done", unknown.second);
}

void test_approval_notices_name_the_role_and_nothing_else() {
  NoticePlan role = planNotice(PET_NOTICE_KIND_APPROVAL, "marketing", false);
  TEST_ASSERT_EQUAL_STRING("role-marketing", role.first);
  TEST_ASSERT_EQUAL_STRING("notice-approval", role.second);
  TEST_ASSERT_FALSE(role.fetch);
  // A title never makes an approval notice fetch spoken text (rule 3).
  NoticePlan withTitle = planNotice(PET_NOTICE_KIND_APPROVAL, "marketing", true);
  TEST_ASSERT_FALSE(withTitle.fetch);
  TEST_ASSERT_EQUAL_STRING("role-marketing", withTitle.first);
  NoticePlan noRole = planNotice(PET_NOTICE_KIND_APPROVAL, nullptr, true);
  TEST_ASSERT_FALSE(noRole.fetch);
  TEST_ASSERT_EQUAL_STRING("needs-approve", noRole.first);
  TEST_ASSERT_EQUAL_STRING("", noRole.second);
}

void test_stopped_and_budget_notices() {
  NoticePlan role = planNotice(PET_NOTICE_KIND_STOPPED, "legal", false);
  TEST_ASSERT_EQUAL_STRING("role-legal", role.first);
  TEST_ASSERT_EQUAL_STRING("notice-stopped", role.second);
  NoticePlan noRole = planNotice(PET_NOTICE_KIND_STOPPED, nullptr, false);
  TEST_ASSERT_EQUAL_STRING("stopped", noRole.first);
  NoticePlan withTitle = planNotice(PET_NOTICE_KIND_STOPPED, nullptr, true);
  TEST_ASSERT_FALSE(withTitle.fetch);
  NoticePlan budget = planNotice(PET_NOTICE_KIND_BUDGET, "sales", true);
  TEST_ASSERT_EQUAL_STRING("budget", budget.first);
  TEST_ASSERT_EQUAL_STRING("", budget.second);
  TEST_ASSERT_FALSE(budget.fetch);
}

void test_message_and_settings_notices() {
  NoticePlan message = planNotice(PET_NOTICE_KIND_MESSAGE, nullptr, false);
  TEST_ASSERT_TRUE(message.fetch);
  TEST_ASSERT_EQUAL_STRING("message", message.fallback);
  TEST_ASSERT_EQUAL_STRING("", message.first);
  NoticePlan settings = planNotice(PET_NOTICE_KIND_SETTINGS, "developer", true);
  TEST_ASSERT_TRUE(settings.silent);
  TEST_ASSERT_FALSE(settings.fetch);
  TEST_ASSERT_EQUAL_STRING("", settings.first);
  TEST_ASSERT_EQUAL_STRING("", settings.second);
}

void test_a_message_is_fetched_spoken_and_the_greeting_falls_back_to_hello() {
  // The pairing greeting is a message notice: read aloud through say, and when that
  // cannot be done (offline, a failure) the pack's own "hello" is played.
  NoticePlan hello = planInboxNotice(PET_NOTICE_KIND_MESSAGE, nullptr, false, "Hi, I'm Nova. Hold my lime light and talk to me.");
  TEST_ASSERT_TRUE(hello.fetch);
  TEST_ASSERT_FALSE(hello.silent);
  TEST_ASSERT_EQUAL_STRING("hello", hello.fallback);
  NoticePlan named = planInboxNotice(PET_NOTICE_KIND_MESSAGE, nullptr, false, "Hi, I'm Comet the Cat. Hold my lime light and talk to me.");
  TEST_ASSERT_EQUAL_STRING("hello", named.fallback);
  // Any other message plays "message".
  NoticePlan other = planInboxNotice(PET_NOTICE_KIND_MESSAGE, nullptr, false, "Your team has a message for you.");
  TEST_ASSERT_TRUE(other.fetch);
  TEST_ASSERT_EQUAL_STRING("message", other.fallback);
  NoticePlan none = planInboxNotice(PET_NOTICE_KIND_MESSAGE, nullptr, false, nullptr);
  TEST_ASSERT_EQUAL_STRING("message", none.fallback);
  // The greeting words in another kind of notice change nothing.
  NoticePlan done = planInboxNotice(PET_NOTICE_KIND_DONE, "developer", false, "Hi, I'm Nova. Hold my lime light and talk to me.");
  TEST_ASSERT_EQUAL_STRING("role-developer", done.first);
  TEST_ASSERT_FALSE(done.fetch);
  // A settings notice is silent whatever its line.
  NoticePlan settings = planInboxNotice(PET_NOTICE_KIND_SETTINGS, nullptr, false, "");
  TEST_ASSERT_TRUE(settings.silent);
  TEST_ASSERT_FALSE(settings.fetch);
}

void test_every_planned_clip_is_in_the_pack() {
  for (int k = 0; k < PET_NOTICE_KIND_COUNT; ++k) {
    for (int r = -1; r < PET_ROLE_COUNT; ++r) {
      for (int t = 0; t < 2; ++t) {
        NoticePlan p = planNotice(static_cast<PetNoticeKind>(k), r < 0 ? nullptr : PET_ROLE_IDS[r], t == 1);
        if (p.first[0] != '\0') {
          TEST_ASSERT_TRUE(isPackLine(p.first));
        }
        if (p.second[0] != '\0') {
          TEST_ASSERT_TRUE(isPackLine(p.second));
        }
        if (p.fallback[0] != '\0') {
          TEST_ASSERT_TRUE(isPackLine(p.fallback));
        }
        // A plan is exactly one of: clips, fetch, silent.
        int ways = (p.first[0] != '\0' ? 1 : 0) + (p.fetch ? 1 : 0) + (p.silent ? 1 : 0);
        TEST_ASSERT_EQUAL_INT(1, ways);
        // A second clip only follows a first.
        TEST_ASSERT_TRUE(p.second[0] == '\0' || p.first[0] != '\0');
      }
    }
  }
}

// -- Audio helpers -----------------------------------------------------------

void test_mic_slot_to_pcm16() {
  TEST_ASSERT_EQUAL_INT16(0, pcm16FromI2s32(0));
  TEST_ASSERT_EQUAL_INT16(1, pcm16FromI2s32(1 << 14));
  TEST_ASSERT_EQUAL_INT16(-1, pcm16FromI2s32(-(1 << 14)));
  TEST_ASSERT_EQUAL_INT16(0, pcm16FromI2s32((1 << 14) - 1));
  TEST_ASSERT_EQUAL_INT16(-1, pcm16FromI2s32(-1));
  TEST_ASSERT_EQUAL_INT16(1000, pcm16FromI2s32(1000 * (1 << 14)));
  TEST_ASSERT_EQUAL_INT16(32767, pcm16FromI2s32(32767 * (1 << 14)));
  // Saturates instead of wrapping.
  TEST_ASSERT_EQUAL_INT16(32767, pcm16FromI2s32(32768 * (1 << 14)));
  TEST_ASSERT_EQUAL_INT16(32767, pcm16FromI2s32(0x7fffffff));
  TEST_ASSERT_EQUAL_INT16(-32768, pcm16FromI2s32(-32768 * (1 << 14)));
  TEST_ASSERT_EQUAL_INT16(-32768, pcm16FromI2s32(-32769 * (1 << 14)));
  TEST_ASSERT_EQUAL_INT16(-32768, pcm16FromI2s32(INT32_MIN));
}

void test_dc_blocker_removes_an_offset() {
  DcBlocker dc;
  // The first sample passes through.
  TEST_ASSERT_EQUAL_INT16(1000, dc.process(1000));
  int16_t last = 0;
  for (int i = 0; i < 4000; ++i) {
    last = dc.process(1000);
  }
  TEST_ASSERT_TRUE(std::abs(last) < 5);
  dc.reset();
  TEST_ASSERT_EQUAL_INT16(1000, dc.process(1000));
}

void test_dc_blocker_keeps_a_tone_and_drops_the_offset() {
  DcBlocker dc;
  const double pi = 3.14159265358979323846;
  double sumIn = 0;
  double sumOut = 0;
  double peakOut = 0;
  for (int i = 0; i < 16000; ++i) {
    // 1 kHz at 16 kHz sampling, amplitude 8000, on top of a 5000 offset.
    double x = 5000.0 + 8000.0 * std::sin(2.0 * pi * 1000.0 * i / 16000.0);
    int16_t y = dc.process(static_cast<int16_t>(x));
    if (i >= 8000) {
      sumIn += x;
      sumOut += y;
      peakOut = std::fmax(peakOut, std::fabs(static_cast<double>(y)));
    }
  }
  TEST_ASSERT_TRUE(sumIn / 8000.0 > 4900.0);
  // The mean of the output is near zero; the tone is still there at full size.
  TEST_ASSERT_TRUE(std::fabs(sumOut / 8000.0) < 100.0);
  TEST_ASSERT_TRUE(peakOut > 7600.0 && peakOut < 8400.0);
}

void test_dc_blocker_saturates_instead_of_wrapping() {
  DcBlocker dc;
  dc.process(-32768);
  TEST_ASSERT_EQUAL_INT16(32767, dc.process(32767));
  DcBlocker dc2;
  dc2.process(32767);
  TEST_ASSERT_EQUAL_INT16(-32768, dc2.process(-32768));
}

void test_volume_gain() {
  TEST_ASSERT_EQUAL_UINT16(0, volumeGainQ8(0.0f));
  TEST_ASSERT_EQUAL_UINT16(0, volumeGainQ8(-0.5f));
  TEST_ASSERT_EQUAL_UINT16(0, volumeGainQ8(std::nanf("")));
  TEST_ASSERT_EQUAL_UINT16(256, volumeGainQ8(1.0f));
  TEST_ASSERT_EQUAL_UINT16(256, volumeGainQ8(3.0f));
  TEST_ASSERT_EQUAL_UINT16(128, volumeGainQ8(0.5f));
  // The default volume of a new pet.
  TEST_ASSERT_EQUAL_UINT16(154, volumeGainQ8(0.6f));
  uint16_t last = 0;
  for (int i = 0; i <= 100; ++i) {
    uint16_t g = volumeGainQ8(static_cast<float>(i) / 100.0f);
    TEST_ASSERT_TRUE(g >= last);
    last = g;
  }
}

void test_apply_gain() {
  TEST_ASSERT_EQUAL_INT16(1234, applyGainQ8(1234, 256));
  TEST_ASSERT_EQUAL_INT16(617, applyGainQ8(1234, 128));
  TEST_ASSERT_EQUAL_INT16(0, applyGainQ8(1234, 0));
  TEST_ASSERT_EQUAL_INT16(-16384, applyGainQ8(-32768, 128));
  TEST_ASSERT_EQUAL_INT16(32767, applyGainQ8(32767, 256));
  TEST_ASSERT_EQUAL_INT16(-32768, applyGainQ8(-32768, 256));
  // A gain above unity saturates.
  TEST_ASSERT_EQUAL_INT16(32767, applyGainQ8(32767, 512));
  TEST_ASSERT_EQUAL_INT16(-32768, applyGainQ8(-32768, 512));
  int16_t block[4] = {100, -100, 32767, -32768};
  applyGainQ8(block, 4, 128);
  TEST_ASSERT_EQUAL_INT16(50, block[0]);
  TEST_ASSERT_EQUAL_INT16(-50, block[1]);
  TEST_ASSERT_EQUAL_INT16(16383, block[2]);
  TEST_ASSERT_EQUAL_INT16(-16384, block[3]);
}

void test_jitter_head_start_is_a_quarter_second_of_whole_samples() {
  constexpr size_t bytes = jitterStartBytes();
  TEST_ASSERT_EQUAL_INT(0, bytes % 2);
  TEST_ASSERT_EQUAL_INT(11024, bytes);
  // 22050 samples a second, 2 bytes each: 250 ms is 11025 bytes, rounded down to an even number.
  TEST_ASSERT_TRUE(bytes <= static_cast<size_t>(PET_DOWN_SAMPLE_RATE) * 2 / 4);
  TEST_ASSERT_TRUE(bytes + 2 > static_cast<size_t>(PET_DOWN_SAMPLE_RATE) * 2 / 4);
}

// -- Pins and config ---------------------------------------------------------

void test_pins_match_the_hardware_guide() {
  TEST_ASSERT_EQUAL_INT(5, PIN_AMP_BCLK);
  TEST_ASSERT_EQUAL_INT(6, PIN_AMP_LRCLK);
  TEST_ASSERT_EQUAL_INT(7, PIN_AMP_DIN);
  TEST_ASSERT_EQUAL_INT(8, PIN_AMP_SD);
  TEST_ASSERT_EQUAL_INT(9, PIN_LED_DATA);
  TEST_ASSERT_EQUAL_INT(10, PIN_MIC_SCK);
  TEST_ASSERT_EQUAL_INT(17, PIN_MIC_WS);
  TEST_ASSERT_EQUAL_INT(18, PIN_MIC_SD);
  TEST_ASSERT_EQUAL_INT(21, PIN_BUTTON);
  TEST_ASSERT_EQUAL_INT(1, PIN_BATTERY_SENSE);
  TEST_ASSERT_EQUAL_INT(2, PIN_CHARGING);
  TEST_ASSERT_EQUAL_INT(4, PIN_USB_PRESENT);
  TEST_ASSERT_EQUAL_INT(13, PIN_SKIN_ID);
  TEST_ASSERT_EQUAL_INT(14, PIN_MIC_SWITCH);
  TEST_ASSERT_EQUAL_INT(3, PET_LED_COUNT_MAX);
}

void test_pins_are_distinct_and_avoid_the_strapping_pins() {
  const int pins[] = {PIN_AMP_BCLK, PIN_AMP_LRCLK,     PIN_AMP_DIN,     PIN_AMP_SD,  PIN_LED_DATA,
                      PIN_MIC_SCK,  PIN_MIC_WS,        PIN_MIC_SD,      PIN_BUTTON,  PIN_BATTERY_SENSE,
                      PIN_CHARGING, PIN_USB_PRESENT,   PIN_SKIN_ID,     PIN_MIC_SWITCH};
  std::set<int> seen;
  for (int p : pins) {
    TEST_ASSERT_TRUE(seen.insert(p).second);
    // A2 (GPIO3, a strapping pin), the boot pin (GPIO0) and D13 (the onboard LED, GPIO48).
    TEST_ASSERT_TRUE(p != 3 && p != 0 && p != 48 && p != 46);
  }
}

void test_config_is_consistent_with_the_protocol() {
  TEST_ASSERT_TRUE(isHttpsBase(PET_API_BASE));
  TEST_ASSERT_TRUE(std::strlen(PET_FIRMWARE_VERSION) <= 20);
  TEST_ASSERT_TRUE(std::strlen(PET_FIRMWARE_VERSION) >= 5);
  // The long poll's HTTP timeout outlasts the wait the server is asked for.
  TEST_ASSERT_TRUE(PET_INBOX_HTTP_TIMEOUT_MS > PET_INBOX_WAIT_SECONDS * 1000);
  TEST_ASSERT_TRUE(PET_INBOX_WAIT_SECONDS <= PET_INBOX_WAIT_MAX_SECONDS);
  // A turn's HTTP timeout outlasts the first-answer wait, and leaves a minute or more
  // for the server to transcribe a two-minute recording and make the speech.
  TEST_ASSERT_TRUE(PET_TURN_HTTP_TIMEOUT_MS > PET_FIRST_ANSWER_WAIT_SECONDS * 1000);
  TEST_ASSERT_TRUE(PET_TURN_HTTP_TIMEOUT_MS >= (PET_FIRST_ANSWER_WAIT_SECONDS + 60) * 1000);
  TEST_ASSERT_EQUAL_INT((PET_FIRST_ANSWER_WAIT_SECONDS + PET_TURN_SERVER_WORK_SECONDS) * 1000, PET_TURN_HTTP_TIMEOUT_MS);
  TEST_ASSERT_EQUAL_INT(85000, PET_TURN_HTTP_TIMEOUT_MS);
  // The upload allowance carries even the largest upload (the 1 MiB cap) on a poor
  // link: under 190 kbit/s.
  TEST_ASSERT_TRUE(static_cast<long long>(PET_UPLOAD_MAX_BYTES) * 8 / PET_TURN_UPLOAD_SECONDS < 190000);
  // A button hold is longer than a tap (0.4 s): the hold starts the listening.
  TEST_ASSERT_EQUAL_INT(400, PET_TAP_MAX_MS);
  TEST_ASSERT_TRUE(PET_BACKOFF_BASE_MS == 1000 && PET_BACKOFF_MAX_MS == 300000);
  TEST_ASSERT_TRUE(PET_TAP_MAX_MS > PET_BUTTON_DEBOUNCE_MS);
  TEST_ASSERT_TRUE(PET_LOW_BATTERY_VOLTS > PET_CRITICAL_BATTERY_VOLTS);
  // 50 Hz lights.
  TEST_ASSERT_EQUAL_INT(50, 1000 / PET_LIGHT_FRAME_MS);
  // The heartbeat is well inside the "online" window the server shows.
  TEST_ASSERT_TRUE(PET_HEARTBEAT_SECONDS * 2 <= PET_ONLINE_WINDOW_SECONDS);
}

void test_the_generated_header_has_what_the_firmware_uses() {
  TEST_ASSERT_EQUAL_STRING("nano-esp32-v1", PET_HARDWARE_ID);
  // Rule 4 (decided 21 October 2026): up to two minutes, five seconds of silence end it.
  TEST_ASSERT_EQUAL_INT(120, PET_RECORD_MAX_SECONDS);
  TEST_ASSERT_EQUAL_INT(5, PET_SILENCE_END_SECONDS);
  TEST_ASSERT_EQUAL_INT(1048576, PET_UPLOAD_MAX_BYTES);
  TEST_ASSERT_EQUAL_INT(16000, PET_UP_SAMPLE_RATE);
  TEST_ASSERT_EQUAL_INT(22050, PET_DOWN_SAMPLE_RATE);
  TEST_ASSERT_EQUAL_INT(512, PET_ADPCM_BLOCK_ALIGN);
  TEST_ASSERT_EQUAL_INT(PET_LINE_COUNT, 82);
  TEST_ASSERT_EQUAL_INT(3, PET_KIND_COUNT);
  TEST_ASSERT_EQUAL_STRING("Nova", PET_KIND_NAMES[PET_KIND_ASTRONAUT]);
  TEST_ASSERT_EQUAL_STRING("Zib", PET_KIND_NAMES[PET_KIND_ALIEN]);
  TEST_ASSERT_EQUAL_STRING("Comet", PET_KIND_NAMES[PET_KIND_CAT]);
  TEST_ASSERT_EQUAL_STRING("talia", PET_KIND_DEFAULT_VOICES[PET_KIND_ASTRONAUT]);
  // No spoken line the firmware plays by id may be missing from the pack list.
  TEST_ASSERT_TRUE(isPackLine(PET_LINE_SAVED) && isPackLine(PET_LINE_MEMORY_FULL) && isPackLine(PET_LINE_SENT));
  TEST_ASSERT_TRUE(isPackLine(PET_LINE_MIC_OFF) && isPackLine(PET_LINE_SETUP_JOIN) && isPackLine(PET_LINE_SETUP_CODE));
  TEST_ASSERT_TRUE(isPackLine(PET_LINE_BACK_ONLINE) && isPackLine(PET_LINE_BATTERY_LOW) && isPackLine(PET_LINE_CHARGING));
}

void test_a_bump_of_the_button_is_not_a_recording() {
  TEST_ASSERT_EQUAL_UINT32(4800, kMinRecordingSamples);
  TEST_ASSERT_TRUE(recordingTooShort(0));
  TEST_ASSERT_TRUE(recordingTooShort(4799));
  TEST_ASSERT_FALSE(recordingTooShort(4800));
  TEST_ASSERT_FALSE(recordingTooShort(16000));
}

// A saved note that is dead air could only be refused by the server, and a refused
// note stays on the pet for good. The threshold sits above the microphone's noise
// floor and below quiet speech, in the same units the recorder measures (the
// 24-bit sample in its 32-bit slot, through pcm16FromI2s32).
void test_a_silent_recording_is_not_worth_keeping() {
  TEST_ASSERT_EQUAL_UINT16(64, kMinRecordingPeak);
  TEST_ASSERT_TRUE(recordingTooQuiet(0));
  TEST_ASSERT_TRUE(recordingTooQuiet(63));
  TEST_ASSERT_FALSE(recordingTooQuiet(64));
  TEST_ASSERT_FALSE(recordingTooQuiet(32767));
  // The noise floor: a few hundred counts of the 24-bit sample at its loudest.
  const int16_t noise = pcm16FromI2s32(static_cast<int32_t>(400) << 8);
  TEST_ASSERT_TRUE(recordingTooQuiet(static_cast<uint16_t>(noise)));
  // Quiet speech, about -60 dBFS of the 24-bit range.
  const int16_t speech = pcm16FromI2s32(static_cast<int32_t>(8000) << 8);
  TEST_ASSERT_FALSE(recordingTooQuiet(static_cast<uint16_t>(speech)));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_skin_bands_and_edges);
  RUN_TEST(test_skin_from_the_real_resistors);
  RUN_TEST(test_skin_names_and_the_default_figure);
  RUN_TEST(test_battery_volts_from_the_divider);
  RUN_TEST(test_battery_fraction_curve);
  RUN_TEST(test_battery_fraction_never_goes_down_as_the_voltage_rises);
  RUN_TEST(test_low_and_critical);
  RUN_TEST(test_battery_bands);
  RUN_TEST(test_base64url_rfc_vectors);
  RUN_TEST(test_base64url_uses_the_url_alphabet_and_no_padding);
  RUN_TEST(test_base64url_of_32_bytes_is_43_characters);
  RUN_TEST(test_base64url_round_trip);
  RUN_TEST(test_base64url_decode_is_strict);
  RUN_TEST(test_uuid_v4_formatting);
  RUN_TEST(test_uuid_version_and_variant_for_any_bytes);
  RUN_TEST(test_uuid_text_check);
  RUN_TEST(test_every_role_has_a_clip_named_after_it);
  RUN_TEST(test_done_notices);
  RUN_TEST(test_approval_notices_name_the_role_and_nothing_else);
  RUN_TEST(test_stopped_and_budget_notices);
  RUN_TEST(test_message_and_settings_notices);
  RUN_TEST(test_a_message_is_fetched_spoken_and_the_greeting_falls_back_to_hello);
  RUN_TEST(test_every_planned_clip_is_in_the_pack);
  RUN_TEST(test_mic_slot_to_pcm16);
  RUN_TEST(test_dc_blocker_removes_an_offset);
  RUN_TEST(test_dc_blocker_keeps_a_tone_and_drops_the_offset);
  RUN_TEST(test_dc_blocker_saturates_instead_of_wrapping);
  RUN_TEST(test_volume_gain);
  RUN_TEST(test_apply_gain);
  RUN_TEST(test_jitter_head_start_is_a_quarter_second_of_whole_samples);
  RUN_TEST(test_pins_match_the_hardware_guide);
  RUN_TEST(test_pins_are_distinct_and_avoid_the_strapping_pins);
  RUN_TEST(test_config_is_consistent_with_the_protocol);
  RUN_TEST(test_the_generated_header_has_what_the_firmware_uses);
  RUN_TEST(test_a_bump_of_the_button_is_not_a_recording);
  RUN_TEST(test_a_silent_recording_is_not_worth_keeping);
  return UNITY_END();
}
