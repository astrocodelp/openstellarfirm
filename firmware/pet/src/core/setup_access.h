#pragma once

// Who may use the pet's own setup network, and for how long. Kept apart from the
// hardware so it can be tested.
//
// The setup network carries the home Wi-Fi password and the setup code, so it is
// not open. It is WPA2 with a passphrase that is made on the pet, once, and told to
// the owner only by the pet's own voice: whoever is not in the room hears nothing
// and cannot join, read a frame, or pair the pet into another account. The network
// is also switched off again when nobody finishes within a window, and a request
// to the page must come from the page itself: made to the pet's own address (never
// to a name, since the setup network's DNS answers every name with the pet, which
// would make any page already open in the phone's browser the same origin as the
// pet once the phone joins) and carrying a header a web page on another site cannot
// add without a pre-flight the pet never answers.
//
// docs/desk-pets-plan.md, "The setup network".

#include <cstddef>
#include <cstdint>
#include <string>

namespace pet {

// The setup network's passphrase: this many characters of the code alphabet, in
// lower case (a phone types lower case without being asked; the voice spells the
// same characters). 31 characters to the power of 12 is about 59 bits, out of
// reach of an offline guess at a captured handshake.
constexpr size_t kSetupPassphraseLength = 12;

// A passphrase from random bytes, each used only below the largest multiple of the
// alphabet's size that fits a byte (the first characters would be likelier
// otherwise). False when `count` bytes did not give enough characters: ask for
// more and try again.
bool makeSetupPassphrase(const uint8_t* random, size_t count, std::string& out);

// True for a passphrase this module could have made: exactly the length, every
// character a lower-case character of the alphabet. A damaged stored one is made
// again.
bool isSetupPassphrase(const std::string& text);

// The clips that spell `passphrase` (upper-cased, since the clips are named by the
// alphabet's letters), written to out[0..cap). Returns how many.
size_t spellSetupPassphrase(const std::string& passphrase, const char** out, size_t cap);

// The header the setup page adds to its own requests to /status and /join.
constexpr const char* kSetupHeaderName = "X-Pet-Setup";

// Whether a Host header names the setup network's own address (`apHost`, the access
// point's IP literal such as 192.168.4.1), compared without regard to case. The setup
// network's DNS resolves every name to the pet, so a request made to any other name is
// not from the page the pet served: it is a page from elsewhere (or a phone's captive
// portal check), and gets sent on to the address instead of an answer. An empty
// `apHost` matches nothing.
bool setupHostIsAccessPoint(const std::string& host, const std::string& apHost);

// Where a request to any other name is sent: the setup page at the pet's own address.
std::string setupPortalUrl(const std::string& apHost);

// Whether a request to /status or /join may be served: it was made to the pet's own
// address (setupHostIsAccessPoint), carries the header with the value 1, and, when the
// browser sent an Origin, that origin is this very page (http:// and `apHost`). A page
// on another site can send neither a custom header (that needs a pre-flight the pet
// never answers) nor an origin of the pet's, and a page rebound to the pet's address
// by the setup DNS is refused by its Host.
bool setupRequestAllowed(const std::string& setupHeader, const std::string& origin, const std::string& host,
                         const std::string& apHost);

// How long the setup network stays up with nobody finishing (ten minutes). It
// starts when the network opens and again after each try that did not pair; a
// try in progress is never cut off.
constexpr uint32_t kSetupWindowMs = 10u * 60u * 1000u;

class SetupWindow {
 public:
  // Starts the window now.
  void restart(uint32_t now) {
    since_ = now;
    started_ = true;
  }
  // True once kSetupWindowMs have passed since it was started (across the wrap of
  // the millisecond counter). A window never started is not over.
  bool over(uint32_t now) const { return started_ && static_cast<uint32_t>(now - since_) >= kSetupWindowMs; }

 private:
  uint32_t since_ = 0;
  bool started_ = false;
};

}  // namespace pet
