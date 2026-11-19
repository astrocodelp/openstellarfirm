// The bring-up firmware (env bringup): the checks of "Bring-up checklist" in
// hardware/pets/README.md, step 3 to 5, without any network.
//
//   every second   battery volts, charger, USB power, skin ID (mV and figure),
//                  MIC switch and button, on the serial port
//   at start       each LED in turn: lime, sky, nebula, rose
//                  a 1 kHz tone for 1 second
//   button held    logged, LED 0 turns lime, and the microphone records for as long
//                  as it is held (3 seconds at most), then plays it back
//   MIC switch off logged, and LED 0 turns a dim rose
//   serial         't' tone, 'l' lights again ('r' only reminds you to hold the button)
//
// Rule 4 holds here too: the microphone never runs unless the lime light (the
// button) is held, and never with the MIC switch off. Nothing starts it by itself,
// at power-up or from the serial port.
//
// It uses the same drivers as the pet (audio/, ui/, hw/), at the microphone's own
// 16 kHz so a recording plays back without being resampled.
#include <Arduino.h>
#include <esp_heap_caps.h>

#include "audio/mic.h"
#include "audio/speaker.h"
#include "core/adpcm.h"
#include "core/battery.h"
#include "core/light_frames.h"
#include "core/skin_id.h"
#include "core/wav.h"
#include "hw/log.h"
#include "hw/power.h"
#include "hw/skin.h"
#include "pins.h"
#include "ui/button.h"
#include "ui/lights.h"

using namespace pet;

namespace {

Lights lights;
Button button;
Power power;
Speaker speaker;
Mic mic;
PetKindOrNone skin;
PetKind kind = PET_DEFAULT_KIND;

constexpr uint32_t kRecordMs = 3000;

void onMicIndicator(bool on, void*) { lights.setMicLive(on); }

void say(const char* text) {
  // Bring-up is run with a cable attached; print even before a terminal is open.
  Serial.print("[bringup] ");
  Serial.println(text);
}

void lightTest() {
  say("lights: each LED in turn, lime, sky, nebula, rose");
  const Rgb colours[] = {kLime, kSky, kNebula, kRose};
  const uint8_t count = ledCount(kind);
  for (uint8_t led = 0; led < count; ++led) {
    for (const Rgb& colour : colours) {
      Rgb frame[PET_LED_COUNT_MAX] = {};
      frame[led] = colour;
      lights.setDirect(frame, PET_LED_COUNT_MAX);
      delay(400);
    }
  }
  const Rgb dark[PET_LED_COUNT_MAX] = {};
  lights.setDirect(dark, PET_LED_COUNT_MAX);
}

void toneTest() {
  say("speaker: 1 kHz for 1 second");
  speaker.playToneBlocking(1000, 1000);
}

// Records while the button is held, at most kRecordMs, then plays it back. Called
// when the button goes down; the microphone stops the moment it is let go, the MIC
// switch goes off or the time is up.
void recordWhileHeld() {
  if (!power.micSwitchOn()) {
    say("microphone: the MIC switch is off, slide it on and hold the lime light");
    return;
  }
  say("microphone: recording while you hold the lime light, 3 seconds at most (LED 0 must be solid lime)");
  if (!mic.start(0)) {
    say("microphone: the receiver did not start");
    return;
  }
  const uint32_t startedAt = millis();
  for (;;) {
    const uint32_t now = millis();
    button.poll(now);  // the debounced state, so a bounce on the press does not end it
    if (!button.pressed() || !power.micSwitchOn() || static_cast<uint32_t>(now - startedAt) >= kRecordMs) {
      break;
    }
    if (!mic.pump()) {
      delay(1);
    }
  }
  const Recording recording = mic.stop();
  Serial.printf("[bringup] recorded %u samples, %u bytes of ADPCM\n", static_cast<unsigned>(recording.samples),
                static_cast<unsigned>(recording.bytes));
  if (!recording.valid()) {
    say("microphone: nothing was recorded");
    return;
  }

  int16_t* pcm = static_cast<int16_t*>(heap_caps_malloc(recording.samples * sizeof(int16_t), MALLOC_CAP_SPIRAM));
  if (pcm == nullptr) {
    say("playback: no memory for the decoded audio");
    return;
  }
  const size_t decoded = adpcmDecode(recording.wav + kImaWavHeaderBytes, recording.bytes - kImaWavHeaderBytes, PET_ADPCM_BLOCK_ALIGN,
                                     pcm, recording.samples);
  // Peak level, so a dead microphone is plain to see.
  int32_t peak = 0;
  for (size_t i = 0; i < decoded; ++i) {
    const int32_t magnitude = pcm[i] < 0 ? -static_cast<int32_t>(pcm[i]) : pcm[i];
    peak = magnitude > peak ? magnitude : peak;
  }
  Serial.printf("[bringup] decoded %u samples, peak level %ld of 32767\n", static_cast<unsigned>(decoded), static_cast<long>(peak));
  say("speaker: playing it back");
  speaker.playBlocking(pcm, decoded);
  heap_caps_free(pcm);
}

void printStatus() {
  const PowerReading reading = power.read();
  const int skinMv = readSkinMillivolts();
  const PetKindOrNone found = skinFromMillivolts(skinMv);
  Serial.printf("[bringup] battery %.2f V (%d%%)  charging %s  usb %s  skin %d mV = %s  mic switch %s  button %s\n",
                static_cast<double>(reading.volts), static_cast<int>(reading.fraction * 100.0f), reading.charging ? "yes" : "no",
                reading.usbPresent ? "yes" : "no", skinMv, skinWireName(found), power.micSwitchOn() ? "on" : "OFF",
                button.pressedNow() ? "DOWN" : "up");
}

}  // namespace

void setup() {
  Serial.begin(115200);
  const uint32_t waitUntil = millis() + 3000;
  while (!Serial && static_cast<int32_t>(millis() - waitUntil) < 0) {
    delay(10);
  }
  say("OpenStellarFirm desk pet bring-up");

  // After a battery cut-off of the pet firmware the pin is still held low through the
  // sleep; let go of it first so the amplifier can be driven.
  Power::releaseAmplifierHold();
  pinMode(PIN_AMP_SD, OUTPUT);
  digitalWrite(PIN_AMP_SD, LOW);
  button.begin();
  power.begin();
  skin = readSkin();
  kind = kindOrDefault(skin);
  Serial.printf("[bringup] figure on the pad: %s (%s)\n", skinWireName(skin), PET_KIND_NAMES[kind]);

  lights.begin(kind);
  if (!mic.begin()) {
    say("microphone: could not make the recording buffers");
  }
  mic.setIndicator(&onMicIndicator, nullptr);
  // The microphone's own rate, so playback needs no resampling.
  if (!speaker.begin(PET_UP_SAMPLE_RATE)) {
    say("speaker: did not start");
  }
  speaker.setVolume(0.6f);

  lightTest();
  toneTest();
  say("ready: hold the lime light to record and hear yourself, slide MIC off, or send t or l over serial");
}

void loop() {
  // What the firmware's own log (hw/log.h, used by the microphone code) left queued
  // leaves as the port takes it.
  serialPump();
  static uint32_t lastStatusMs = 0;
  static bool lastDown = false;
  static bool lastHeld = false;
  static bool lastMicOn = true;

  const uint32_t now = millis();
  button.poll(now);
  const bool down = button.pressedNow();
  const bool micOn = power.micSwitchOn();

  if (down != lastDown) {
    lastDown = down;
    say(down ? "button: pressed" : "button: released");
  }
  // The one thing that starts the microphone: the button going down (debounced).
  const bool held = button.pressed();
  if (held && !lastHeld) {
    recordWhileHeld();
  }
  lastHeld = held;
  if (micOn != lastMicOn) {
    lastMicOn = micOn;
    say(micOn ? "MIC switch: on" : "MIC switch: off");
  }
  // LED 0 shows what is being checked: lime for the button, a dim rose for MIC off.
  Rgb frame[PET_LED_COUNT_MAX] = {};
  if (down) {
    frame[0] = kLime;
  } else if (!micOn) {
    frame[0] = scaleRgb(kRose, 60);
  }
  lights.setDirect(frame, PET_LED_COUNT_MAX);

  if (static_cast<uint32_t>(now - lastStatusMs) >= 1000) {
    lastStatusMs = now;
    printStatus();
  }

  while (Serial.available() > 0) {
    switch (Serial.read()) {
      case 't':
        toneTest();
        break;
      case 'r':
        // Rule 4: a serial command never starts the microphone, the button does.
        say("microphone: hold the lime light to record");
        break;
      case 'l':
        lightTest();
        break;
      default:
        break;
    }
  }
  delay(10);
}
