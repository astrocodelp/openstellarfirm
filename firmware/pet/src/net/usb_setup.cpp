#include "net/usb_setup.h"

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <utility>
#include <vector>

#include "config.h"
#include "hw/log.h"

#ifdef PET_DEVBOARD
#include "devboard/bridge.h"
#endif

namespace {

// What the computer sent. On the development board the bridge reads the port and
// passes the pet-usb lines on (devboard/bridge.h); on the pet it is the port itself.
#ifdef PET_DEVBOARD
int serialInAvailable() { return pet::devboard::setupAvailable(); }
int serialInRead() { return pet::devboard::setupRead(); }
#else
int serialInAvailable() { return Serial.available(); }
int serialInRead() { return Serial.read(); }
#endif

}  // namespace

namespace pet {

namespace {

// Bytes read from the port in one call, so a flood costs the network task a bounded
// moment (the port's receive queue holds 1024).
constexpr size_t kReadBudget = 1024;
// A scan's answer is up to 21 lines; the port takes 64 bytes at a time. This is how long
// the pet waits for a slow reader before it gives up on the rest of the list.
constexpr uint32_t kScanReplyMs = 2000;
constexpr uint32_t kReplyWaitStepMs = 2;

}  // namespace

void UsbSetup::send(const char* line, size_t length) {
  if (length == 0) {
    return;  // a builder refused its arguments
  }
  // Dropped when the port has no room: a reply is never worth waiting for.
  serialSendLine(reinterpret_cast<const uint8_t*>(line), length);
}

bool UsbSetup::sendPaced(const char* line, size_t length, uint32_t deadlineMs) {
  if (length == 0) {
    return false;
  }
  for (;;) {
    const SerialSend sent = serialSendLine(reinterpret_cast<const uint8_t*>(line), length);
    if (sent == SerialSend::Queued) {
      return true;
    }
    if (sent == SerialSend::NotConnected || static_cast<int32_t>(millis() - deadlineMs) >= 0) {
      return false;
    }
    vTaskDelay(pdMS_TO_TICKS(kReplyWaitStepMs));
    serialPump();
  }
}

void UsbSetup::sendHello(const Info& info) {
  char line[kUsbReplyCapacity];
  const size_t length = usbHelloLine(line, sizeof(line), kind_, PET_FIRMWARE_VERSION, info.paired, info.setupOpen);
  if (length == 0) {
    // A build that sets PET_FIRMWARE_VERSION to something that is not a version number.
    PET_LOG("usb: the firmware version is not shaped like a version, so there is no hello");
  }
  send(line, length);
}

// The last state a try reached, or hello when none has: a computer that connected late
// (a reloaded page, a cable pulled and plugged back) learns where things stand.
void UsbSetup::sendStatus(const Info& info) {
  if (!stateKnown_) {
    sendHello(info);
    return;
  }
  char line[kUsbReplyCapacity];
  send(line, usbStateLine(line, sizeof(line), lastState_, lastError_));
}

void UsbSetup::doScan(const Info& info) {
  std::vector<WifiNetwork> found;
  WifiLink::scan(found, PET_USB_MAX_NETWORKS);
  PET_LOG("usb: a scan found %u networks", static_cast<unsigned>(found.size()));

  const uint32_t deadline = millis() + kScanReplyMs;
  size_t sent = 0;
  char line[kUsbReplyCapacity];
  for (const WifiNetwork& network : found) {
    const size_t length = usbNetLine(line, sizeof(line), reinterpret_cast<const uint8_t*>(network.ssid.data()), network.ssid.size(),
                                     network.rssi, network.locked);
    if (length == 0) {
      continue;  // a name the protocol would not carry
    }
    if (!sendPaced(line, length, deadline)) {
      break;
    }
    ++sent;
  }
  sendPaced(line, usbScanDoneLine(line, sizeof(line), sent), deadline + kScanReplyMs);

  // With the setup network not up the radio was off before the scan turned it on:
  // leave it as it was found, unless a join has it.
  if (!info.setupOpen && !WifiLink::connected()) {
    WifiLink::drop();
  }
}

void UsbSetup::handle(const UsbRequest& request, const Info& info) {
  switch (request.op) {
    case PET_USB_OP_HELLO:
      sendHello(info);
      break;
    case PET_USB_OP_STATUS:
      sendStatus(info);
      break;
    case PET_USB_OP_CANCEL:
      if (info.busy) {
        // The try stops at its next step and says so with a state line of its own.
        cancel_ = true;
      } else {
        if (have_) {
          have_ = false;
          pending_ = SetupSubmission();
        }
        sendStatus(info);
      }
      break;
    case PET_USB_OP_SCAN:
      doScan(info);
      break;
    case PET_USB_OP_JOIN:
      pending_.ssid = request.join.ssid;
      pending_.password = request.join.password;
      pending_.code = request.join.code;
      have_ = true;
      cancel_ = false;
      PET_LOG("usb: a join was accepted");
      break;
  }
}

void UsbSetup::service(const Info& info) {
  serialPump();

  // A new connection starts clean: no half line from an earlier one.
  const bool connected = static_cast<bool>(Serial);
  if (connected != wasConnected_) {
    wasConnected_ = connected;
    endpoint_.reset();
  }

  UsbInbound inbound;
  for (size_t budget = kReadBudget; budget > 0 && serialInAvailable() > 0; --budget) {
    const int c = serialInRead();
    if (c < 0) {
      break;
    }
    // Read afresh for each byte: a join accepted a moment ago makes the pet busy.
    UsbPolicy policy;
    policy.paired = info.paired;
    policy.busy = info.busy || have_;
    // The time is read for each byte: a scan in the middle of a chunk takes seconds.
    if (!endpoint_.push(static_cast<uint8_t>(c), millis(), policy, inbound)) {
      continue;
    }
    if (inbound.what == UsbWhat::Refusal) {
      char line[kUsbReplyCapacity];
      send(line, usbRefusedLine(line, sizeof(line), inbound.refusal));
    } else if (inbound.what == UsbWhat::Request) {
      handle(inbound.request, info);
    }
    inbound = UsbInbound();  // nothing of a join (its password) is kept in here
  }
}

bool UsbSetup::takeSubmission(SetupSubmission& out) {
  if (!have_) {
    return false;
  }
  out = std::move(pending_);
  pending_ = SetupSubmission();
  have_ = false;
  return true;
}

void UsbSetup::dropSubmission() {
  if (!have_) {
    return;
  }
  have_ = false;
  pending_ = SetupSubmission();
  char line[kUsbReplyCapacity];
  send(line, usbRefusedLine(line, sizeof(line), PET_USB_REFUSAL_BUSY));
}

bool UsbSetup::takeCancel() {
  const bool asked = cancel_;
  cancel_ = false;
  return asked;
}

// The setup page's status, said over the cable as a fixed word and, for an error, a
// fixed code. SetupState::Ready (a new setup window opened) says nothing; the page's
// own message and the confirm code are never passed on.
void UsbSetup::report(SetupState state, SetupFailure failure) {
  PetUsbState usbState = PET_USB_STATE_JOINING;
  PetUsbError usbError = PET_USB_ERROR_UNREACHABLE;
  switch (state) {
    case SetupState::Ready:
      return;
    case SetupState::Joining:
      usbState = PET_USB_STATE_JOINING;
      break;
    case SetupState::Pairing:
      usbState = PET_USB_STATE_PAIRING;
      break;
    case SetupState::Confirm:
      usbState = PET_USB_STATE_CONFIRM;
      break;
    case SetupState::Done:
      usbState = PET_USB_STATE_DONE;
      break;
    case SetupState::Error:
      usbState = PET_USB_STATE_ERROR;
      switch (failure) {
        case SetupFailure::WifiFailed:
          usbError = PET_USB_ERROR_WIFI_FAILED;
          break;
        case SetupFailure::CodeRefused:
          usbError = PET_USB_ERROR_CODE_REFUSED;
          break;
        case SetupFailure::Unreachable:
        case SetupFailure::None:  // an error nobody gave a reason for
          usbError = PET_USB_ERROR_UNREACHABLE;
          break;
        case SetupFailure::TimedOut:
          usbError = PET_USB_ERROR_TIMED_OUT;
          break;
        case SetupFailure::SaveFailed:
          usbError = PET_USB_ERROR_SAVE_FAILED;
          break;
      }
      break;
  }
  stateKnown_ = true;
  lastState_ = usbState;
  lastError_ = usbError;
  char line[kUsbReplyCapacity];
  send(line, usbStateLine(line, sizeof(line), usbState, usbError));
}

}  // namespace pet
