#pragma once

#include "generated/protocol.h"

// Build-time settings of the desk pet firmware. Timings that belong to the
// protocol (the 120 second recording cap, the 5 seconds of silence that end a
// recording, the heartbeat, the upload size) come from generated/protocol.h and
// are never repeated here.

// Where the pet talks to. HTTPS only (rule 7): the firmware refuses to start a
// call when this is not an https:// address (isHttpsBase in core/api_rules.h).
// To point a unit at a development server, build with
//   PLATFORMIO_BUILD_FLAGS='-DPET_API_BASE=\"https://my-dev-host.example\"'
// A server on plain http is not supported; use an https tunnel.
#ifndef PET_API_BASE
// A placeholder until phase P5 of docs/desk-pets-plan.md: the app's own address and
// certificate pin are then learned at pairing. Until then a build names its server.
#define PET_API_BASE "https://openstellarfirm.example"
#endif

// The development board build (env devboard, src/devboard/bridge.h) pairs as a
// hardware of its own, so it is never taken for a pet, and plays one figure, since a
// bare board has no skin ID resistor.
#ifdef PET_DEVBOARD
#define PET_PAIR_HARDWARE_ID "nano-esp32-devboard"
#ifndef PET_DEVBOARD_KIND
#define PET_DEVBOARD_KIND PET_KIND_ASTRONAUT
#endif
#else
#define PET_PAIR_HARDWARE_ID PET_HARDWARE_ID
#endif

// What the heartbeat reports as `firmware` (at most 20 characters).
#ifndef PET_FIRMWARE_VERSION
#define PET_FIRMWARE_VERSION "0.1.0"
#endif

// Network timeouts. The inbox long-poll asks the server to wait up to
// PET_INBOX_WAIT_MAX_SECONDS, so its HTTP timeout is a few seconds longer.
//
// A turn's timeout covers the wait for the response headers once the upload is out
// (the client applies it to each read and write, not to the whole call). The server
// answers only after it has transcribed up to PET_RECORD_MAX_SECONDS of speech (two
// minutes), waited up to PET_FIRST_ANSWER_WAIT_SECONDS for the team's first answer and
// made the speech. 60 seconds are allowed for the transcription and the speech
// together, on top of that wait: 85 seconds in all, the least that does not give up on
// a turn the server has.
//
// The upload itself goes before that wait starts. A full recording is 966,716 bytes
// (core/recording_plan.h); PET_TURN_UPLOAD_SECONDS is what a poor but working Wi-Fi
// link is given for it (about 170 kbit/s). The state machine's Sending watchdog
// (kSendingWatchdogMs, 150 seconds) counts from the start of the upload, so it holds
// that upload, then this timeout, then a margin; test_pet_app checks that the three
// stay in that order.
#define PET_HTTP_TIMEOUT_MS 15000
#define PET_INBOX_WAIT_SECONDS PET_INBOX_WAIT_MAX_SECONDS
#define PET_INBOX_HTTP_TIMEOUT_MS 25000
#define PET_TURN_UPLOAD_SECONDS 45
#define PET_TURN_SERVER_WORK_SECONDS 60
#define PET_TURN_HTTP_TIMEOUT_MS ((PET_FIRST_ANSWER_WAIT_SECONDS + PET_TURN_SERVER_WORK_SECONDS) * 1000)

// Retry backoff after a failed call: 1 s, 2 s, 4 s ... up to 5 minutes.
#define PET_BACKOFF_BASE_MS 1000
#define PET_BACKOFF_MAX_MS 300000

// The talk button. A press must be steady for the debounce time to count; a
// press shorter than PET_TAP_MAX_MS is a tap, a longer one is the talk hold. A
// second tap within PET_DOUBLE_TAP_MS of the first one's release is a double
// tap. Holding the button for PET_RESET_HOLD_MS from power-on forgets the pet.
#define PET_BUTTON_DEBOUNCE_MS 25
#define PET_TAP_MAX_MS 400
#define PET_DOUBLE_TAP_MS 350
#define PET_RESET_HOLD_MS 10000

// The lights task draws a frame this often (50 Hz).
#define PET_LIGHT_FRAME_MS 20

// The speaker starts playing after this much of a reply is buffered.
#define PET_JITTER_START_MS 250

// Saved notes. A note is refused when its audio plus this reserve would not fit
// in the free flash, so the voice pack and the settings never run out of room. A
// note can be as long as a recording, 120 seconds, which is 966,716 bytes of ADPCM:
// the flash (about 9.4 MB, shared with the voice pack) holds six or more of those, and a
// full flash says "memory-full" (core/note_queue.h, AddResult::NoSpace).
#define PET_NOTE_RESERVE_BYTES (64 * 1024)

// Battery, in volts at VSYS (the rail the 220 k / 220 k divider reads). Below
// the first the pet asks for the charger; below the second it shuts down under
// load.
#define PET_LOW_BATTERY_VOLTS 3.6f
#define PET_CRITICAL_BATTERY_VOLTS 3.5f
