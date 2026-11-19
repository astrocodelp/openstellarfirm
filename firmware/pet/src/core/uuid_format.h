#pragma once

// A version 4 UUID in its text form, from 16 random bytes the caller got from
// the hardware random source (esp_fill_random). The turn id of every upload
// (X-Pet-Turn) is one: it is made once when the recording ends, so a retry
// sends the same id and the server answers 208 instead of asking twice.

#include <cstddef>
#include <cstdint>
#include <string>

namespace pet {

constexpr size_t kUuidTextLength = 36;

// Writes "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" (lowercase hex, the version
// nibble 4, the variant bits 10) and a terminating NUL into out[37].
void formatUuidV4(const uint8_t random16[16], char out[kUuidTextLength + 1]);

std::string uuidV4(const uint8_t random16[16]);

// True for the 8-4-4-4-12 hex form (either case); it does not check the version.
bool isUuidText(const char* text);

}  // namespace pet
