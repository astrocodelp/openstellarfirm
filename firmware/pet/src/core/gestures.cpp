#include "gestures.h"

namespace pet {

GestureEvent Gestures::update(bool pressedRaw, uint32_t nowMs) {
  if (!started_) {
    started_ = true;
    raw_ = pressedRaw;
    stable_ = pressedRaw;
    rawSince_ = nowMs;
    bootAt_ = nowMs;
    if (pressedRaw) {
      bootHeld_ = true;
      downAt_ = nowMs;
    }
    return GestureEvent::None;
  }

  if (tapPending_ && static_cast<uint32_t>(nowMs - tapUpAt_) > PET_DOUBLE_TAP_MS) {
    tapPending_ = false;
  }

  // Debounce: a change counts once the raw level has stayed there long enough.
  if (pressedRaw != raw_) {
    raw_ = pressedRaw;
    rawSince_ = nowMs;
  }
  if (raw_ != stable_ && static_cast<uint32_t>(nowMs - rawSince_) >= PET_BUTTON_DEBOUNCE_MS) {
    stable_ = raw_;
    if (stable_) {
      downAt_ = nowMs;
      holdSent_ = false;
      secondPress_ = tapPending_ && static_cast<uint32_t>(nowMs - tapUpAt_) <= PET_DOUBLE_TAP_MS;
      tapPending_ = false;
      return GestureEvent::Down;
    }
    // Released.
    if (bootHeld_) {
      bootHeld_ = false;
      resetSent_ = false;
      return GestureEvent::None;
    }
    if (holdSent_) {
      holdSent_ = false;
      secondPress_ = false;
      return GestureEvent::Up;
    }
    const uint32_t heldMs = static_cast<uint32_t>(nowMs - downAt_);
    if (heldMs < PET_TAP_MAX_MS) {
      if (secondPress_) {
        secondPress_ = false;
        tapPending_ = false;
        return GestureEvent::DoubleTap;
      }
      tapPending_ = true;
      tapUpAt_ = nowMs;
      return GestureEvent::Tap;
    }
    // A long press whose HoldStart was never seen (update() was not called for a
    // while). The talk never began; report only the end.
    secondPress_ = false;
    return GestureEvent::Up;
  }

  if (stable_ && !bootHeld_ && !holdSent_ && static_cast<uint32_t>(nowMs - downAt_) >= PET_TAP_MAX_MS) {
    holdSent_ = true;
    return GestureEvent::HoldStart;
  }
  if (stable_ && bootHeld_ && !resetSent_ && static_cast<uint32_t>(nowMs - bootAt_) >= PET_RESET_HOLD_MS) {
    resetSent_ = true;
    return GestureEvent::ResetHold;
  }
  return GestureEvent::None;
}

}  // namespace pet
