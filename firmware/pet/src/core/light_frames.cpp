#include "light_frames.h"

namespace pet {

namespace {

// 0..255, smooth in and out, once per period, starting at 0.
uint8_t breath(uint32_t tMs, uint32_t periodMs) {
  const uint32_t phase = (tMs % periodMs) * 512 / periodMs;  // 0..511
  const uint32_t tri = phase < 256 ? phase : 511 - phase;    // 0..255
  // smoothstep: tri^2 * (3 - 2 tri) on a 0..255 scale
  return static_cast<uint8_t>(tri * tri * (765 - 2 * tri) / 65025);
}

uint8_t mix(uint8_t base, uint32_t amount, uint8_t of) {
  return static_cast<uint8_t>(base + (amount * of) / 255);
}

void setAll(Rgb out[PET_LED_COUNT_MAX], uint8_t count, Rgb colour) {
  for (uint8_t i = 0; i < count; ++i) {
    out[i] = colour;
  }
}

// The Ready breath: LED 0 between 12 and 70 of 255, the antennas a little under.
void readyFrame(Rgb out[PET_LED_COUNT_MAX], uint8_t count, uint32_t tMs) {
  const uint8_t level = mix(12, 58, breath(tMs, 6000));
  out[0] = scaleRgb(kLime, level);
  for (uint8_t i = 1; i < count; ++i) {
    out[i] = scaleRgb(kLime, static_cast<uint8_t>(level * 6 / 10));
  }
}

}  // namespace

uint8_t ledCount(PetKind kind) { return kind == PET_KIND_ALIEN ? 3 : 2; }

Rgb scaleRgb(Rgb colour, uint8_t level) {
  return Rgb{static_cast<uint8_t>((colour.r * level + 127) / 255), static_cast<uint8_t>((colour.g * level + 127) / 255),
             static_cast<uint8_t>((colour.b * level + 127) / 255)};
}

Rgb ledZeroBase(LightMode mode) {
  switch (mode) {
    case LightMode::Setup:
      return kSky;
    case LightMode::Ready:
    case LightMode::Listening:
    case LightMode::Thinking:
    case LightMode::TeamWorking:
    case LightMode::Done:
    case LightMode::Checked:
    case LightMode::ChargingIdle:
      return kLime;
    case LightMode::Speaking:
      return kIvory;
    case LightMode::NeedsApprove:
      return kNebula;
    case LightMode::Stopped:
    case LightMode::MicOff:
    case LightMode::LowBattery:
      return kRose;
    case LightMode::OfflineSaving:
      return kMoon;
    case LightMode::Off:
    case LightMode::Quiet:
      return kDark;
  }
  return kDark;
}

void frame(LightMode mode, PetKind kind, uint32_t tMs, uint8_t voiceLevel, Rgb out[PET_LED_COUNT_MAX], uint8_t& count) {
  count = ledCount(kind);
  for (uint8_t i = 0; i < PET_LED_COUNT_MAX; ++i) {
    out[i] = kDark;
  }
  const uint8_t antennas = static_cast<uint8_t>(count - 1);

  switch (mode) {
    case LightMode::Off:
      break;

    case LightMode::Setup: {
      // The chest light blinks slowly; the antennas take turns in between.
      if (tMs % 2000 < 1000) {
        out[0] = kSky;
      }
      const uint32_t step = (tMs / 400) % (antennas + 1u);
      if (step < antennas) {
        out[step + 1] = scaleRgb(kSky, 160);
      }
      break;
    }

    case LightMode::Ready:
      readyFrame(out, count, tMs);
      break;

    case LightMode::Listening:
      // Rule 4: solid and full, at every time, for every figure.
      out[0] = kLime;
      for (uint8_t i = 1; i < count; ++i) {
        out[i] = scaleRgb(kLime, 100);
      }
      break;

    case LightMode::Thinking: {
      // A pulse once a second, never as bright as Listening.
      const uint8_t level = mix(40, 175, breath(tMs, 1000));
      out[0] = scaleRgb(kLime, level);
      for (uint8_t i = 1; i < count; ++i) {
        out[i] = scaleRgb(kLime, static_cast<uint8_t>(level / 2));
      }
      break;
    }

    case LightMode::Speaking: {
      const uint8_t level = static_cast<uint8_t>(40 + (static_cast<uint32_t>(voiceLevel) * 215) / 255);
      out[0] = scaleRgb(kIvory, level);
      for (uint8_t i = 1; i < count; ++i) {
        out[i] = scaleRgb(kIvory, static_cast<uint8_t>(level / 2));
      }
      break;
    }

    case LightMode::TeamWorking: {
      out[0] = scaleRgb(kLime, 24);
      // One antenna (or the dome) breathes slowly; Zib's two take turns.
      out[1] = scaleRgb(kLime, breath(tMs, 2400));
      if (antennas > 1) {
        out[2] = scaleRgb(kLime, breath(tMs + 1200, 2400));
      }
      break;
    }

    case LightMode::NeedsApprove:
      if (tMs % 2000 < 400) {
        setAll(out, count, kNebula);
      }
      break;

    case LightMode::Done: {
      // Three sparkles 300 ms apart, each 150 ms long and at full lime; each one
      // lights a different antenna. Then the Ready breath takes over.
      constexpr uint32_t kSparkleEnd = 1050;
      if (tMs >= kSparkleEnd) {
        readyFrame(out, count, tMs - kSparkleEnd);
        break;
      }
      out[0] = scaleRgb(kLime, 30);
      const uint32_t slot = tMs / 300;
      if (slot < 3 && tMs % 300 < 150) {
        out[0] = kLime;
        out[1 + (slot % antennas)] = kLime;
      }
      break;
    }

    case LightMode::Checked: {
      // "I looked, nothing waits": the antenna or dome blinks lime once for 200 ms while
      // the chest light stays dim, so it is never taken for Listening (whose chest
      // light is solid and full). Then the Ready breath takes over.
      constexpr uint32_t kBlinkEnd = 200;
      if (tMs >= kBlinkEnd) {
        readyFrame(out, count, tMs - kBlinkEnd);
        break;
      }
      out[0] = scaleRgb(kLime, 30);
      for (uint8_t i = 1; i < count; ++i) {
        out[i] = kLime;
      }
      break;
    }

    case LightMode::Stopped: {
      // Two blinks close together, then a pause.
      const uint32_t p = tMs % 1500;
      if (p < 150 || (p >= 300 && p < 450)) {
        setAll(out, count, kRose);
      }
      break;
    }

    case LightMode::OfflineSaving:
      out[0] = scaleRgb(kMoon, mix(10, 80, breath(tMs, 4000)));
      break;

    case LightMode::MicOff:
      out[0] = scaleRgb(kRose, 40);
      break;

    case LightMode::LowBattery:
      if (tMs % 10000 < 200) {
        out[0] = kRose;
      }
      break;

    case LightMode::ChargingIdle: {
      // A ramp that fills up and starts again.
      const uint8_t level = static_cast<uint8_t>(20 + (tMs % 3000) * 180 / 3000);
      out[0] = scaleRgb(kLime, level);
      for (uint8_t i = 1; i < count; ++i) {
        out[i] = scaleRgb(kLime, static_cast<uint8_t>(level / 2));
      }
      break;
    }

    case LightMode::Quiet:
      // Quiet hours: LED 0 off, the antenna or dome a faint moon (2 percent).
      for (uint8_t i = 1; i < count; ++i) {
        out[i] = scaleRgb(kMoon, 5);
      }
      break;
  }
}

const char* lightModeName(LightMode mode) {
  switch (mode) {
    case LightMode::Off:
      return "off";
    case LightMode::Setup:
      return "setup";
    case LightMode::Ready:
      return "ready";
    case LightMode::Listening:
      return "listening";
    case LightMode::Thinking:
      return "thinking";
    case LightMode::Speaking:
      return "speaking";
    case LightMode::TeamWorking:
      return "team-working";
    case LightMode::NeedsApprove:
      return "needs-approve";
    case LightMode::Done:
      return "done";
    case LightMode::Stopped:
      return "stopped";
    case LightMode::OfflineSaving:
      return "offline-saving";
    case LightMode::MicOff:
      return "mic-off";
    case LightMode::LowBattery:
      return "low-battery";
    case LightMode::ChargingIdle:
      return "charging-idle";
    case LightMode::Quiet:
      return "quiet";
    case LightMode::Checked:
      return "checked";
  }
  return "?";
}

}  // namespace pet
