#pragma once

// Small text rules the setup page and the network code need, kept apart from the
// hardware so they can be tested: escaping what goes into HTML, checking what
// the owner typed on the setup page, the name of the pet's own Wi-Fi network, the
// time stamp of a recording, and spotting the pairing greeting.

#include <cstdint>
#include <string>

#include "generated/protocol.h"

namespace pet {

// Text for the inside of an HTML element or a quoted attribute: & < > " ' and
// every control character become character references, so a Wi-Fi network named
// <script>... shows as text and never runs. Bytes of UTF-8 pass through.
std::string htmlEscape(const std::string& text);

// What the owner typed as the setup code, made ready to send: letters upper case,
// every character that is not a letter or digit dropped (the dash, spaces), and
// accepted only when exactly PET_SETUP_CODE_LENGTH characters of the code
// alphabet are left. The server checks again; this only saves a round trip.
bool normalizeSetupCode(const std::string& typed, std::string& out);

// A network name the radio accepts: 1 to 32 bytes and no control character.
bool isPlausibleSsid(const std::string& ssid);

// A WPA2 passphrase (8 to 63 printable characters, or 64 hex digits for a raw
// key), or empty for an open network.
bool isPlausiblePassword(const std::string& password);

// "OpenStellarFirm Nova 1A2B": the pet's own network, with the last two bytes of its
// Wi-Fi address so two pets in one room tell apart.
std::string apName(PetKind kind, uint8_t macByteFive, uint8_t macByteSix);

// "2026-10-21T14:02:00Z" for the X-Pet-Recorded-At header, written to out[21].
// False, and out left empty, when the clock was not set yet (a year before
// 2024) or a field is out of range, so the header is simply left out.
bool formatIsoUtc(int year, int month, int day, int hour, int minute, int second, char out[21]);

// A 32-bit key for a chat or run id a turn answer or a notice names (FNV-1a), so
// the state machine can tell that two of them are about the same work without
// holding the ids. 0 means "no id": an empty or missing id, or one longer than
// the 64 characters the server ever sends. A real id never gives 0.
uint32_t idKey(const char* id);

// The server's greeting at pairing: "Hi, I'm <name>. Hold my lime light and talk
// to me." The pet plays its own "hello" clip when it cannot fetch it spoken.
bool isPairingHello(const char* line);

}  // namespace pet
