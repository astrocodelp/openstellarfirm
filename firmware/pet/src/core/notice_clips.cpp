#include "notice_clips.h"

#include <cstring>

#include "text_rules.h"

namespace pet {

namespace {

// In the order of PET_ROLE_IDS; the test checks that "role-" + the id is the
// clip, so a reordered header cannot go unnoticed.
// Unsized on purpose: a role added to the package (PET_ROLE_IDS in the generated
// header) and not here must fail to build, not leave a null entry (the Agronomist's
// "agriculture" did once).
const char* const kRoleClips[] = {
    PET_LINE_ROLE_DEVELOPER,
    PET_LINE_ROLE_ACCOUNTANT,
    PET_LINE_ROLE_MARKETING,
    PET_LINE_ROLE_LEGAL,
    PET_LINE_ROLE_PRODUCT_OWNER,
    PET_LINE_ROLE_SALES,
    PET_LINE_ROLE_EXECUTIVE_ASSISTANT,
    PET_LINE_ROLE_SUPPORT,
    PET_LINE_ROLE_RECRUITING,
    PET_LINE_ROLE_ESHOP,
    PET_LINE_ROLE_DJ,
    PET_LINE_ROLE_COPYWRITER,
    PET_LINE_ROLE_TEACHER,
    PET_LINE_ROLE_SCIENTIST,
    PET_LINE_ROLE_ARCHITECT,
    PET_LINE_ROLE_MECHANICAL_ENGINEER,
    PET_LINE_ROLE_DESIGNER,
    PET_LINE_ROLE_JOURNALIST,
    PET_LINE_ROLE_AGRICULTURE,
};
static_assert(sizeof(kRoleClips) / sizeof(kRoleClips[0]) == PET_ROLE_COUNT,
              "kRoleClips needs one clip per PET_ROLE_IDS entry, in the same order");

// "Your <role>" then the suffix, or the generic line when there is no role.
NoticePlan withRole(const char* roleOrNull, const char* suffixLine, const char* genericLine) {
  NoticePlan plan;
  const char* role = roleClipId(roleOrNull);
  if (role == nullptr) {
    plan.first = genericLine;
  } else {
    plan.first = role;
    plan.second = suffixLine;
  }
  return plan;
}

}  // namespace

const char* roleClipId(const char* roleOrNull) {
  if (roleOrNull == nullptr) {
    return nullptr;
  }
  const char* begin = roleOrNull;
  while (*begin == ' ' || *begin == '\t' || *begin == '\n' || *begin == '\r') {
    ++begin;
  }
  const char* end = begin + std::strlen(begin);
  while (end > begin && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\n' || end[-1] == '\r')) {
    --end;
  }
  const size_t length = static_cast<size_t>(end - begin);
  if (length == 0) {
    return nullptr;
  }
  for (int i = 0; i < PET_ROLE_COUNT; ++i) {
    if (std::strlen(PET_ROLE_IDS[i]) == length && std::strncmp(begin, PET_ROLE_IDS[i], length) == 0) {
      return kRoleClips[i];
    }
  }
  return PET_LINE_ROLE_ASSISTANT;
}

NoticePlan planNotice(PetNoticeKind kind, const char* roleOrNull, bool hasTitle) {
  NoticePlan plan;
  switch (kind) {
    case PET_NOTICE_KIND_DONE:
      if (hasTitle) {
        plan.fetch = true;
        plan.fallback = PET_LINE_DONE;
        return plan;
      }
      return withRole(roleOrNull, PET_LINE_NOTICE_DONE, PET_LINE_DONE);
    case PET_NOTICE_KIND_APPROVAL:
      return withRole(roleOrNull, PET_LINE_NOTICE_APPROVAL, PET_LINE_NEEDS_APPROVE);
    case PET_NOTICE_KIND_STOPPED:
      return withRole(roleOrNull, PET_LINE_NOTICE_STOPPED, PET_LINE_STOPPED);
    case PET_NOTICE_KIND_BUDGET:
      plan.first = PET_LINE_BUDGET;
      return plan;
    case PET_NOTICE_KIND_MESSAGE:
      plan.fetch = true;
      plan.fallback = PET_LINE_MESSAGE;
      return plan;
    case PET_NOTICE_KIND_SETTINGS:
      plan.silent = true;
      return plan;
  }
  plan.silent = true;
  return plan;
}

NoticePlan planInboxNotice(PetNoticeKind kind, const char* roleOrNull, bool hasTitle, const char* serverLine) {
  NoticePlan plan = planNotice(kind, roleOrNull, hasTitle);
  if (kind == PET_NOTICE_KIND_MESSAGE && isPairingHello(serverLine)) {
    plan.fallback = PET_LINE_HELLO;
  }
  return plan;
}

}  // namespace pet
