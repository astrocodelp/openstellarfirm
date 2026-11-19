#pragma once

// What the pet says for a notice from its inbox, from the clips of its voice
// pack. This is the firmware's side of noticeLine / noticeClips in
// src/shared/pets/notice.ts: the same table, built from the generated
// header.
//
//   done, with a work title   fetch it spoken (GET /api/pets/say/<seq>); offline: "done"
//   done, no title, role R    role-R then notice-done      ("Your Coder finished. ...")
//   done, no title, no role   done
//   approval, role R          role-R then notice-approval
//   approval, no role         needs-approve
//   stopped, role R           role-R then notice-stopped
//   stopped, no role          stopped
//   budget                    budget
//   message                   fetch it spoken; offline: "message" (or "hello" for the pairing hello)
//   settings                  silent
//
// A role is a canonical persona id ("developer", "marketing"...); the server
// sends it already canonical, so an alias such as "coder" is not resolved here.
// A missing or blank role gives the generic line. A role the pack has no clip
// for (a persona added after this firmware) is "Your assistant", the pack's
// role-assistant clip, as in the TypeScript package.

#include "generated/protocol.h"

namespace pet {

struct NoticePlan {
  // The clips to play, one after the other. Empty strings when there are none.
  // The ids are static strings that stay valid for the life of the program.
  const char* first = "";
  const char* second = "";
  // True when the pack cannot say it: fetch the line spoken with GET /say/<seq>.
  bool fetch = false;
  // What to play when the fetch fails (offline, an error): "done" or "message".
  const char* fallback = "";
  // True for a notice that is never spoken (settings).
  bool silent = false;
};

// The pack clip that says the role: "role-developer" for a known one,
// "role-assistant" for a role the pack has no clip for, nullptr for a missing or
// blank role. Leading and trailing spaces are ignored.
const char* roleClipId(const char* roleOrNull);

// `hasTitle` is true when the notice carries a work title (only `done` uses it).
NoticePlan planNotice(PetNoticeKind kind, const char* roleOrNull, bool hasTitle);

// The plan for a notice as the inbox delivered it: planNotice, and for the
// greeting the server pushes when the pet is paired ("Hi, I'm Nova. Hold my lime
// light and talk to me.") the stand-in is the pack's own "hello" clip, not
// "message". A message is always fetched spoken; this is what plays when that
// fails or the pet is offline.
NoticePlan planInboxNotice(PetNoticeKind kind, const char* roleOrNull, bool hasTitle, const char* serverLine);

}  // namespace pet
