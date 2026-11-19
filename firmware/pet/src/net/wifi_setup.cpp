#include "net/wifi_setup.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include <algorithm>

#include "core/setup_access.h"
#include "core/text_rules.h"
#include "hw/log.h"
#include "net/setup_page.h"

namespace pet {

namespace {

constexpr size_t kMaxNetworks = 24;
// One phone at a time on the setup network.
constexpr int kSetupChannel = 1;
constexpr int kSetupMaxClients = 1;
// The request headers the handlers read. The Host header is always kept.
const char* kCollectedHeaders[] = {kSetupHeaderName, "Origin"};

std::string toJson(const JsonDocument& doc) {
  const size_t n = measureJson(doc);
  std::string out(n, '\0');
  serializeJson(doc, &out[0], n + 1);
  return out;
}

void replaceAll(std::string& text, const std::string& marker, const std::string& value) {
  size_t at = 0;
  while ((at = text.find(marker, at)) != std::string::npos) {
    text.replace(at, marker.size(), value);
    at += value.size();
  }
}

const char* stateName(SetupState state) {
  switch (state) {
    case SetupState::Ready:
      return "ready";
    case SetupState::Joining:
      return "joining";
    case SetupState::Pairing:
      return "pairing";
    case SetupState::Confirm:
      return "confirm";
    case SetupState::Done:
      return "done";
    case SetupState::Error:
      return "error";
  }
  return "ready";
}

}  // namespace

// -- WifiLink ---------------------------------------------------------------------

void WifiLink::prepare() {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
}

void WifiLink::beginJoin(const std::string& ssid, const std::string& password, bool keepAccessPoint) {
  WiFi.mode(keepAccessPoint ? WIFI_AP_STA : WIFI_STA);
  WiFi.begin(ssid.c_str(), password.empty() ? nullptr : password.c_str());
}

bool WifiLink::connected() { return WiFi.status() == WL_CONNECTED; }

int WifiLink::status() { return static_cast<int>(WiFi.status()); }

void WifiLink::abortJoin() { WiFi.disconnect(false, false); }

int WifiLink::rssi() { return WiFi.RSSI(); }

void WifiLink::scan(std::vector<WifiNetwork>& out, size_t maxNetworks) {
  out.clear();
  const int16_t found = WiFi.scanNetworks();
  for (int16_t i = 0; i < found; ++i) {
    WifiNetwork network;
    network.ssid = WiFi.SSID(i).c_str();
    network.rssi = WiFi.RSSI(i);
    network.locked = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    if (!isPlausibleSsid(network.ssid)) {
      continue;  // hidden networks have an empty name
    }
    // The same name from several access points shows once, with the best signal.
    auto same = std::find_if(out.begin(), out.end(), [&](const WifiNetwork& n) { return n.ssid == network.ssid; });
    if (same == out.end()) {
      out.push_back(network);
    } else if (network.rssi > same->rssi) {
      same->rssi = network.rssi;
      same->locked = network.locked;
    }
  }
  WiFi.scanDelete();
  std::sort(out.begin(), out.end(), [](const WifiNetwork& a, const WifiNetwork& b) { return a.rssi > b.rssi; });
  if (out.size() > maxNetworks) {
    out.resize(maxNetworks);
  }
}

void WifiLink::startRadio() {
  prepare();
  WiFi.mode(WIFI_STA);
}

void WifiLink::saveEnergy() { WiFi.setSleep(true); }

void WifiLink::drop() {
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
}

void WifiLink::startClock() { configTime(0, 0, "pool.ntp.org", "time.google.com"); }

// -- WifiSetup --------------------------------------------------------------------

WifiSetup::WifiSetup() : server_(new WebServer(80)), dns_(new DNSServer()) {}

WifiSetup::~WifiSetup() = default;

void WifiSetup::rescan() { WifiLink::scan(networks_, kMaxNetworks); }

bool WifiSetup::start(const std::string& networkName, const std::string& petName, const std::string& passphrase) {
  if (running_) {
    return true;
  }
  if (!isSetupPassphrase(passphrase)) {
    // Never fall back to an open network.
    PET_LOG("setup: no valid passphrase, the access point is not started");
    return false;
  }
  name_ = networkName;
  petName_ = petName;
  have_ = false;
  setStatus(SetupState::Ready);

  WifiLink::prepare();
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(name_.c_str(), passphrase.c_str(), kSetupChannel, 0, kSetupMaxClients)) {
    PET_LOG("setup: the access point would not start");
    return false;
  }
  rescan();

  // Every name resolves to the pet, so a phone's "sign in to this network" check
  // lands on the page. That also makes any page already open in the phone's browser
  // reach the pet under its own name, so the handlers answer only a request made to
  // the pet's address (atMyAddress) and send every other name on to it.
  apHost_ = WiFi.softAPIP().toString().c_str();
  dns_->start(53, "*", WiFi.softAPIP());

  if (!handlersAdded_) {
    server_->on("/", HTTP_GET, [this]() { handleRoot(); });
    server_->on("/status", HTTP_GET, [this]() { handleStatus(); });
    server_->on("/join", HTTP_POST, [this]() { handleJoin(); });
    server_->on("/rescan", HTTP_GET, [this]() { handleRescan(); });
    // The addresses phones probe to find a captive portal get the page too.
    server_->onNotFound([this]() { handleRoot(); });
    server_->collectHeaders(kCollectedHeaders, sizeof(kCollectedHeaders) / sizeof(kCollectedHeaders[0]));
    handlersAdded_ = true;
  }
  server_->begin();
  running_ = true;
  return true;
}

void WifiSetup::stop() {
  if (!running_) {
    return;
  }
  server_->stop();
  dns_->stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  running_ = false;
}

void WifiSetup::service() {
  if (!running_) {
    return;
  }
  dns_->processNextRequest();
  server_->handleClient();
}

bool WifiSetup::takeSubmission(SetupSubmission& out) {
  if (!have_) {
    return false;
  }
  out = submission_;
  have_ = false;
  submission_ = SetupSubmission{};
  return true;
}

void WifiSetup::setStatus(SetupState state, const std::string& message, const std::string& code, SetupFailure failure) {
  state_ = state;
  message_ = message;
  code_ = code;
  if (observer_ != nullptr) {
    observer_(observerContext_, state, failure);
  }
}

std::string WifiSetup::networkOptions() const {
  std::string html;
  for (const WifiNetwork& network : networks_) {
    const std::string name = htmlEscape(network.ssid);
    html += "<option value=\"" + name + "\">" + name + "</option>\n";
  }
  return html;
}

void WifiSetup::replyJson(int code, const std::string& json) {
  server_->sendHeader("Cache-Control", "no-store");
  server_->send(code, "application/json", String(json.c_str()));
}

void WifiSetup::replyMessage(int code, const char* message) {
  JsonDocument doc;
  doc["message"] = message;
  replyJson(code, toJson(doc));
}

// True when the request was made to the pet's own address. Anything else (the name a
// phone's captive portal check used, or a page that was open before the phone joined)
// is sent on to the setup page at the address with a 302, so the page only ever runs
// on the address's origin.
bool WifiSetup::atMyAddress() {
  const std::string host = server_->hostHeader().c_str();
  if (setupHostIsAccessPoint(host, apHost_)) {
    return true;
  }
  server_->sendHeader("Cache-Control", "no-store");
  server_->sendHeader("Location", setupPortalUrl(apHost_).c_str(), true);
  server_->send(302, "text/plain", "");
  return false;
}

void WifiSetup::handleRoot() {
  if (!atMyAddress()) {
    return;
  }
  std::string page = kSetupPage;
  replaceAll(page, "{{NAME}}", htmlEscape(petName_));
  replaceAll(page, "{{NETWORKS}}", networkOptions());
  server_->sendHeader("Cache-Control", "no-store");
  server_->send(200, "text/html; charset=utf-8", String(page.c_str()));
}

// The page's own requests only: made to the pet's address, with the header its script
// adds, and no origin but its own. A page on another site cannot add the header
// without a pre-flight, which the pet never answers (no CORS header is ever sent),
// and a page that the setup DNS rebinds to the pet is refused by its Host, so neither
// can read the confirm code or drive the form. Answers 403 itself when the request is
// not allowed.
bool WifiSetup::fromThePage() {
  const std::string header = server_->header(kSetupHeaderName).c_str();
  const std::string origin = server_->header("Origin").c_str();
  const std::string host = server_->hostHeader().c_str();
  if (setupRequestAllowed(header, origin, host, apHost_)) {
    return true;
  }
  replyMessage(403, "Open my setup page to use me.");
  return false;
}

void WifiSetup::handleStatus() {
  if (!fromThePage()) {
    return;
  }
  JsonDocument doc;
  doc["state"] = stateName(state_);
  doc["message"] = message_.c_str();
  doc["code"] = code_.c_str();
  replyJson(200, toJson(doc));
}

void WifiSetup::handleRescan() {
  if (!atMyAddress()) {
    return;
  }
  // Only between attempts: a scan while the pet is joining would cut the join.
  if (state_ == SetupState::Ready || state_ == SetupState::Error) {
    rescan();
  }
  server_->sendHeader("Location", "/", true);
  server_->send(302, "text/plain", "");
}

void WifiSetup::handleJoin() {
  if (!fromThePage()) {
    return;
  }
  if (state_ != SetupState::Ready && state_ != SetupState::Error) {
    replyMessage(409, "I am busy with the last try. Wait a moment.");
    return;
  }
  SetupSubmission entry;
  entry.ssid = server_->arg("ssid").c_str();
  entry.password = server_->arg("pass").c_str();
  const std::string typedCode = server_->arg("code").c_str();

  if (!isPlausibleSsid(entry.ssid)) {
    replyMessage(400, "Pick a Wi-Fi network, or type its name.");
    return;
  }
  if (!isPlausiblePassword(entry.password)) {
    replyMessage(400, "A Wi-Fi password has 8 to 63 characters. Leave it empty for a network with no password.");
    return;
  }
  if (!normalizeSetupCode(typedCode, entry.code)) {
    replyMessage(400, "The setup code is 10 letters and digits. Copy it from OpenStellarFirm.");
    return;
  }
  submission_ = entry;
  have_ = true;
  setStatus(SetupState::Joining, "Joining your Wi-Fi...");
  replyMessage(200, "ok");
}

}  // namespace pet
