#pragma once

#include <Arduino.h>

#include <cstddef>
#include <cstdint>

// The serial log, and the one way anything is written to the pet's USB serial port. It
// prints only while a terminal is attached (`Serial` is false on the Nano ESP32's USB
// serial when nobody has the port open), so a pet on a desk with no computer never
// waits on a full serial buffer.
//
// The port is shared with the setup protocol (net/usb_setup.h): the pet's replies and
// the log lines go through the same queue, each as a whole line, so the two never cut
// into each other, and the page drops every line that does not start with "@pet1 ".
//
// Nothing here ever waits for the computer. The port's own send buffer is 64 bytes
// and Serial.write() spins, holding the chip's other work back, until the computer
// has read what does not fit, so a computer that opens the port and reads nothing
// would freeze the pet. A line therefore goes into a small queue (core/line_queue.h)
// and leaves in pieces, never more than the port says it can take at once; a line
// that does not fit in the queue is dropped.
//
// What may be logged: states, counts, status codes, names of events. Never a device
// token, a device secret, a Wi-Fi name or password, a setup or confirm code, a header,
// a URL with an id in it, or anything the owner said.

namespace pet {

enum class SerialSend : uint8_t {
  Queued,        // the whole line is queued; it leaves as the port takes it
  NoRoom,        // the queue is full (or busy): the line was dropped
  NotConnected,  // nobody has the port open: nothing was queued
};

// Queues one whole line (its newline included). Safe from any task; never waits for
// the computer. Not for an interrupt.
SerialSend serialSendLine(const uint8_t* line, size_t length);

// Moves queued bytes to the port as far as it has room right now. Cheap when there is
// nothing queued; call it often (the main loop and the network task do).
void serialPump();

// printf into one log line. Prefer the PET_LOG macro below.
void logLine(const char* format, ...) __attribute__((format(printf, 1, 2)));

}  // namespace pet

#define PET_LOG(fmt, ...) ::pet::logLine("[pet] " fmt "\n", ##__VA_ARGS__)
