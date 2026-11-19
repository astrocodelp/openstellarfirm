#pragma once

#include <cstdint>
#include <string>

#include "core/usb_setup_rules.h"
#include "generated/protocol.h"
#include "net/wifi_setup.h"

namespace pet {

// Setting the pet up over the USB cable (pet-usb v2, core/usb_setup_rules.h for the
// wire). The OpenStellarFirm app opens the pet's data port with Web Serial, asks which pet it
// is, lists the networks the pet can see, tells it the computer's address, port, name and
// certificate fingerprint (`server`) and the Wi-Fi name and password (`wifi`), which only
// stage values in the pet's memory, and then the setup code the person made (`start`). The
// pet then joins, connects to that computer and pins its certificate, asks it to pair
// (rule 2, first step) and speaks its confirm code; the person types it in the app and the
// pet makes its one-time claim. The cable carries only what usb_setup_rules.h lists:
// never the device token, the device secret, an id, the confirm code or an echo of what
// the page sent.
//
// This class is the glue. It lives in the network task: service() reads what the
// computer sent without waiting, hands it to the pure codec and acts on it; a join
// waits here for the network task to take it (takeSubmission). The network task owns
// the Wi-Fi, so the try itself runs there (NetWorker::pairWith). Who may do what:
//
//   unpaired      hello, status, cancel always; scan, server, wifi, start and join when
//                 no try is running (the setup network's ten minutes need not be open:
//                 a cable is proof of presence, like a tap of the light)
//   a try running scan, server, wifi, start and join are refused "busy"
//   paired        hello only; everything else is refused "paired" and its values are
//                 never read (changing a paired pet's Wi-Fi stays the 10 second hold at
//                 power-on, then a new pairing)
//
// `server` and `wifi` are kept in RAM only, until `start` makes a try of them (and forgets
// them), a cancel, a new connection of the cable or the end of the power. `start` before
// both is "not_ready". A v1 `join` takes the staged server too, and is "not_ready"
// without one: the pet never pairs with a computer it was not told to pin.
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

  // A start (or a join) the computer sent and the pet accepted, once, with the staged
  // server in it. The caller starts the try.
  bool takeSubmission(SetupSubmission& out);

  // A start is waiting but the page's own submission won (the first one wins): forget
  // the waiting one and say "refused busy".
  void dropSubmission();

  // True once per cancel asked while a try was running; the try stops at its next step.
  bool takeCancel();

  // Tells the computer where the setup status stands, as a fixed state and, for an
  // error, a fixed code. The confirm code is never part of it.
  void report(SetupState state, SetupFailure failure);

 private:
  void handle(const UsbRequest& request, const Info& info);
  void sendOk(PetUsb2Op op);
  void sendNotReady();
  void sendHello(const Info& info);
  void sendStatus(const Info& info);
  void doScan(const Info& info);
  void send(const char* line, size_t length);
  bool sendPaced(const char* line, size_t length, uint32_t deadlineMs);

  PetKind kind_;
  UsbEndpoint endpoint_;
  bool wasConnected_ = false;

  // The accepted start, until the network task takes it.
  bool have_ = false;
  SetupSubmission pending_;
  bool cancel_ = false;

  // What `server` and `wifi` staged, in RAM only, until a start takes them.
  void clearStaged();
  bool hasServer_ = false;
  ServerRecord stagedServer_;
  bool hasWifi_ = false;
  UsbWifi stagedWifi_;

  // The last state a try reached, for the status op.
  bool stateKnown_ = false;
  PetUsbState lastState_ = PET_USB_STATE_JOINING;
  PetUsbError lastError_ = PET_USB_ERROR_WIFI_FAILED;
};

}  // namespace pet
