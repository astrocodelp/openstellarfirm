// The light language as pure frames. The one rule that must never break is
// Listening: LED 0 solid lime at full brightness, at every time, for every
// figure, and no other mode shows that colour as a steady light.
#include <unity.h>

#include <cstdint>
#include <initializer_list>

#include "core/light_frames.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

const PetKind kKinds[PET_KIND_COUNT] = {PET_KIND_ASTRONAUT, PET_KIND_ALIEN, PET_KIND_CAT};

const LightMode kAllModes[] = {LightMode::Off,         LightMode::Setup,        LightMode::Ready,
                               LightMode::Listening,   LightMode::Thinking,     LightMode::Speaking,
                               LightMode::TeamWorking, LightMode::NeedsApprove, LightMode::Done,
                               LightMode::Stopped,     LightMode::OfflineSaving, LightMode::MicOff,
                               LightMode::LowBattery,  LightMode::ChargingIdle, LightMode::Quiet,
                               LightMode::Checked};

struct Frame {
  Rgb led[PET_LED_COUNT_MAX];
  uint8_t count = 0;
};

Frame at(LightMode mode, PetKind kind, uint32_t t, uint8_t voice = 0) {
  Frame f;
  frame(mode, kind, t, voice, f.led, f.count);
  return f;
}

int brightness(Rgb c) { return c.r + c.g + c.b; }
bool dark(Rgb c) { return c == kDark; }

bool sameFrame(const Frame& a, const Frame& b) {
  if (a.count != b.count) {
    return false;
  }
  for (int i = 0; i < PET_LED_COUNT_MAX; ++i) {
    if (a.led[i] != b.led[i]) {
      return false;
    }
  }
  return true;
}

}  // namespace

void test_led_counts_per_figure() {
  TEST_ASSERT_EQUAL_INT(2, ledCount(PET_KIND_ASTRONAUT));
  TEST_ASSERT_EQUAL_INT(3, ledCount(PET_KIND_ALIEN));
  TEST_ASSERT_EQUAL_INT(2, ledCount(PET_KIND_CAT));
  TEST_ASSERT_TRUE(ledCount(PET_KIND_ALIEN) <= PET_LED_COUNT_MAX);
  for (LightMode m : kAllModes) {
    for (PetKind k : kKinds) {
      Frame f = at(m, k, 123);
      TEST_ASSERT_EQUAL_INT(ledCount(k), f.count);
      // Unused LEDs are black.
      for (int i = f.count; i < PET_LED_COUNT_MAX; ++i) {
        TEST_ASSERT_TRUE(dark(f.led[i]));
      }
    }
  }
}

void test_the_brand_colours() {
  TEST_ASSERT_TRUE(kLime == (Rgb{0xd9, 0xff, 0x3f}));
  TEST_ASSERT_TRUE(kSky == (Rgb{0x6f, 0xd0, 0xff}));
  TEST_ASSERT_TRUE(kIvory == (Rgb{0xf3, 0xef, 0xe6}));
  TEST_ASSERT_TRUE(kNebula == (Rgb{0xa5, 0x96, 0xff}));
  TEST_ASSERT_TRUE(kRose == (Rgb{0xff, 0x8f, 0xb1}));
  TEST_ASSERT_TRUE(kMoon == (Rgb{0xe4, 0xe2, 0xef}));
}

void test_scale_rgb() {
  TEST_ASSERT_TRUE(scaleRgb(kLime, 255) == kLime);
  TEST_ASSERT_TRUE(scaleRgb(kLime, 0) == kDark);
  Rgb half = scaleRgb(Rgb{200, 100, 50}, 128);
  TEST_ASSERT_EQUAL_INT(100, half.r);
  TEST_ASSERT_EQUAL_INT(50, half.g);
  TEST_ASSERT_EQUAL_INT(25, half.b);
}

void test_listening_is_solid_full_lime_at_every_time() {
  for (PetKind k : kKinds) {
    for (uint32_t t = 0; t < 130000; t += 7) {
      Frame f = at(LightMode::Listening, k, t, static_cast<uint8_t>(t));
      TEST_ASSERT_TRUE(f.led[0] == kLime);
    }
    // And at the edges of the clock.
    TEST_ASSERT_TRUE(at(LightMode::Listening, k, 0xFFFFFFFFu).led[0] == kLime);
    TEST_ASSERT_TRUE(at(LightMode::Listening, k, 0x80000000u).led[0] == kLime);
  }
}

void test_no_other_mode_shows_steady_full_lime_on_led_zero() {
  for (LightMode m : kAllModes) {
    if (m == LightMode::Listening || m == LightMode::Done) {
      continue;  // Done's sparkle peaks are the one exception
    }
    for (PetKind k : kKinds) {
      for (uint32_t t = 0; t < 40000; t += 3) {
        for (int voice = 0; voice <= 255; voice += 51) {
          Frame f = at(m, k, t, static_cast<uint8_t>(voice));
          TEST_ASSERT_TRUE_MESSAGE(f.led[0] != kLime, lightModeName(m));
        }
      }
    }
  }
}

void test_done_sparkles_peak_at_full_lime_then_it_is_ready() {
  for (PetKind k : kKinds) {
    // Three sparkles at 0, 300 and 600 ms, 150 ms long.
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 0).led[0] == kLime);
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 149).led[0] == kLime);
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 150).led[0] != kLime);
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 300).led[0] == kLime);
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 600).led[0] == kLime);
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 750).led[0] != kLime);
    // The sparkle lights an antenna too.
    TEST_ASSERT_TRUE(at(LightMode::Done, k, 0).led[1] == kLime);
    // Exactly three sparkles in the first second.
    int sparkles = 0;
    bool wasLit = false;
    for (uint32_t t = 0; t < 1050; ++t) {
      bool lit = at(LightMode::Done, k, t).led[0] == kLime;
      if (lit && !wasLit) {
        ++sparkles;
      }
      wasLit = lit;
    }
    TEST_ASSERT_EQUAL_INT(3, sparkles);
    // After that it is the Ready breath, continuing from its start.
    for (uint32_t t = 1050; t < 9000; t += 31) {
      TEST_ASSERT_TRUE(sameFrame(at(LightMode::Done, k, t), at(LightMode::Ready, k, t - 1050)));
    }
    // And it never shows full lime again.
    for (uint32_t t = 1050; t < 20000; t += 11) {
      TEST_ASSERT_TRUE(at(LightMode::Done, k, t).led[0] != kLime);
    }
  }
}

void test_done_sparkles_light_different_antennas_on_zib() {
  Frame a = at(LightMode::Done, PET_KIND_ALIEN, 0);
  Frame b = at(LightMode::Done, PET_KIND_ALIEN, 300);
  TEST_ASSERT_TRUE(a.led[1] == kLime);
  TEST_ASSERT_TRUE(dark(a.led[2]));
  TEST_ASSERT_TRUE(b.led[2] == kLime);
  TEST_ASSERT_TRUE(dark(b.led[1]));
}

void test_ready_is_a_soft_breath_every_six_seconds() {
  for (PetKind k : kKinds) {
    int lo = 1000;
    int hi = 0;
    for (uint32_t t = 0; t < 6000; t += 10) {
      Frame f = at(LightMode::Ready, k, t);
      int g = f.led[0].g;
      lo = g < lo ? g : lo;
      hi = g > hi ? g : hi;
      TEST_ASSERT_TRUE(sameFrame(f, at(LightMode::Ready, k, t + 6000)));
      TEST_ASSERT_TRUE(sameFrame(f, at(LightMode::Ready, k, t + 60000)));
      TEST_ASSERT_TRUE(f.led[0].g > 0);
    }
    // Low brightness: never above about a quarter of full.
    TEST_ASSERT_TRUE(hi <= 70);
    TEST_ASSERT_TRUE(hi >= 60);
    TEST_ASSERT_TRUE(lo <= 14);
    // The darkest moment is the start, the brightest the middle.
    TEST_ASSERT_TRUE(at(LightMode::Ready, k, 3000).led[0].g > at(LightMode::Ready, k, 0).led[0].g);
    TEST_ASSERT_TRUE(at(LightMode::Ready, k, 3000).led[0].g > at(LightMode::Ready, k, 1500).led[0].g);
    // It is lime in hue: red less than green, blue the least.
    Rgb c = at(LightMode::Ready, k, 3000).led[0];
    TEST_ASSERT_TRUE(c.g > c.r && c.r > c.b);
  }
}

void test_thinking_pulses_once_a_second_but_stays_below_listening() {
  Frame lowF = at(LightMode::Thinking, PET_KIND_ASTRONAUT, 0);
  Frame highF = at(LightMode::Thinking, PET_KIND_ASTRONAUT, 500);
  TEST_ASSERT_TRUE(brightness(highF.led[0]) > brightness(lowF.led[0]));
  TEST_ASSERT_TRUE(brightness(highF.led[0]) < brightness(kLime));
  for (uint32_t t = 0; t < 1000; t += 13) {
    TEST_ASSERT_TRUE(sameFrame(at(LightMode::Thinking, PET_KIND_CAT, t), at(LightMode::Thinking, PET_KIND_CAT, t + 1000)));
  }
}

void test_speaking_flickers_with_the_voice_level() {
  int last = -1;
  for (int level = 0; level <= 255; level += 5) {
    Frame f = at(LightMode::Speaking, PET_KIND_ASTRONAUT, 1000, static_cast<uint8_t>(level));
    int b = brightness(f.led[0]);
    TEST_ASSERT_TRUE(b >= last);
    last = b;
    // Ivory in hue: red and green close, blue a little less.
    TEST_ASSERT_TRUE(f.led[0].r >= f.led[0].b);
  }
  // Never dark while speaking, never above ivory.
  TEST_ASSERT_TRUE(brightness(at(LightMode::Speaking, PET_KIND_CAT, 0, 0).led[0]) > 0);
  TEST_ASSERT_TRUE(at(LightMode::Speaking, PET_KIND_CAT, 0, 255).led[0] == kIvory);
  // The time does not matter, only the level.
  TEST_ASSERT_TRUE(sameFrame(at(LightMode::Speaking, PET_KIND_ALIEN, 0, 100), at(LightMode::Speaking, PET_KIND_ALIEN, 4321, 100)));
}

void test_team_working_alternates_the_antennas() {
  // Zib's two antennas take turns: when one is at its brightest the other is dark.
  Frame a = at(LightMode::TeamWorking, PET_KIND_ALIEN, 1200);
  Frame b = at(LightMode::TeamWorking, PET_KIND_ALIEN, 0);
  TEST_ASSERT_TRUE(brightness(a.led[1]) > 0);
  TEST_ASSERT_TRUE(dark(a.led[2]));
  TEST_ASSERT_TRUE(dark(b.led[1]));
  TEST_ASSERT_TRUE(brightness(b.led[2]) > 0);
  // Nova and Comet: the one antenna or the dome breathes slowly (2.4 s).
  for (PetKind k : {PET_KIND_ASTRONAUT, PET_KIND_CAT}) {
    TEST_ASSERT_TRUE(dark(at(LightMode::TeamWorking, k, 0).led[1]));
    TEST_ASSERT_TRUE(brightness(at(LightMode::TeamWorking, k, 1200).led[1]) > 0);
    TEST_ASSERT_TRUE(sameFrame(at(LightMode::TeamWorking, k, 777), at(LightMode::TeamWorking, k, 777 + 2400)));
  }
  // The chest light stays a dim steady lime.
  TEST_ASSERT_TRUE(at(LightMode::TeamWorking, PET_KIND_CAT, 0).led[0] == at(LightMode::TeamWorking, PET_KIND_CAT, 900).led[0]);
}

void test_needs_approve_blinks_nebula_every_two_seconds() {
  for (PetKind k : kKinds) {
    Frame on = at(LightMode::NeedsApprove, k, 100);
    TEST_ASSERT_TRUE(on.led[0] == kNebula);
    TEST_ASSERT_TRUE(on.led[1] == kNebula);
    TEST_ASSERT_TRUE(dark(at(LightMode::NeedsApprove, k, 500).led[0]));
    TEST_ASSERT_TRUE(dark(at(LightMode::NeedsApprove, k, 1999).led[0]));
    TEST_ASSERT_TRUE(at(LightMode::NeedsApprove, k, 2100).led[0] == kNebula);
    TEST_ASSERT_TRUE(at(LightMode::NeedsApprove, k, 20100).led[0] == kNebula);
  }
}

void test_stopped_is_a_rose_double_blink() {
  for (PetKind k : kKinds) {
    TEST_ASSERT_TRUE(at(LightMode::Stopped, k, 50).led[0] == kRose);
    TEST_ASSERT_TRUE(dark(at(LightMode::Stopped, k, 200).led[0]));
    TEST_ASSERT_TRUE(at(LightMode::Stopped, k, 350).led[0] == kRose);
    TEST_ASSERT_TRUE(dark(at(LightMode::Stopped, k, 500).led[0]));
    TEST_ASSERT_TRUE(dark(at(LightMode::Stopped, k, 1000).led[0]));
    TEST_ASSERT_TRUE(at(LightMode::Stopped, k, 1550).led[0] == kRose);
    int blinks = 0;
    bool was = false;
    for (uint32_t t = 0; t < 1500; ++t) {
      bool lit = !dark(at(LightMode::Stopped, k, t).led[0]);
      if (lit && !was) {
        ++blinks;
      }
      was = lit;
    }
    TEST_ASSERT_EQUAL_INT(2, blinks);
  }
}

void test_offline_saving_is_a_slow_moon_breath() {
  Frame lowF = at(LightMode::OfflineSaving, PET_KIND_CAT, 0);
  Frame highF = at(LightMode::OfflineSaving, PET_KIND_CAT, 2000);
  TEST_ASSERT_TRUE(brightness(highF.led[0]) > brightness(lowF.led[0]));
  TEST_ASSERT_TRUE(sameFrame(at(LightMode::OfflineSaving, PET_KIND_CAT, 1234), at(LightMode::OfflineSaving, PET_KIND_CAT, 1234 + 4000)));
  // Moon in hue: blue is the largest.
  Rgb c = highF.led[0];
  TEST_ASSERT_TRUE(c.b >= c.r && c.b >= c.g);
}

void test_mic_off_is_dim_solid_rose_on_the_chest_light() {
  for (PetKind k : kKinds) {
    Frame first = at(LightMode::MicOff, k, 0);
    TEST_ASSERT_TRUE(brightness(first.led[0]) > 0);
    TEST_ASSERT_TRUE(brightness(first.led[0]) < brightness(kRose) / 2);
    TEST_ASSERT_TRUE(first.led[0].r > first.led[0].g);
    for (uint32_t t = 0; t < 30000; t += 997) {
      TEST_ASSERT_TRUE(sameFrame(first, at(LightMode::MicOff, k, t)));
    }
    for (int i = 1; i < first.count; ++i) {
      TEST_ASSERT_TRUE(dark(first.led[i]));
    }
  }
}

void test_low_battery_blinks_rose_once_every_ten_seconds() {
  for (PetKind k : kKinds) {
    TEST_ASSERT_TRUE(at(LightMode::LowBattery, k, 100).led[0] == kRose);
    TEST_ASSERT_TRUE(dark(at(LightMode::LowBattery, k, 500).led[0]));
    TEST_ASSERT_TRUE(dark(at(LightMode::LowBattery, k, 9999).led[0]));
    TEST_ASSERT_TRUE(at(LightMode::LowBattery, k, 10100).led[0] == kRose);
    int blinks = 0;
    bool was = false;
    for (uint32_t t = 0; t < 30000; t += 10) {
      bool lit = !dark(at(LightMode::LowBattery, k, t).led[0]);
      if (lit && !was) {
        ++blinks;
      }
      was = lit;
    }
    TEST_ASSERT_EQUAL_INT(3, blinks);
  }
}

void test_charging_idle_fills_up_and_starts_again() {
  uint8_t last = 0;
  for (uint32_t t = 0; t < 3000; t += 100) {
    uint8_t g = at(LightMode::ChargingIdle, PET_KIND_ASTRONAUT, t).led[0].g;
    TEST_ASSERT_TRUE(g >= last);
    last = g;
  }
  TEST_ASSERT_TRUE(last > at(LightMode::ChargingIdle, PET_KIND_ASTRONAUT, 0).led[0].g);
  TEST_ASSERT_TRUE(sameFrame(at(LightMode::ChargingIdle, PET_KIND_CAT, 1500), at(LightMode::ChargingIdle, PET_KIND_CAT, 4500)));
  // It restarts low.
  TEST_ASSERT_TRUE(at(LightMode::ChargingIdle, PET_KIND_CAT, 3000).led[0].g < at(LightMode::ChargingIdle, PET_KIND_CAT, 2900).led[0].g);
}

void test_quiet_shows_only_the_antennas_at_two_percent_moon() {
  for (PetKind k : kKinds) {
    Frame f = at(LightMode::Quiet, k, 4242);
    TEST_ASSERT_TRUE(dark(f.led[0]));
    for (int i = 1; i < f.count; ++i) {
      TEST_ASSERT_TRUE(f.led[i] == scaleRgb(kMoon, 5));
      // 2 percent of full: a handful of 255.
      TEST_ASSERT_TRUE(f.led[i].r <= 6 && f.led[i].g <= 6 && f.led[i].b <= 6);
      TEST_ASSERT_TRUE(brightness(f.led[i]) > 0);
    }
  }
  Frame zib = at(LightMode::Quiet, PET_KIND_ALIEN, 0);
  TEST_ASSERT_TRUE(brightness(zib.led[1]) > 0 && brightness(zib.led[2]) > 0);
}

void test_setup_is_sky_with_a_slow_blink_and_a_chase() {
  for (PetKind k : kKinds) {
    TEST_ASSERT_TRUE(at(LightMode::Setup, k, 100).led[0] == kSky);
    TEST_ASSERT_TRUE(dark(at(LightMode::Setup, k, 1100).led[0]));
    TEST_ASSERT_TRUE(at(LightMode::Setup, k, 2100).led[0] == kSky);
    // Every lit LED is sky in hue (blue the largest, red the least).
    for (uint32_t t = 0; t < 4000; t += 50) {
      Frame f = at(LightMode::Setup, k, t);
      for (int i = 0; i < f.count; ++i) {
        if (!dark(f.led[i])) {
          TEST_ASSERT_TRUE(f.led[i].b >= f.led[i].g && f.led[i].g >= f.led[i].r);
        }
      }
    }
  }
  // The antennas of Zib chase: the left one, then the right one, then neither.
  TEST_ASSERT_TRUE(!dark(at(LightMode::Setup, PET_KIND_ALIEN, 0).led[1]));
  TEST_ASSERT_TRUE(dark(at(LightMode::Setup, PET_KIND_ALIEN, 0).led[2]));
  TEST_ASSERT_TRUE(dark(at(LightMode::Setup, PET_KIND_ALIEN, 400).led[1]));
  TEST_ASSERT_TRUE(!dark(at(LightMode::Setup, PET_KIND_ALIEN, 400).led[2]));
  TEST_ASSERT_TRUE(dark(at(LightMode::Setup, PET_KIND_ALIEN, 800).led[1]));
  TEST_ASSERT_TRUE(dark(at(LightMode::Setup, PET_KIND_ALIEN, 800).led[2]));
}

void test_checked_is_one_short_lime_blink_of_the_antennas_and_never_the_microphones_light() {
  for (PetKind k : kKinds) {
    // For its first 200 ms every antenna (or the dome) is lime, the chest light dim.
    for (uint32_t t : {0u, 100u, 199u}) {
      Frame f = at(LightMode::Checked, k, t);
      TEST_ASSERT_TRUE(f.led[0] != kLime);
      TEST_ASSERT_TRUE(brightness(f.led[0]) < brightness(kLime) / 4);
      for (int i = 1; i < f.count; ++i) {
        TEST_ASSERT_TRUE(f.led[i] == kLime);
      }
    }
    // Then it is the Ready breath, which is never full lime: one blink and no more.
    for (uint32_t t = 200; t < 20000; t += 7) {
      Frame f = at(LightMode::Checked, k, t);
      for (int i = 0; i < f.count; ++i) {
        TEST_ASSERT_TRUE(f.led[i] != kLime);
      }
      TEST_ASSERT_TRUE(sameFrame(f, at(LightMode::Ready, k, t - 200)));
    }
  }
  TEST_ASSERT_EQUAL_STRING("checked", lightModeName(LightMode::Checked));
}

void test_off_is_dark() {
  for (PetKind k : kKinds) {
    Frame f = at(LightMode::Off, k, 555);
    for (int i = 0; i < PET_LED_COUNT_MAX; ++i) {
      TEST_ASSERT_TRUE(dark(f.led[i]));
    }
  }
}

void test_led_zero_base_hues() {
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::Listening) == kLime);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::Ready) == kLime);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::Speaking) == kIvory);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::NeedsApprove) == kNebula);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::Stopped) == kRose);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::MicOff) == kRose);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::OfflineSaving) == kMoon);
  TEST_ASSERT_TRUE(ledZeroBase(LightMode::Setup) == kSky);
  TEST_ASSERT_TRUE(dark(ledZeroBase(LightMode::Off)));
  TEST_ASSERT_TRUE(dark(ledZeroBase(LightMode::Quiet)));
  // Only Listening's base is lime AND steady; checked above by frame().
}

void test_every_mode_has_a_name() {
  for (LightMode m : kAllModes) {
    const char* name = lightModeName(m);
    TEST_ASSERT_NOT_NULL(name);
    TEST_ASSERT_TRUE(name[0] != '?');
  }
  TEST_ASSERT_EQUAL_STRING("listening", lightModeName(LightMode::Listening));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_led_counts_per_figure);
  RUN_TEST(test_the_brand_colours);
  RUN_TEST(test_scale_rgb);
  RUN_TEST(test_listening_is_solid_full_lime_at_every_time);
  RUN_TEST(test_no_other_mode_shows_steady_full_lime_on_led_zero);
  RUN_TEST(test_done_sparkles_peak_at_full_lime_then_it_is_ready);
  RUN_TEST(test_done_sparkles_light_different_antennas_on_zib);
  RUN_TEST(test_ready_is_a_soft_breath_every_six_seconds);
  RUN_TEST(test_thinking_pulses_once_a_second_but_stays_below_listening);
  RUN_TEST(test_speaking_flickers_with_the_voice_level);
  RUN_TEST(test_team_working_alternates_the_antennas);
  RUN_TEST(test_needs_approve_blinks_nebula_every_two_seconds);
  RUN_TEST(test_stopped_is_a_rose_double_blink);
  RUN_TEST(test_offline_saving_is_a_slow_moon_breath);
  RUN_TEST(test_mic_off_is_dim_solid_rose_on_the_chest_light);
  RUN_TEST(test_low_battery_blinks_rose_once_every_ten_seconds);
  RUN_TEST(test_charging_idle_fills_up_and_starts_again);
  RUN_TEST(test_quiet_shows_only_the_antennas_at_two_percent_moon);
  RUN_TEST(test_setup_is_sky_with_a_slow_blink_and_a_chase);
  RUN_TEST(test_checked_is_one_short_lime_blink_of_the_antennas_and_never_the_microphones_light);
  RUN_TEST(test_off_is_dark);
  RUN_TEST(test_led_zero_base_hues);
  RUN_TEST(test_every_mode_has_a_name);
  return UNITY_END();
}
