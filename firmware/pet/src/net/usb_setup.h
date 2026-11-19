#pragma once

#include <cstdint>
#include <string>

#include "core/usb_setup_rules.h"
#include "generated/protocol.h"
#include "net/wifi_setup.h"

namespace pet {

// Setting the pet up over the USB cable (pet-usb v1, core/usb_setup_rules.h for the
// wire). OpenStellarFirm web opens the pet's data port with Web Serial, asks which pet it
// is, lists the networks the pet can see and sends the Wi-Fi name, the Wi-Fi password
// and the setup code the signed-in person made. The pet then does what it does for the
// setup page: joins, asks OpenStellarFirm to pair (rule 2, first step) and speaks its
// confirm code; the person types it in OpenStellarFirm and the pet makes its one-time
// claim. The cable carries only what usb_setup_rules.h lists: never the device token,
// the device secret, an id, the confirm code or an echo of what the page sent.
//
// This class is the glue. It lives in the network task: service() reads what the
// computer sent without waiting, hands it to the pure codec and acts on it; a join
// waits here for the network task to take it (takeSubmission). The network task owns
// the Wi-Fi, so the try itself runs there (NetWorker::pairWith). Who may do what:
//
//   unpaired      hello, status, cancel always; scan and join when no try is running
//                 (the setup network's ten minutes need not be open: a cable is proof
//                 of presence, like a tap of the light)
//   a try running scan and join are refused "busy"
//   paired        hello only; everything else is refused "paired" and its values are
//                 never read (changing a paired pet's Wi-Fi stays the 10 second hold at
//                 power-on, then a new pairing)
//
// Replies go through hw/log.h's queue, which never waits for the computer.
class UsbSetup {
 public:
  // What the network task knows and the codec's rules need.
  struct Info {
    bool paired = false;     // the pet already has a token
    bool busy = false;       // a try is running
    bool setupOpen = false;  // the setup network's ten minutes are running
  };

  explicit UsbSetup(PetKind kind) : kind_(kind) {}

  // Reads what has arrived on the port (a bounded amount) and answers it. A scan
  // blocks for a few seconds, like the setup page's own. Call every few milliseconds.
  void service(const Info& info);

  // A join the computer sent and the pet accepted, once. The caller starts the try.
  bool takeSubmission(SetupSubmission& out);

  // A join is waiting but the page's own submission won (the first one wins): forget
  // the waiting one and say "refused busy".
  void dropSubmission();

  // True once per cancel asked while a try was running; the try stops at its next step.
  bool takeCancel();

  // Tells the computer where the setup status stands, as a fixed state and, for an
  // error, a fixed code. The confirm code is never part of it.
  void report(SetupState state, SetupFailure failure);

 private:
  void handle(const UsbRequest& request, const Info& info);
  void sendHello(const Info& info);
  void sendStatus(const Info& info);
  void doScan(const Info& info);
  void send(const char* line, size_t length);
  bool sendPaced(const char* line, size_t length, uint32_t deadlineMs);

  PetKind kind_;
  UsbEndpoint endpoint_;
  bool wasConnected_ = false;

  // The accepted join, until the network task takes it.
  bool have_ = false;
  SetupSubmission pending_;
  bool cancel_ = false;

  // The last state a try reached, for the status op.
  bool stateKnown_ = false;
  PetUsbState lastState_ = PET_USB_STATE_JOINING;
  PetUsbError lastError_ = PET_USB_ERROR_WIFI_FAILED;
};

}  // namespace pet
