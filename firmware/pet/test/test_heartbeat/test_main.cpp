// When the pet sends a heartbeat: every five minutes, and sooner when the battery
// band, the charger, the saved notes or the figure on the pad change.
#include <unity.h>

#include <cstdint>

#include "core/heartbeat.h"
#include "generated/protocol.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {
constexpr uint32_t kPeriod = 300000;
constexpr uint32_t kGap = 15000;

HeartbeatState state(uint8_t band = 3, bool charging = false, uint8_t queue = 0, int8_t skin = 0) {
  HeartbeatState s;
  s.batteryBand = band;
  s.charging = charging;
  s.queue = queue;
  s.skin = skin;
  return s;
}
}  // namespace

void test_the_default_period_is_the_protocols_five_minutes() {
  HeartbeatPolicy policy;
  policy.sent(state(), 0);
  TEST_ASSERT_FALSE(policy.due(state(), kPeriod - 1));
  TEST_ASSERT_TRUE(policy.due(state(), kPeriod));
  TEST_ASSERT_EQUAL_INT(300, PET_HEARTBEAT_SECONDS);
}

void test_the_first_heartbeat_is_due_at_once() {
  HeartbeatPolicy policy(kPeriod, kGap);
  TEST_ASSERT_TRUE(policy.due(state(), 0));
  TEST_ASSERT_TRUE(policy.due(state(), 123456));
}

void test_nothing_is_due_between_beats_when_nothing_changed() {
  HeartbeatPolicy policy(kPeriod, kGap);
  policy.sent(state(), 1000);
  for (uint32_t t = 1000; t < 1000 + kPeriod; t += 7000) {
    TEST_ASSERT_FALSE(policy.due(state(), t));
  }
  TEST_ASSERT_TRUE(policy.due(state(), 1000 + kPeriod));
}

void test_each_kind_of_change_makes_one_due_after_the_gap() {
  HeartbeatPolicy policy(kPeriod, kGap);
  policy.sent(state(), 0);
  TEST_ASSERT_TRUE(policy.due(state(2), kGap));                // battery band
  TEST_ASSERT_TRUE(policy.due(state(3, true), kGap));          // charger plugged
  TEST_ASSERT_TRUE(policy.due(state(3, false, 1), kGap));      // a note saved
  TEST_ASSERT_TRUE(policy.due(state(3, false, 0, 2), kGap));   // another figure
  TEST_ASSERT_TRUE(policy.due(state(3, false, 0, -1), kGap));  // figure taken off
}

void test_a_change_inside_the_gap_waits_for_it() {
  HeartbeatPolicy policy(kPeriod, kGap);
  policy.sent(state(), 0);
  TEST_ASSERT_FALSE(policy.due(state(2), kGap - 1));
  TEST_ASSERT_TRUE(policy.due(state(2), kGap));
}

void test_a_battery_that_wobbles_on_a_band_edge_sends_only_once_a_gap() {
  HeartbeatPolicy policy(kPeriod, kGap);
  policy.sent(state(3), 0);
  int sent = 0;
  uint8_t band = 3;
  for (uint32_t t = 1000; t <= 60000; t += 1000) {
    band = (band == 3) ? 2 : 3;
    HeartbeatState now = state(band);
    if (policy.due(now, t)) {
      policy.sent(now, t);
      ++sent;
    }
  }
  // Sixty seconds, a gap of fifteen: at most four, not sixty.
  TEST_ASSERT_TRUE(sent <= 4);
  TEST_ASSERT_TRUE(sent >= 1);
}

void test_a_request_is_due_at_once_and_only_once() {
  HeartbeatPolicy policy(kPeriod, kGap);
  policy.sent(state(), 0);
  TEST_ASSERT_FALSE(policy.due(state(), 1000));
  policy.request();
  TEST_ASSERT_TRUE(policy.due(state(), 1000));
  policy.sent(state(), 1000);
  TEST_ASSERT_FALSE(policy.due(state(), 2000));
}

void test_the_clock_wrapping_does_not_break_the_period() {
  HeartbeatPolicy policy(kPeriod, kGap);
  const uint32_t near = 0xFFFFFFFFu - 100000u;
  policy.sent(state(), near);
  TEST_ASSERT_FALSE(policy.due(state(), near + 100000u));
  TEST_ASSERT_FALSE(policy.due(state(), 0));  // 100 s later, across the wrap
  TEST_ASSERT_TRUE(policy.due(state(), near + kPeriod));
}

void test_state_equality() {
  TEST_ASSERT_TRUE(state() == state());
  TEST_ASSERT_TRUE(state(1) != state(2));
  TEST_ASSERT_TRUE(state(1, true) != state(1, false));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_the_default_period_is_the_protocols_five_minutes);
  RUN_TEST(test_the_first_heartbeat_is_due_at_once);
  RUN_TEST(test_nothing_is_due_between_beats_when_nothing_changed);
  RUN_TEST(test_each_kind_of_change_makes_one_due_after_the_gap);
  RUN_TEST(test_a_change_inside_the_gap_waits_for_it);
  RUN_TEST(test_a_battery_that_wobbles_on_a_band_edge_sends_only_once_a_gap);
  RUN_TEST(test_a_request_is_due_at_once_and_only_once);
  RUN_TEST(test_the_clock_wrapping_does_not_break_the_period);
  RUN_TEST(test_state_equality);
  return UNITY_END();
}
