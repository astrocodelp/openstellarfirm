// The talk button: debounce, tap, double tap, the hold that starts listening, and the
// power-on reset hold. The tests drive the raw level a millisecond at a time.
#include <unity.h>

#include <cstdint>
#include <vector>

#include "core/gestures.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

namespace {

struct Seen {
  uint32_t at;
  GestureEvent event;
};

// A button and a clock the tests move by hand.
struct Rig {
  Gestures g;
  uint32_t now;
  bool level = false;
  std::vector<Seen> seen;

  explicit Rig(uint32_t start, bool initiallyPressed = false) : now(start), level(initiallyPressed) {
    note(g.update(level, now));
  }

  void note(GestureEvent e) {
    if (e != GestureEvent::None) {
      seen.push_back({now, e});
    }
  }

  // Holds the raw level for `ms` milliseconds, calling update() every millisecond.
  void hold(bool pressed, uint32_t ms) {
    level = pressed;
    for (uint32_t i = 0; i < ms; ++i) {
      ++now;
      note(g.update(level, now));
    }
  }

  size_t count() const { return seen.size(); }
  GestureEvent at(size_t i) const { return seen.at(i).event; }
  uint32_t when(size_t i) const { return seen.at(i).at; }
};

}  // namespace

void test_a_quick_press_is_down_then_tap() {
  Rig r(1000);
  r.hold(false, 500);
  r.hold(true, 100);   // raw level high for the samples at 1501..1600
  r.hold(false, 300);
  TEST_ASSERT_EQUAL_INT(2, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, r.at(0));
  // Steady for 25 ms before it counts.
  TEST_ASSERT_EQUAL_UINT32(1501 + 25, r.when(0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(1));
  TEST_ASSERT_EQUAL_UINT32(1601 + 25, r.when(1));
}

void test_bounce_shorter_than_the_debounce_is_ignored() {
  Rig r(0);
  r.hold(false, 100);
  // Contact bounce: 10 ms on, 10 ms off, 10 ms on, then off again.
  r.hold(true, 10);
  r.hold(false, 10);
  r.hold(true, 10);
  r.hold(false, 200);
  TEST_ASSERT_EQUAL_INT(0, r.count());
  TEST_ASSERT_FALSE(r.g.pressed());
}

void test_a_glitch_in_the_middle_of_a_hold_does_not_end_it() {
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 600);
  r.hold(false, 8);  // a bounce while held
  r.hold(true, 600);
  r.hold(false, 100);
  // Down, HoldStart, Up: one hold.
  TEST_ASSERT_EQUAL_INT(3, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, r.at(0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, r.at(1));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(2));
}

void test_a_hold_starts_the_talk_at_400_ms_and_ends_on_release() {
  Rig r(1000);
  r.hold(false, 500);
  r.hold(true, 1000);  // raw level high for the samples at 1501..2500
  r.hold(false, 100);
  TEST_ASSERT_EQUAL_INT(3, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, r.at(0));
  TEST_ASSERT_EQUAL_UINT32(1526, r.when(0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, r.at(1));
  TEST_ASSERT_EQUAL_UINT32(1526 + 400, r.when(1));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(2));
  TEST_ASSERT_EQUAL_UINT32(2501 + 25, r.when(2));
}

void test_the_tap_threshold() {
  {
    Rig r(0);
    r.hold(false, 100);
    r.hold(true, 399);  // accepted press lasts 399 ms
    r.hold(false, 100);
    TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(r.count() - 1));
  }
  {
    Rig r(0);
    r.hold(false, 100);
    r.hold(true, 401);
    r.hold(false, 100);
    TEST_ASSERT_EQUAL_INT(3, r.count());
    TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, r.at(1));
    TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(2));
  }
}

void test_two_taps_close_together_are_tap_then_double_tap() {
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 100);
  r.hold(false, 150);  // the gap
  r.hold(true, 100);
  r.hold(false, 200);
  TEST_ASSERT_EQUAL_INT(4, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, r.at(0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(1));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, r.at(2));
  TEST_ASSERT_EQUAL_INT(GestureEvent::DoubleTap, r.at(3));
}

void test_two_taps_far_apart_are_two_taps() {
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 100);
  r.hold(false, 400);
  r.hold(true, 100);
  r.hold(false, 200);
  TEST_ASSERT_EQUAL_INT(4, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(1));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(3));
}

void test_the_double_tap_window_edge() {
  // The second press must be accepted within 350 ms of the first release being
  // accepted. Both edges are delayed by the same 25 ms, so the raw gap between
  // the first release and the second press is what counts: 349 ms of gap is a
  // double tap, 351 ms is two taps.
  for (int gap = 349; gap <= 351; gap += 2) {
    Rig r(0);
    r.hold(false, 100);
    r.hold(true, 100);
    r.hold(false, static_cast<uint32_t>(gap));
    r.hold(true, 100);
    r.hold(false, 200);
    TEST_ASSERT_EQUAL_INT(4, r.count());
    TEST_ASSERT_EQUAL_INT(gap == 349 ? GestureEvent::DoubleTap : GestureEvent::Tap, r.at(3));
  }
}

void test_a_third_tap_after_a_double_tap_is_a_single_tap() {
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 80);
  r.hold(false, 100);
  r.hold(true, 80);
  r.hold(false, 100);
  r.hold(true, 80);
  r.hold(false, 300);
  GestureEvent last = r.at(r.count() - 1);
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, last);
  // Down Tap Down DoubleTap Down Tap
  TEST_ASSERT_EQUAL_INT(6, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::DoubleTap, r.at(3));
}

void test_a_tap_then_a_hold_is_not_a_double_tap() {
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 80);
  r.hold(false, 100);
  r.hold(true, 700);
  r.hold(false, 100);
  // Down Tap Down HoldStart Up
  TEST_ASSERT_EQUAL_INT(5, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(1));
  TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, r.at(3));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(4));
}

void test_a_hold_after_a_double_tap_works_normally() {
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 80);
  r.hold(false, 100);
  r.hold(true, 80);
  r.hold(false, 600);
  r.hold(true, 700);
  r.hold(false, 100);
  TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, r.at(r.count() - 2));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(r.count() - 1));
}

void test_a_reset_hold_from_power_on() {
  Rig r(5000, true);  // the button is already down at the first sample
  r.hold(true, 9999);
  TEST_ASSERT_EQUAL_INT(0, r.count());
  r.hold(true, 1);  // 10000 ms after power-on
  TEST_ASSERT_EQUAL_INT(1, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::ResetHold, r.at(0));
  TEST_ASSERT_EQUAL_UINT32(15000, r.when(0));
  // Held longer: nothing more. Released: nothing.
  r.hold(true, 3000);
  r.hold(false, 500);
  TEST_ASSERT_EQUAL_INT(1, r.count());
}

void test_holding_the_button_at_power_on_never_starts_the_talk() {
  Rig r(0, true);
  r.hold(true, 3000);  // far past the 400 ms of a talk hold
  r.hold(false, 200);  // let go before the reset time
  TEST_ASSERT_EQUAL_INT(0, r.count());
  // After that the button works as usual.
  r.hold(true, 100);
  r.hold(false, 200);
  TEST_ASSERT_EQUAL_INT(2, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, r.at(0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(1));
}

void test_not_held_at_power_on_means_no_reset_hold() {
  Rig r(0, false);
  r.hold(false, 50);
  r.hold(true, 15000);  // a long press later is a talk hold, not a reset
  r.hold(false, 100);
  for (size_t i = 0; i < r.count(); ++i) {
    TEST_ASSERT_TRUE(r.at(i) != GestureEvent::ResetHold);
  }
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(r.count() - 1));
}

void test_a_press_after_a_released_power_on_hold_is_not_a_reset() {
  Rig r(0, true);
  r.hold(true, 2000);
  r.hold(false, 200);
  r.hold(true, 12000);  // held again, long, after boot
  r.hold(false, 100);
  for (size_t i = 0; i < r.count(); ++i) {
    TEST_ASSERT_TRUE(r.at(i) != GestureEvent::ResetHold);
  }
}

void test_pressed_follows_the_debounced_level() {
  Rig r(0);
  r.hold(false, 100);
  TEST_ASSERT_FALSE(r.g.pressed());
  r.hold(true, 10);
  TEST_ASSERT_FALSE(r.g.pressed());
  r.hold(true, 30);
  TEST_ASSERT_TRUE(r.g.pressed());
  r.hold(false, 10);
  TEST_ASSERT_TRUE(r.g.pressed());
  r.hold(false, 30);
  TEST_ASSERT_FALSE(r.g.pressed());
}

void test_a_clock_that_wraps_changes_nothing() {
  // Start 150 ms before the 32-bit counter wraps; a tap and a hold across it.
  Rig r(0xFFFFFFFFu - 150);
  r.hold(false, 50);
  r.hold(true, 80);   // crosses the wrap
  r.hold(false, 100);
  r.hold(true, 700);
  r.hold(false, 100);
  // Down Tap Down HoldStart Up (the second press is within the double tap window
  // of the first tap, so it would be a double tap if it were short; it is a hold)
  TEST_ASSERT_EQUAL_INT(5, r.count());
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(1));
  TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, r.at(3));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, r.at(4));
}

void test_a_stalled_loop_reports_the_talk_late_but_still_ends_it() {
  // update() was not called for two seconds while the button was held.
  Gestures g;
  TEST_ASSERT_EQUAL_INT(GestureEvent::None, g.update(false, 0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::None, g.update(true, 100));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, g.update(true, 130));
  // The next call finds it long past 400 ms: the talk begins, late.
  TEST_ASSERT_EQUAL_INT(GestureEvent::HoldStart, g.update(true, 2200));
  TEST_ASSERT_EQUAL_INT(GestureEvent::None, g.update(false, 2210));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, g.update(false, 2240));
}

void test_a_release_seen_late_after_400_ms_is_still_an_end_not_a_tap() {
  Gestures g;
  TEST_ASSERT_EQUAL_INT(GestureEvent::None, g.update(false, 0));
  TEST_ASSERT_EQUAL_INT(GestureEvent::None, g.update(true, 100));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Down, g.update(true, 130));
  // The loop looks again at 370 ms of press (raw already released), then at
  // 405 ms, when the release is accepted. HoldStart was never emitted.
  TEST_ASSERT_EQUAL_INT(GestureEvent::None, g.update(false, 500));
  TEST_ASSERT_EQUAL_INT(GestureEvent::Up, g.update(false, 535));
}

// Rule 4: the hold starts the listening and the release does not stop it; the owner
// stops it by pressing the light again. The gestures must tell the two presses apart.
void test_a_hold_then_a_tap_to_stop_is_hold_start_up_then_a_single_tap() {
  Rig r(0);
  r.hold(false, 200);
  r.hold(true, 900);   // the hold: HoldStart at 400 ms of press
  r.hold(false, 100);  // let go: listening goes on
  r.hold(true, 120);   // press the light again, quickly
  r.hold(false, 300);
  const GestureEvent expected[] = {GestureEvent::Down, GestureEvent::HoldStart, GestureEvent::Up, GestureEvent::Down,
                                   GestureEvent::Tap};
  TEST_ASSERT_EQUAL_INT(5, r.count());
  for (size_t i = 0; i < 5; ++i) {
    TEST_ASSERT_EQUAL_INT(expected[i], r.at(i));
  }
}

void test_a_tap_right_after_the_release_of_a_hold_is_a_tap_not_a_double_tap() {
  // The release of a hold is not a tap, so the next quick press cannot be a second one.
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 700);
  r.hold(false, 60);   // released, and 60 ms later...
  r.hold(true, 80);    // ...pressed again
  r.hold(false, 100);
  TEST_ASSERT_EQUAL_INT(GestureEvent::Tap, r.at(r.count() - 1));
  for (size_t i = 0; i < r.count(); ++i) {
    TEST_ASSERT_TRUE(r.at(i) != GestureEvent::DoubleTap);
  }
}

void test_a_second_hold_after_a_hold_starts_again() {
  // Pressing and holding the light again while listening is also "I am done": it
  // reports HoldStart the same way, and the state machine sends at once.
  Rig r(0);
  r.hold(false, 100);
  r.hold(true, 800);
  r.hold(false, 200);
  r.hold(true, 800);
  r.hold(false, 100);
  size_t holds = 0;
  size_t ups = 0;
  for (size_t i = 0; i < r.count(); ++i) {
    holds += r.at(i) == GestureEvent::HoldStart ? 1 : 0;
    ups += r.at(i) == GestureEvent::Up ? 1 : 0;
  }
  TEST_ASSERT_EQUAL_INT(2, holds);
  TEST_ASSERT_EQUAL_INT(2, ups);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_a_hold_then_a_tap_to_stop_is_hold_start_up_then_a_single_tap);
  RUN_TEST(test_a_tap_right_after_the_release_of_a_hold_is_a_tap_not_a_double_tap);
  RUN_TEST(test_a_second_hold_after_a_hold_starts_again);
  RUN_TEST(test_a_quick_press_is_down_then_tap);
  RUN_TEST(test_bounce_shorter_than_the_debounce_is_ignored);
  RUN_TEST(test_a_glitch_in_the_middle_of_a_hold_does_not_end_it);
  RUN_TEST(test_a_hold_starts_the_talk_at_400_ms_and_ends_on_release);
  RUN_TEST(test_the_tap_threshold);
  RUN_TEST(test_two_taps_close_together_are_tap_then_double_tap);
  RUN_TEST(test_two_taps_far_apart_are_two_taps);
  RUN_TEST(test_the_double_tap_window_edge);
  RUN_TEST(test_a_third_tap_after_a_double_tap_is_a_single_tap);
  RUN_TEST(test_a_tap_then_a_hold_is_not_a_double_tap);
  RUN_TEST(test_a_hold_after_a_double_tap_works_normally);
  RUN_TEST(test_a_reset_hold_from_power_on);
  RUN_TEST(test_holding_the_button_at_power_on_never_starts_the_talk);
  RUN_TEST(test_not_held_at_power_on_means_no_reset_hold);
  RUN_TEST(test_a_press_after_a_released_power_on_hold_is_not_a_reset);
  RUN_TEST(test_pressed_follows_the_debounced_level);
  RUN_TEST(test_a_clock_that_wraps_changes_nothing);
  RUN_TEST(test_a_stalled_loop_reports_the_talk_late_but_still_ends_it);
  RUN_TEST(test_a_release_seen_late_after_400_ms_is_still_an_end_not_a_tap);
  return UNITY_END();
}
