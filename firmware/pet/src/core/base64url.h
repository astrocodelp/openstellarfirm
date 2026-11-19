#pragma once

// Base64url without padding (RFC 4648 section 5): the form the pet protocol
// uses for the device key, the device secret and the token (a 32-byte value is
// 43 characters).

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pet {

// Characters the encoding of `bytes` bytes takes.
size_t base64urlEncodedLength(size_t bytes);

std::string base64urlEncode(const uint8_t* data, size_t len);

// Decodes strictly: only the url-safe alphabet, no padding, no whitespace, a
// length that is not 1 more than a multiple of 4, and zero leftover bits (so
// every byte string has exactly one spelling). Returns false and leaves `out`
// empty on anything else.
bool base64urlDecode(const std::string& text, std::vector<uint8_t>& out);

}  // namespace pet
