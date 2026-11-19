#include "pet_app.h"

#include <algorithm>
#include <cstring>

namespace pet {

namespace {

uint32_t elapsed(uint32_t now, uint32_t since) { return static_cast<uint32_t>(now - since); }

// True when `deadline` is still ahead of `now`, across a wrap of the counter.
bool before(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(deadline - now) > 0; }

bool isIdle(State s) { return s == State::Ready || s == State::Offline || s == State::LowBattery; }

bool sameLine(const char* a, const char* b) { return a != nullptr && b != nullptr && std::strcmp(a, b) == 0; }

LightMode modeForNotice(PetNoticeKind kind) {
  switch (kind) {
    case PET_NOTICE_KIND_APPROVAL:
      return LightMode::NeedsApprove;
    case PET_NOTICE_KIND_STOPPED:
    case PET_NOTICE_KIND_BUDGET:
      return LightMode::Stopped;
    case PET_NOTICE_KIND_DONE:
    case PET_NOTICE_KIND_MESSAGE:
    case PET_NOTICE_KIND_SETTINGS:
      return LightMode::Done;
  }
  return LightMode::Done;
}

}  // namespace

const char* stateName(State state) {
  switch (state) {
    case State::Boot:
      return "BOOT";
    case State::SetupWifi:
      return "SETUP_WIFI";
    case State::Pairing:
      return "PAIRING";
    case State::Ready:
      return "READY";
    case State::Listening:
      return "LISTENING";
    case State::Sending:
      return "SENDING";
    case State::Speaking:
      return "SPEAKING";
    case State::Offline:
      return "OFFLINE";
    case State::Syncing:
      return "SYNCING";
    case State::Notice:
      return "NOTICE";
    case State::LowBattery:
      return "LOW_BATTERY";
    case State::Updating:
      return "UPDATING";
    case State::Error:
      return "ERROR";
  }
  return "?";
}

uint8_t PetApp::overlays() const {
  uint8_t bits = 0;
  if (teamWorking_) {
    bits |= kOverlayTeamWorking;
  }
  if (needsApprove_) {
    bits |= kOverlayNeedsApprove;
  }
  if (!micOn_) {
    bits |= kOverlayMicOff;
  }
  if (charging_) {
    bits |= kOverlayCharging;
  }
  if (quiet_) {
    bits |= kOverlayQuiet;
  }
  return bits;
}

// -- State changes -----------------------------------------------------------

// The only place state_ changes. Leaving Listening always owes a stopRecording
// and entering it a startRecording, so no path can forget either.
void PetApp::enter(State next, uint32_t now) {
  if (state_ == State::Listening && next != State::Listening) {
    stopPending_ = true;
  }
  if (next == State::Listening && state_ != State::Listening) {
    startPending_ = true;
  }
  if (next == State::Sending) {
    afterReplyFlash_ = LightMode::Off;
  }
  state_ = next;
  sinceMs_ = now;
}

// The owner tapped or held the light of a pet that is not set up. With the setup
// network shut it opens; either way the pet says "setup-join" and the caller
// spells the network's passphrase after it (main.cpp), so an owner who missed it can
// hear it again.
void PetApp::askSetup(Actions& a) {
  if (!setupOpen_) {
    setupOpen_ = true;
    a.startSetup = true;
  }
  a.playLine = PET_LINE_SETUP_JOIN;
}

// Back to the resting state that fits what is true now, starting saved notes
// or a waiting notice if there are any. A caller that says a line of its own
// passes playPending = false, so a waiting notice never talks over it (the
// notice stays waiting for the next chance or a Tap).
void PetApp::settle(Actions& a, uint32_t now, bool playPending) {
  if (online_ && notesWaiting_ && paired_ && syncAllowed(now)) {
    syncRetryArmed_ = false;
    enter(State::Syncing, now);
    a.startSync = true;
    return;
  }
  enter(lowBattery_ ? State::LowBattery : (online_ ? State::Ready : State::Offline), now);
  // A waiting notice never talks over a line this event is already saying.
  const bool lineFree = a.playLine[0] == '\0' && a.fetchSay == 0;
  if (playPending && lineFree && pending_.has && pending_.autoPlay && (!quiet_ || pending_.asked)) {
    startNotice(a, now);
  }
}

// The only way into Listening, and only from a ButtonDown, the owner's hold of the lime
// light (rule 4). The caller has checked the mic switch.
void PetApp::beginRecording(uint32_t now) {
  stopPlaybackPending_ = true;  // the speaker must not feed the microphone
  recordStartMs_ = now;
  speechStarted_ = false;
  silenceMs_ = 0;
  bufferFull_ = false;
  enter(State::Listening, now);
}

// Ends the recording. `deliver`: what was said is sent (online) or kept as a note
// (offline). Not `deliver`: nothing was said, the audio is thrown away and the pet says
// it did not catch that, without a notice talking over it.
void PetApp::endRecording(Actions& a, bool deliver, uint32_t now) {
  if (deliver && online_) {
    a.sendTurn = true;
    enter(State::Sending, now);
    return;
  }
  if (deliver) {
    a.saveNote = true;
    settle(a, now);
    return;
  }
  settle(a, now, false);
  a.playLine = PET_LINE_DIDNT_CATCH;
}

// The limits of a recording, looked at after every event so a late one cannot keep the
// microphone on past them. The order matters: a recording that heard nothing in its
// first five seconds is dropped whatever else is true; one that did is sent when the
// owner has been silent for five seconds, at the 120 second cap, or when its memory is
// full. (A tap ends it in handle(), the owner's own word.)
void PetApp::checkListening(Actions& a, uint32_t now) {
  if (state_ != State::Listening) {
    return;
  }
  const uint32_t listened = elapsed(now, recordStartMs_);
  if (!speechStarted_ && listened >= kNoSpeechMs) {
    endRecording(a, false, now);
  } else if (listened >= kRecordCapMs || bufferFull_ || (speechStarted_ && silenceMs_ >= kSilenceEndMs)) {
    endRecording(a, true, now);
  }
}

void PetApp::markOffline(uint32_t now) {
  if (online_) {
    online_ = false;
    offlineSinceMs_ = now;
  }
}

void PetApp::onNetworkLost(Actions& a, uint32_t now, bool wifiItself) {
  markOffline(now);
  switch (state_) {
    case State::Pairing:
      // A try was under way, so the setup network is up and goes on.
      enter(State::SetupWifi, now);
      setupOpen_ = true;
      a.startSetup = true;
      a.playLine = wifiItself ? PET_LINE_SETUP_WIFI_FAILED : PET_LINE_BUSY;
      break;
    case State::Sending:
      // The recording is still in memory: keep it as a note.
      a.saveNote = true;
      settle(a, now);
      break;
    case State::Ready:
    case State::LowBattery:
    case State::Syncing:
    case State::Updating:
      settle(a, now);
      break;
    default:
      // Offline already, or busy with something that goes on regardless.
      break;
  }
}

// A sync that OpenStellarFirm refuses (paused, voice quota used up, a limit) uploads a whole
// note before it hears so, so each miss waits twice as long as the last.
void PetApp::armSyncRetry(uint32_t now) {
  syncRetryArmed_ = true;
  syncRetryAtMs_ = now + std::min<uint32_t>(kSyncRetryMs << syncRetries_, kSyncRetryMaxMs);
  if (syncRetries_ < kSyncRetryMaxDoublings) {
    ++syncRetries_;
  }
}

bool PetApp::syncAllowed(uint32_t now) const {
  return !syncRetryArmed_ || !before(now, syncRetryAtMs_);
}

void PetApp::startFlash(LightMode mode, uint32_t now) {
  flashMode_ = mode;
  flashUntilMs_ = now + kFlashMs;
}

bool PetApp::askOpen(uint32_t now) const { return asked_ && before(now, askedUntilMs_); }

// The owner's double tap, "what's happening". What waits is played now; if nothing does,
// the inbox is asked at once (a notice the long poll has not delivered yet, or one the
// network task was backing off from) and the pet gives one short lime blink, with no
// sound. A notice the inbox returns within kAskWindowMs plays like a waiting one.
void PetApp::askWhatIsHappening(Actions& a, uint32_t now) {
  if (pending_.has) {
    startNotice(a, now);
    return;
  }
  if (online_) {
    a.askInbox = true;
    asked_ = true;
    askedUntilMs_ = now + kAskWindowMs;
  }
  checked_ = true;
  checkedUntilMs_ = now + kCheckedBlinkMs;
}

void PetApp::startNotice(Actions& a, uint32_t now) {
  const Pending p = pending_;
  pending_.has = false;
  noticeMode_ = modeForNotice(p.kind);
  enter(State::Notice, now);
  if (p.plan.fetch) {
    a.fetchSay = p.seq;
  } else {
    a.playLine = p.plan.first;
    a.playLineThen = p.plan.second;
  }
}

// A turn answered "needs-approve" has told the owner that a step waits, and one
// answered "answered" that the work is done. The notice that follows for the same
// work (the held step's approval notice, a finished run's done notice) would say
// it a second time, so it only moves the light.
//
// An approval notice names the chat (and the run when the server knows it), so a
// run decides when both sides have one and the chat otherwise. A done notice is
// about a run and nothing else: a finished piece of work is matched by its run
// alone, so another job that ends in the same chat is still announced.
bool PetApp::repeatsTurn(PetNoticeKind kind, uint32_t chatKey, uint32_t runKey, uint32_t now) const {
  if (!lastTurn_.has || elapsed(now, lastTurn_.atMs) >= kRepeatedNoticeMs) {
    return false;
  }
  const bool approval = kind == PET_NOTICE_KIND_APPROVAL && lastTurn_.state == PET_STATE_NEEDS_APPROVE;
  const bool done = kind == PET_NOTICE_KIND_DONE && lastTurn_.state == PET_STATE_ANSWERED;
  if (!approval && !done) {
    return false;
  }
  if (runKey != 0 && lastTurn_.runKey != 0) {
    return runKey == lastTurn_.runKey;
  }
  if (done) {
    return false;
  }
  return chatKey != 0 && chatKey == lastTurn_.chatKey;
}

// Called as a turn's answer begins. A notice that came in while the pet was
// sending (a long poll was already out) and says the same thing is dropped, so
// it does not speak after the answer has.
void PetApp::rememberTurn(const Event& e, uint32_t now) {
  lastTurn_.has = e.chatKey != 0 || e.runKey != 0;
  lastTurn_.state = e.turnState;
  lastTurn_.chatKey = e.chatKey;
  lastTurn_.runKey = e.runKey;
  lastTurn_.atMs = now;
  if (pending_.has && elapsed(now, pending_.atMs) < kRepeatedNoticeMs &&
      repeatsTurn(pending_.kind, pending_.chatKey, pending_.runKey, now)) {
    pending_.has = false;
  }
}

void PetApp::expireAttention(uint32_t now) {
  if (checked_ && !before(now, checkedUntilMs_)) {
    checked_ = false;
  }
  if (asked_ && !before(now, askedUntilMs_)) {
    asked_ = false;
  }
  if (teamWorking_ && !before(now, teamUntilMs_)) {
    teamWorking_ = false;
  }
  if (needsApprove_ && !before(now, approveUntilMs_)) {
    needsApprove_ = false;
  }
}

// -- Events ------------------------------------------------------------------

void PetApp::onTick(Actions& a, uint32_t now) {
  switch (state_) {
    case State::Sending:
      if (elapsed(now, sinceMs_) >= kSendingWatchdogMs) {
        markOffline(now);
        a.saveNote = true;
        settle(a, now);
      }
      break;
    case State::Speaking:
      if (elapsed(now, sinceMs_) >= kSpeakingWatchdogMs) {
        a.stopPlayback = true;
        settle(a, now);
      }
      break;
    case State::Notice:
      if (elapsed(now, sinceMs_) >= kNoticeWatchdogMs) {
        a.stopPlayback = true;
        settle(a, now);
      }
      break;
    case State::Syncing:
      if (elapsed(now, sinceMs_) >= kSyncWatchdogMs) {
        armSyncRetry(now);
        settle(a, now);
      }
      break;
    case State::Updating:
      if (elapsed(now, sinceMs_) >= kUpdatingWatchdogMs) {
        settle(a, now);
      }
      break;
    case State::Error:
      if (elapsed(now, sinceMs_) >= kErrorRestartMs) {
        halt_ = Halt::Restart;
        a.restart = true;
      }
      break;
    case State::Ready:
    case State::LowBattery:
      // A refused sync is tried again after its wait.
      if (syncRetryArmed_ && online_ && notesWaiting_ && syncAllowed(now)) {
        settle(a, now);
      }
      break;
    default:
      break;
  }
}

void PetApp::onNotice(const Event& e, Actions& a, uint32_t now) {
  // Only a paired pet has an inbox; one that is being set up or was forgotten
  // takes nothing from it.
  if (!paired_) {
    return;
  }
  quiet_ = e.quietNow;
  if (e.noticeKind == PET_NOTICE_KIND_SETTINGS) {
    // Silent: the owner changed something in Settings; read it with a heartbeat.
    a.heartbeat = true;
    return;
  }
  LightMode flash = LightMode::Off;
  switch (e.noticeKind) {
    case PET_NOTICE_KIND_APPROVAL:
      // The Approve itself is in the app. This only says that one waits.
      needsApprove_ = true;
      approveUntilMs_ = now + kApproveLightMs;
      break;
    case PET_NOTICE_KIND_DONE:
      teamWorking_ = false;
      flash = LightMode::Done;
      break;
    case PET_NOTICE_KIND_STOPPED:
      teamWorking_ = false;
      flash = LightMode::Stopped;
      break;
    case PET_NOTICE_KIND_BUDGET:
      flash = LightMode::Stopped;
      break;
    case PET_NOTICE_KIND_MESSAGE:
      flash = LightMode::Done;
      break;
    case PET_NOTICE_KIND_SETTINGS:
      break;
  }
  if (repeatsTurn(e.noticeKind, e.chatKey, e.runKey, now)) {
    // The pet said this when it answered: the light follows, nothing is spoken and
    // nothing waits for a Tap.
    if (isIdle(state_) && flash != LightMode::Off) {
      startFlash(flash, now);
    }
    return;
  }
  pending_.has = true;
  pending_.kind = e.noticeKind;
  pending_.seq = e.seq;
  pending_.plan = e.plan;
  pending_.chatKey = e.chatKey;
  pending_.runKey = e.runKey;
  pending_.atMs = now;
  // Quiet hours and "say notices aloud" off both mean: no sound until a Tap or a double
  // tap. A notice that comes back to a double tap is the owner's own request: it plays.
  pending_.asked = askOpen(now);
  pending_.autoPlay = (e.speak && !e.quietNow) || pending_.asked;
  if (isIdle(state_)) {
    if (pending_.autoPlay) {
      startNotice(a, now);
    } else if (flash != LightMode::Off) {
      startFlash(flash, now);
    }
  }
  // In any other state the notice waits; settle() plays it afterwards if it may.
}

Actions PetApp::handle(const Event& e, uint32_t now) {
  Actions a;

  if (halt_ != Halt::None) {
    // Going to sleep or restarting: nothing else happens.
    a.shutdown = halt_ == Halt::Shutdown;
    a.restart = halt_ == Halt::Restart;
    return finish(a, now);
  }

  expireAttention(now);

  switch (e.type) {
    case EventType::ResetHold:
      // Held from power-on for 10 seconds: forget everything and start over.
      enter(State::Boot, now);
      paired_ = false;
      setupOpen_ = false;
      notesWaiting_ = false;
      pending_.has = false;
      lastTurn_.has = false;
      asked_ = false;
      checked_ = false;
      a.forgetAll = true;
      a.restart = true;
      halt_ = Halt::Restart;
      stopPlaybackPending_ = true;
      break;

    case EventType::Tick:
      onTick(a, now);
      break;

    case EventType::BootDone:
      if (state_ != State::Boot) {
        break;
      }
      paired_ = e.paired;
      notesWaiting_ = e.paired && e.notesWaiting;
      if (!e.paired || !e.wifiKnown) {
        // The one time the setup network opens by itself: the pet was just
        // powered on with no pairing, so someone is setting it up.
        enter(State::SetupWifi, now);
        setupOpen_ = true;
        a.startSetup = true;
        a.playLine = PET_LINE_SETUP_JOIN;
      } else {
        if (!online_) {
          offlineSinceMs_ = now;
        }
        settle(a, now);
      }
      break;

    case EventType::WifiUp: {
      const bool wasOnline = online_;
      const bool longOffline = !wasOnline && everOnline_ && elapsed(now, offlineSinceMs_) >= kBackOnlineMinOfflineMs;
      online_ = true;
      if (paired_) {
        everOnline_ = true;
      }
      if (!wasOnline && isIdle(state_)) {
        // Saved notes give their own "Sent your saved notes"; otherwise say it
        // only after a real gap, not for a blink of the router.
        const bool sayBack = longOffline && !quiet_ && !notesWaiting_;
        settle(a, now, !sayBack);
        a.heartbeat = true;
        if (sayBack && state_ != State::Syncing) {
          a.playLine = PET_LINE_BACK_ONLINE;
        }
      }
      break;
    }

    case EventType::WifiDown:
      onNetworkLost(a, now, true);
      break;

    case EventType::ServerUnreachable:
      onNetworkLost(a, now, false);
      break;

    case EventType::ButtonDown:
      switch (state_) {
        case State::Listening:
          // The owner pressed and held the light again while it listens: that is "I am
          // done", sent at once, like a tap.
          endRecording(a, true, now);
          break;
        case State::Ready:
        case State::Offline:
        case State::LowBattery:
        case State::Notice:
        case State::Speaking:
          if (!micOn_) {
            a.playLine = PET_LINE_MIC_OFF;
          } else {
            beginRecording(now);
          }
          break;
        case State::Syncing:
          // Saved notes are on their way over the one connection.
          a.playLine = micOn_ ? PET_LINE_BUSY : PET_LINE_MIC_OFF;
          break;
        case State::SetupWifi:
          // Not paired, so there is nothing to record: the owner's hold opens the
          // setup network, or says again how to join it.
          askSetup(a);
          break;
        default:
          break;
      }
      break;

    case EventType::ButtonUp:
      // Letting go of the light does not stop the pet: it listens until the owner has
      // been silent for five seconds, taps, or the cap comes. (This used to end the
      // recording; see docs/desk-pets-plan.md, rule 4.)
      break;

    case EventType::Voice:
      if (state_ == State::Listening) {
        speechStarted_ = speechStarted_ || e.speechStarted;  // once begun, a pause never un-starts it
        silenceMs_ = e.silenceMs;
        bufferFull_ = bufferFull_ || e.bufferFull;
      }
      break;

    case EventType::Tap:
      if (state_ == State::Listening) {
        // The owner pressed the light again: stop listening and send at once.
        endRecording(a, true, now);
      } else if (isIdle(state_)) {
        if (pending_.has) {
          startNotice(a, now);
        }
      } else if (state_ == State::Notice || state_ == State::Speaking) {
        a.stopPlayback = true;
        settle(a, now);
      } else if (state_ == State::SetupWifi) {
        askSetup(a);
      }
      break;

    case EventType::DoubleTap:
      // "What's happening". The first tap of the pair has already been taken as a Tap (it
      // ended a recording, stopped a reply, or started the waiting notice), so only a
      // pet at rest answers; a busy one takes no second request.
      if (isIdle(state_)) {
        askWhatIsHappening(a, now);
      }
      break;

    case EventType::SetupSubmitted:
      if (state_ == State::SetupWifi) {
        enter(State::Pairing, now);
      }
      break;

    case EventType::PairRequested:
      if (state_ == State::Pairing) {
        if (e.ok) {
          a.playLine = PET_LINE_SETUP_CODE;
        } else {
          enter(State::SetupWifi, now);
          setupOpen_ = true;
          a.startSetup = true;
          a.playLine = PET_LINE_SETUP_REFUSED;
        }
      }
      break;

    case EventType::PairApproved:
      if (state_ == State::Pairing) {
        paired_ = true;
        setupOpen_ = false;  // the network goes off once the page has read "done"
        a.heartbeat = true;
        settle(a, now, false);
        a.playLine = PET_LINE_SETUP_DONE;
      }
      break;

    case EventType::PairRefused:
      if (state_ == State::Pairing) {
        enter(State::SetupWifi, now);
        setupOpen_ = true;
        a.startSetup = true;
        a.playLine = PET_LINE_SETUP_REFUSED;
      }
      break;

    case EventType::SetupTimedOut:
      // Nobody finished within the window and the network was switched off. The
      // pet waits, unpaired; a tap or a hold of the light opens it again.
      if (state_ == State::SetupWifi) {
        setupOpen_ = false;
      }
      break;

    case EventType::Forgotten:
      // The server no longer knows this pet. Start again from setup.
      paired_ = false;
      notesWaiting_ = false;
      syncRetryArmed_ = false;
      syncRetries_ = 0;
      teamWorking_ = false;
      needsApprove_ = false;
      pending_.has = false;
      lastTurn_.has = false;
      flashMode_ = LightMode::Off;
      asked_ = false;
      checked_ = false;
      // The pet is wiped and says so, but the setup network stays shut: a
      // server that answered 401 (the owner pressed Forget, or anyone with a stale
      // token) must not be able to put the pet on the air for whoever is in radio
      // range. The owner taps or holds the light to open it.
      enter(State::SetupWifi, now);
      setupOpen_ = false;
      a.forgetAll = true;
      a.playLine = PET_LINE_DISCONNECTED;
      break;

    case EventType::TurnStarted:
      if (state_ == State::Sending) {
        sinceMs_ = now;  // the wait for the answer starts when the upload does
      }
      break;

    case EventType::ReplyStarted:
      if (state_ == State::Sending) {
        rememberTurn(e, now);
        switch (e.turnState) {
          case PET_STATE_WORKING:
            teamWorking_ = true;
            teamUntilMs_ = now + kTeamWorkingLightMs;
            afterReplyFlash_ = LightMode::Off;
            break;
          case PET_STATE_NEEDS_APPROVE:
            needsApprove_ = true;
            approveUntilMs_ = now + kApproveLightMs;
            afterReplyFlash_ = LightMode::Off;
            break;
          case PET_STATE_REFUSED:
            afterReplyFlash_ = LightMode::Stopped;
            break;
          case PET_STATE_ANSWERED:
            afterReplyFlash_ = LightMode::Off;
            break;
        }
        enter(State::Speaking, now);
      }
      break;

    case EventType::ReplyEnded:
      // Every reply says ReplyStarted first, so this is only about a reply the pet
      // is speaking. A late end of an old reply (the owner talked over it) must not
      // end the turn that is being sent now.
      if (state_ == State::Speaking) {
        const LightMode flash = afterReplyFlash_;
        afterReplyFlash_ = LightMode::Off;
        settle(a, now);
        if (flash != LightMode::Off) {
          startFlash(flash, now);
        }
      }
      break;

    case EventType::TurnFailed:
      if (state_ == State::Sending) {
        if (sameLine(e.line, PET_LINE_SAVED)) {
          // A network error: keep the recording as a note.
          markOffline(now);
          a.saveNote = true;
          settle(a, now);
        } else {
          settle(a, now, false);
          a.playLine = (e.line == nullptr || e.line[0] == '\0') ? PET_LINE_BUSY : e.line;
          startFlash(LightMode::Stopped, now);
        }
      } else if (state_ == State::Syncing) {
        if (sameLine(e.line, PET_LINE_SAVED)) {
          markOffline(now);
        } else {
          armSyncRetry(now);
        }
        settle(a, now);
      }
      break;

    case EventType::NoteSaved:
      if (e.noteResult == AddResult::Saved) {
        notesWaiting_ = true;
        if (isIdle(state_) && online_) {
          settle(a, now, false);  // back online meanwhile: send it
        }
        // "I'm offline, so I saved that" would be wrong if the sync just began.
        if (state_ != State::Syncing) {
          a.playLine = PET_LINE_SAVED;
        }
      } else {
        a.playLine = PET_LINE_MEMORY_FULL;
      }
      a.heartbeat = true;
      break;

    case EventType::NotesSynced:
      notesWaiting_ = false;
      syncRetryArmed_ = false;
      syncRetries_ = 0;
      a.heartbeat = true;
      if (state_ == State::Syncing) {
        // "Sent your saved notes" only when some went out; a pass that found only
        // refused notes says nothing, so a waiting notice may speak instead.
        settle(a, now, e.nothingSent);
        if (!e.nothingSent) {
          a.playLine = PET_LINE_SENT;
        }
      }
      break;

    case EventType::NoticeArrived:
      onNotice(e, a, now);
      break;

    case EventType::NoticeShown:
      if (state_ == State::Notice) {
        settle(a, now);
      }
      break;

    case EventType::QuietChanged:
      quiet_ = e.on;
      break;

    case EventType::BatteryLow:
      if (!charging_) {
        const bool first = !lowBattery_;
        lowBattery_ = true;
        if (first) {
          a.heartbeat = true;
          if (isIdle(state_)) {
            settle(a, now, quiet_);
            if (!quiet_ && state_ == State::LowBattery) {
              a.playLine = PET_LINE_BATTERY_LOW;
            }
          }
        }
      }
      break;

    case EventType::BatteryOk:
      if (lowBattery_) {
        lowBattery_ = false;
        a.heartbeat = true;
        if (state_ == State::LowBattery) {
          settle(a, now);
        }
      }
      break;

    case EventType::BatteryCritical:
      // Under load below the cut-off: lights off, amp off, deep sleep. On
      // USB power the battery is not what runs the pet.
      if (!charging_) {
        enter(State::LowBattery, now);  // leaves Listening if need be
        halt_ = Halt::Shutdown;
        a.shutdown = true;
        stopPlaybackPending_ = true;
      }
      break;

    case EventType::Charging: {
      const bool changed = charging_ != e.on;
      charging_ = e.on;
      if (changed) {
        a.heartbeat = true;
      }
      if (e.on) {
        // Plugged in: the battery is no longer the worry.
        const bool wasLow = lowBattery_;
        lowBattery_ = false;
        if (wasLow && state_ == State::LowBattery) {
          settle(a, now, false);
        }
        if (changed && isIdle(state_) && !quiet_) {
          a.playLine = PET_LINE_CHARGING;
        }
      }
      break;
    }

    case EventType::MicSwitch:
      micOn_ = e.on;
      if (!micOn_ && state_ == State::Listening) {
        // Cut mid-recording: throw the audio away and say why. A waiting notice
        // stays waiting: it must not start here and then be talked over (or end
        // with its suffix after "my microphone is switched off").
        settle(a, now, false);
        a.playLine = PET_LINE_MIC_OFF;
      }
      break;

    case EventType::Fault:
      enter(State::Error, now);
      stopPlaybackPending_ = true;
      break;

    case EventType::UpdateOffered:
      if (state_ == State::Ready) {
        enter(State::Updating, now);
      }
      break;
  }

  // The limits of a recording (the 120 second cap, the wait for the first word, five
  // seconds of silence, a full memory) hold whatever event comes, not only a Tick or a
  // Voice, so a late event cannot keep the microphone on past them. They are applied
  // after the event, so they see whether the connection is up once that event has been
  // taken into account: one event never both sends and saves the same recording.
  checkListening(a, now);

  return finish(a, now);
}

// -- Lights ------------------------------------------------------------------

LightMode PetApp::computeLight(uint32_t now) const {
  if (halt_ == Halt::Shutdown) {
    return LightMode::Off;
  }
  if (halt_ == Halt::Restart) {
    return LightMode::Stopped;
  }
  switch (state_) {
    case State::Listening:
      // Rule 4, before anything else: the microphone is on, so the lime light is.
      return LightMode::Listening;
    case State::Boot:
      return LightMode::Off;
    case State::SetupWifi:
    case State::Pairing:
      return LightMode::Setup;
    case State::Sending:
    case State::Syncing:
    case State::Updating:
      return LightMode::Thinking;
    case State::Speaking:
      return LightMode::Speaking;
    case State::Notice:
      return noticeMode_;
    case State::Error:
      return LightMode::Stopped;
    case State::Ready:
    case State::Offline:
    case State::LowBattery:
      break;
  }
  // Resting. The blink that answers a double tap shows even in quiet hours (the owner
  // touched the pet); otherwise quiet hours keep it dark, then what needs attention,
  // most urgent first.
  if (checked_ && before(now, checkedUntilMs_)) {
    return LightMode::Checked;
  }
  if (quiet_) {
    return LightMode::Quiet;
  }
  if (flashMode_ != LightMode::Off && before(now, flashUntilMs_)) {
    return flashMode_;
  }
  if (needsApprove_) {
    return LightMode::NeedsApprove;
  }
  if (state_ == State::LowBattery) {
    return LightMode::LowBattery;
  }
  if (!micOn_) {
    return LightMode::MicOff;
  }
  if (teamWorking_) {
    return LightMode::TeamWorking;
  }
  if (charging_) {
    return LightMode::ChargingIdle;
  }
  if (!online_) {
    return LightMode::OfflineSaving;
  }
  return LightMode::Ready;
}

Actions PetApp::finish(Actions a, uint32_t now) {
  if (startPending_) {
    a.startRecording = true;
    startPending_ = false;
  }
  if (stopPending_) {
    a.stopRecording = true;
    stopPending_ = false;
  }
  if (stopPlaybackPending_) {
    a.stopPlayback = true;
    stopPlaybackPending_ = false;
  }
  lightMode_ = computeLight(now);
  a.lightMode = lightMode_;
  a.overlays = overlays();
  return a;
}

}  // namespace pet
