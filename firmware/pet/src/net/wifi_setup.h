#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

class WebServer;
class DNSServer;

namespace pet {

// What the owner typed on the setup page, already checked (core/text_rules.h).
struct SetupSubmission {
  std::string ssid;
  std::string password;  // empty for an open network
  std::string code;      // the normalized setup code, ten characters
};

// Where the pet is in setup, as the page shows it.
enum class SetupState : uint8_t { Ready, Joining, Pairing, Confirm, Done, Error };

// Why a try ended in Error, as a fixed reason that carries no text and no value. The
// page shows its own message; a computer on the USB cable (net/usb_setup.h) is told
// only this.
enum class SetupFailure : uint8_t { None, WifiFailed, CodeRefused, Unreachable, TimedOut, SaveFailed };

// Told whenever the status changes (the network task is the only caller). `failure`
// is meaningful only for SetupState::Error.
using SetupStatusObserver = void (*)(void* context, SetupState state, SetupFailure failure);

// A Wi-Fi network a scan found.
struct WifiNetwork {
  std::string ssid;  // the raw bytes of the name
  int rssi = 0;
  bool locked = true;  // needs a password
};

// The pet joining a home Wi-Fi as a client, and keeping its clock.
class WifiLink {
 public:
  // One-time settings: the Wi-Fi library does not write the network into its own
  // flash area (the pet keeps its own copy in NVS, and forgetting wipes that one),
  // and reconnects by itself after a drop.
  static void prepare();

  // Starts joining and returns at once; poll connected(). `keepAccessPoint` keeps
  // the setup network up while the pet joins.
  static void beginJoin(const std::string& ssid, const std::string& password, bool keepAccessPoint);

  static bool connected();
  static int status();
  static int rssi();

  // Stops trying to join (keeps the setup network): a join that failed must not
  // go on retrying and pulling the setup network off its channel.
  static void abortJoin();

  // Looks for Wi-Fi networks (a few seconds; blocks the calling task). Hidden networks
  // and names the radio would not take are left out, the same name from several access
  // points shows once with its best signal, and the list is strongest first and at most
  // `maxNetworks` long. Turns the station on if it was off; leaves the setup network
  // alone. Not while a join is under way: it would cut the join.
  static void scan(std::vector<WifiNetwork>& out, size_t maxNetworks);

  // Starts the radio (station mode, nothing joined). The hardware random numbers
  // are true random only while the radio is on, so the setup network's passphrase
  // is made after this (main.cpp, at boot).
  static void startRadio();

  // Radio sleep between beacons, once joined: the idle power budget needs it.
  static void saveEnergy();

  // Leaves the network and switches the radio off.
  static void drop();

  // Asks the network time servers for the time (X-Pet-Recorded-At). Safe to call
  // again; the clock keeps itself right after the first answer.
  static void startClock();
};

// The pet's own Wi-Fi network and the setup page on it (access point, captive
// portal DNS, a small web server). Rule 2's first step: the page asks for the
// Wi-Fi password and the setup code the owner made; nothing else is served.
//
// The network is WPA2, with a passphrase made on the pet and told only by its
// voice (core/setup_access.h): the Wi-Fi password and the setup code go over an
// encrypted link to whoever heard it, and nobody else can join, read a frame, or
// pair the pet into another account. Only one phone can be on it at a time. It is
// up only while the pet is not paired, is switched off when pairing finishes and
// after ten minutes with nobody finishing (the network task decides that), and the
// page's requests must be made to its own address and carry the header only the
// page adds (setupRequestAllowed); a request to any other name is sent on to the
// address (the setup DNS answers every name, for the phone's captive portal check).
//
// service() runs in the network task; the web handlers run inside it.
class WifiSetup {
 public:
  WifiSetup();
  ~WifiSetup();
  WifiSetup(const WifiSetup&) = delete;
  WifiSetup& operator=(const WifiSetup&) = delete;

  // Brings the network and the page up. Looks for Wi-Fi networks first (a few
  // seconds). `petName` is shown on the page (Nova, Zib or Comet). `passphrase` is
  // the network's WPA2 passphrase (isSetupPassphrase); anything else, and the
  // network is not started: it is never open. True if the network is up.
  bool start(const std::string& networkName, const std::string& petName, const std::string& passphrase);
  void stop();
  bool running() const { return running_; }

  // Call every few milliseconds while running.
  void service();

  // True once per submission from the page.
  bool takeSubmission(SetupSubmission& out);

  // What the page shows next. `code` is the confirm code, in the Confirm state: it is
  // for the page alone and never reaches the observer. `failure` says why an Error
  // happened, for the observer.
  void setStatus(SetupState state, const std::string& message = std::string(), const std::string& code = std::string(),
                 SetupFailure failure = SetupFailure::None);
  SetupState state() const { return state_; }

  // Who is told about each status (the USB cable). One observer at most.
  void observe(SetupStatusObserver observer, void* context) {
    observer_ = observer;
    observerContext_ = context;
  }

  // Looks for networks again (the page's link does this too).
  void rescan();

 private:
  bool fromThePage();
  bool atMyAddress();
  void handleRoot();
  void handleStatus();
  void handleJoin();
  void handleRescan();
  void replyJson(int code, const std::string& json);
  void replyMessage(int code, const char* message);
  std::string networkOptions() const;

  std::unique_ptr<WebServer> server_;
  std::unique_ptr<DNSServer> dns_;
  std::string name_;
  std::string petName_;
  // The access point's own address as a Host header carries it (192.168.4.1).
  std::string apHost_;
  std::vector<WifiNetwork> networks_;
  bool running_ = false;
  // The web server keeps every handler it is given and has no way to remove one, so
  // they are added once, however many times the pet is set up (each Forget starts a
  // new setup). The handlers read this object's state, which outlives all of them.
  bool handlersAdded_ = false;
  bool have_ = false;
  SetupSubmission submission_;
  SetupState state_ = SetupState::Ready;
  std::string message_;
  std::string code_;
  SetupStatusObserver observer_ = nullptr;
  void* observerContext_ = nullptr;
};

}  // namespace pet
