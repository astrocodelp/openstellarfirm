// Retry backoff: 1 s, 2 s, 4 s ... capped at 300 s, deterministic jitter.
#include <unity.h>

#include <cmath>
#include <cstdint>

#include "core/backoff.h"

using namespace pet;

void setUp(void) {}
void tearDown(void) {}

void test_doubles_from_one_second_to_the_cap() {
  Backoff b;
  const uint32_t expected[] = {1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000, 300000};
  for (uint32_t want : expected) {
    TEST_ASSERT_EQUAL_UINT32(want, b.nextDelayMs(0.0f));
  }
  TEST_ASSERT_EQUAL_UINT32(12, b.attempts());
}

void test_reset_starts_again() {
  Backoff b;
  b.nextDelayMs();
  b.nextDelayMs();
  b.nextDelayMs();
  TEST_ASSERT_EQUAL_UINT32(8000, b.peekNominalMs());
  b.reset();
  TEST_ASSERT_EQUAL_UINT32(0, b.attempts());
  TEST_ASSERT_EQUAL_UINT32(1000, b.nextDelayMs());
}

void test_peek_does_not_advance() {
  Backoff b;
  TEST_ASSERT_EQUAL_UINT32(1000, b.peekNominalMs());
  TEST_ASSERT_EQUAL_UINT32(1000, b.peekNominalMs());
  TEST_ASSERT_EQUAL_UINT32(0, b.attempts());
}

void test_jitter_only_shortens_by_up_to_a_fifth() {
  Backoff b;
  b.nextDelayMs();  // 1 s used
  b.nextDelayMs();  // 2 s used
  // The third delay is nominally 4000 ms.
  Backoff full;
  full.nextDelayMs();
  full.nextDelayMs();
  TEST_ASSERT_EQUAL_UINT32(4000, full.nextDelayMs(0.0f));
  Backoff half = b;
  TEST_ASSERT_EQUAL_UINT32(3600, half.nextDelayMs(0.5f));
  Backoff top = b;
  TEST_ASSERT_EQUAL_UINT32(3200, top.nextDelayMs(1.0f));
}

void test_the_cap_holds_with_any_jitter() {
  for (int i = 0; i <= 10; ++i) {
    Backoff b;
    uint32_t last = 0;
    for (int k = 0; k < 40; ++k) {
      last = b.nextDelayMs(static_cast<float>(i) / 10.0f);
      TEST_ASSERT_TRUE(last <= 300000);
      TEST_ASSERT_TRUE(last >= 240000 || k < 9);
    }
    TEST_ASSERT_TRUE(last >= 240000);
  }
}

void test_jitter_is_clamped() {
  Backoff a;
  Backoff b;
  Backoff c;
  Backoff d;
  TEST_ASSERT_EQUAL_UINT32(1000, a.nextDelayMs(-3.0f));
  TEST_ASSERT_EQUAL_UINT32(800, b.nextDelayMs(7.0f));
  TEST_ASSERT_EQUAL_UINT32(1000, c.nextDelayMs(std::nanf("")));
  TEST_ASSERT_EQUAL_UINT32(800, d.nextDelayMs(1.0f));
}

void test_a_very_long_outage_cannot_overflow() {
  Backoff b;
  for (int i = 0; i < 100000; ++i) {
    TEST_ASSERT_TRUE(b.nextDelayMs(0.0f) <= 300000);
  }
  TEST_ASSERT_EQUAL_UINT32(300000, b.peekNominalMs());
}

void test_custom_base_and_max() {
  Backoff b(500, 3000);
  TEST_ASSERT_EQUAL_UINT32(500, b.nextDelayMs());
  TEST_ASSERT_EQUAL_UINT32(1000, b.nextDelayMs());
  TEST_ASSERT_EQUAL_UINT32(2000, b.nextDelayMs());
  TEST_ASSERT_EQUAL_UINT32(3000, b.nextDelayMs());
  TEST_ASSERT_EQUAL_UINT32(3000, b.nextDelayMs());
  // A max below the base is raised to the base; a zero base becomes 1 ms.
  Backoff odd(2000, 100);
  TEST_ASSERT_EQUAL_UINT32(2000, odd.nextDelayMs());
  TEST_ASSERT_EQUAL_UINT32(2000, odd.nextDelayMs());
  Backoff zero(0, 10);
  TEST_ASSERT_EQUAL_UINT32(1, zero.nextDelayMs());
  TEST_ASSERT_EQUAL_UINT32(2, zero.nextDelayMs());
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_doubles_from_one_second_to_the_cap);
  RUN_TEST(test_reset_starts_again);
  RUN_TEST(test_peek_does_not_advance);
  RUN_TEST(test_jitter_only_shortens_by_up_to_a_fifth);
  RUN_TEST(test_the_cap_holds_with_any_jitter);
  RUN_TEST(test_jitter_is_clamped);
  RUN_TEST(test_a_very_long_outage_cannot_overflow);
  RUN_TEST(test_custom_base_and_max);
  return UNITY_END();
}
