#include "api_rules.h"

#include <cstring>

namespace pet {

namespace {

bool startsWith(const char* text, const char* prefix) { return std::strncmp(text, prefix, std::strlen(prefix)) == 0; }

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

template <typename Enum>
bool fromNames(const char* name, const char* const* names, int count, Enum& out) {
  if (name == nullptr) {
    return false;
  }
  for (int i = 0; i < count; ++i) {
    if (std::strcmp(name, names[i]) == 0) {
      out = static_cast<Enum>(i);
      return true;
    }
  }
  return false;
}

}  // namespace

bool isHttpsBase(const char* base) {
  if (base == nullptr || !startsWith(base, "https://")) {
    return false;
  }
  const char* host = base + 8;
  // No space or control character anywhere.
  for (const char* p = base; *p != '\0'; ++p) {
    const unsigned char c = static_cast<unsigned char>(*p);
    if (c <= 0x20 || c == 0x7f) {
      return false;
    }
  }
  // The authority runs to the first "/", "?" or "#". It needs a host and no "@".
  size_t authority = 0;
  while (host[authority] != '\0' && host[authority] != '/' && host[authority] != '?' && host[authority] != '#') {
    if (host[authority] == '@') {
      return false;
    }
    ++authority;
  }
  if (authority == 0) {
    return false;
  }
  // A port alone (":443") is not a host.
  if (host[0] == ':') {
    return false;
  }
  return true;
}

bool isRedirect(int status) { return status >= 300 && status <= 399; }

bool mayRetry(int status) {
  if (status <= 0) {
    return true;
  }
  if (status >= 500 && status <= 599) {
    return true;
  }
  return status == 408 || status == 429;
}

bool isUnreachable(int status) { return status <= 0 || status == 408 || status >= 500; }

std::string joinUrl(const std::string& base, const std::string& path) {
  size_t end = base.size();
  while (end > 0 && base[end - 1] == '/') {
    --end;
  }
  size_t start = 0;
  while (start < path.size() && path[start] == '/') {
    ++start;
  }
  std::string out = base.substr(0, end);
  if (start < path.size()) {
    out += '/';
    out += path.substr(start);
  }
  return out;
}

std::string percentDecode(const std::string& text) {
  std::string out;
  out.reserve(text.size());
  for (size_t i = 0; i < text.size(); ++i) {
    // A "%" needs two hex digits after it; otherwise it is an ordinary character.
    if (text[i] == '%' && i + 2 < text.size() && hexValue(text[i + 1]) >= 0 && hexValue(text[i + 2]) >= 0) {
      out.push_back(static_cast<char>((hexValue(text[i + 1]) << 4) | hexValue(text[i + 2])));
      i += 2;
    } else {
      out.push_back(text[i]);
    }
  }
  return out;
}

const PetErrorInfo* findError(int status, const char* errorOrNull) {
  if (errorOrNull == nullptr || errorOrNull[0] == '\0') {
    return nullptr;
  }
  const PetErrorInfo* sameName = nullptr;
  for (int i = 0; i < PET_ERROR_COUNT; ++i) {
    if (std::strcmp(PET_ERRORS[i].error, errorOrNull) != 0) {
      continue;
    }
    if (PET_ERRORS[i].status == status) {
      return &PET_ERRORS[i];
    }
    if (sameName == nullptr) {
      sameName = &PET_ERRORS[i];
    }
  }
  return sameName;
}

const char* errorLineId(const char* lineOrNull) {
  if (lineOrNull == nullptr || lineOrNull[0] == '\0') {
    return nullptr;
  }
  for (int i = 0; i < PET_ERROR_COUNT; ++i) {
    if (std::strcmp(PET_ERRORS[i].line, lineOrNull) == 0) {
      return PET_ERRORS[i].line;
    }
  }
  return nullptr;
}

const char* lineForError(int status, const char* errorOrNull) {
  if (status <= 0) {
    return PET_LINE_SAVED;
  }
  if (status >= 200 && status <= 299) {
    return "";
  }
  const PetErrorInfo* known = findError(status, errorOrNull);
  if (known != nullptr) {
    return known->line;
  }
  return PET_LINE_BUSY;
}

const char* lineFromAnswer(int status, const char* errorOrNull, const char* lineOrNull) {
  if (status <= 0 || (status >= 200 && status <= 299)) {
    return lineForError(status, errorOrNull);
  }
  const char* named = errorLineId(lineOrNull);
  return named != nullptr ? named : lineForError(status, errorOrNull);
}

bool isForgotten(int status, const char* errorOrNull) {
  return status == 401 && errorOrNull != nullptr && std::strcmp(errorOrNull, "forgotten") == 0;
}

bool isVoiceKeyRefused(int status, const char* errorOrNull) {
  return status == 401 && errorOrNull != nullptr && std::strcmp(errorOrNull, "no_access") == 0;
}

bool isVoiceQuotaUsedUp(int status, const char* errorOrNull) {
  return status == 402 && errorOrNull != nullptr && std::strcmp(errorOrNull, "out_of_credits") == 0;
}

bool isTurnReceived(int status) { return status == 200 || status == 208; }

TurnVerdict turnVerdictFor(int status, const char* errorOrNull) {
  if (status == 200) {
    return TurnVerdict::Reply;
  }
  if (status == 208) {
    return TurnVerdict::Received;
  }
  if (isForgotten(status, errorOrNull)) {
    return TurnVerdict::Forgotten;
  }
  if (isUnreachable(status)) {
    return TurnVerdict::Unreachable;
  }
  return TurnVerdict::Failed;
}

const char* clipForSilentReply(PetTurnState state) {
  switch (state) {
    case PET_STATE_WORKING:
      return PET_LINE_WORKING;
    case PET_STATE_NEEDS_APPROVE:
      return PET_LINE_NEEDS_APPROVE;
    case PET_STATE_REFUSED:
      return PET_LINE_REFUSED;
    case PET_STATE_ANSWERED:
      break;
  }
  return PET_LINE_MESSAGE;
}

const char* lineForFailedSay(int status, const char* errorOrNull, const char* lineOrNull, const char* fallback) {
  if (isVoiceKeyRefused(status, errorOrNull)) {
    return PET_LINE_NO_ACCESS;
  }
  if (isVoiceQuotaUsedUp(status, errorOrNull)) {
    return PET_LINE_OUT_OF_CREDITS;
  }
  if (status == 429) {
    return lineFromAnswer(status, errorOrNull, lineOrNull);  // "busy", unless the body names another
  }
  if (status == 409) {
    // Only a paused pet is told 409 here, so an answer that names nothing is that.
    const char* named = errorLineId(lineOrNull);
    if (named != nullptr) {
      return named;
    }
    const PetErrorInfo* known = findError(status, errorOrNull);
    return known != nullptr ? known->line : PET_LINE_PAUSED;
  }
  return fallback;
}

SyncOutcome syncOutcomeFor(int status, const char* errorOrNull) {
  if (isTurnReceived(status)) {
    return SyncOutcome::Confirm;
  }
  if (isForgotten(status, errorOrNull)) {
    return SyncOutcome::Forgotten;
  }
  if (status <= 0) {
    return SyncOutcome::StopOffline;
  }
  if (isUnreachable(status)) {
    return SyncOutcome::StopServerError;
  }
  if (status == 400 || status == 413 || status == 415 || status == 422) {
    return SyncOutcome::SkipNote;
  }
  return SyncOutcome::StopRetry;
}

InboxCursor inboxCursorAfter(uint32_t after, uint32_t serverNext) {
  InboxCursor cursor;
  cursor.after = serverNext;
  cursor.store = serverNext != after;
  return cursor;
}

bool turnStateFromWire(const char* name, PetTurnState& out) { return fromNames(name, PET_STATE_IDS, PET_STATE_COUNT, out); }

bool noticeKindFromWire(const char* name, PetNoticeKind& out) {
  return fromNames(name, PET_NOTICE_KIND_IDS, PET_NOTICE_KIND_COUNT, out);
}

bool petKindFromWire(const char* name, PetKind& out) { return fromNames(name, PET_KIND_IDS, PET_KIND_COUNT, out); }

namespace {

// Days from 1970-01-01 to a civil date (Howard Hinnant's algorithm).
int64_t daysFromCivil(int64_t year, int month, int day) {
  year -= month <= 2 ? 1 : 0;
  const int64_t era = (year >= 0 ? year : year - 399) / 400;
  const int64_t yearOfEra = year - era * 400;
  const int64_t dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const int64_t dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

bool digits(const char* at, int count, int& value) {
  value = 0;
  for (int i = 0; i < count; ++i) {
    if (at[i] < '0' || at[i] > '9') {
      return false;
    }
    value = value * 10 + (at[i] - '0');
  }
  return true;
}

}  // namespace

bool parseHttpDate(const char* text, int64_t& epochSeconds) {
  // "Sun, 06 Nov 1994 08:49:37 GMT": exactly 29 characters.
  static const char* const kDays[] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};
  static const char* const kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  if (text == nullptr || std::strlen(text) != 29 || text[3] != ',' || text[4] != ' ' || text[7] != ' ' || text[11] != ' ' ||
      text[16] != ' ' || text[19] != ':' || text[22] != ':' || std::strcmp(text + 25, " GMT") != 0) {
    return false;
  }
  bool dayKnown = false;
  for (const char* name : kDays) {
    dayKnown = dayKnown || std::strncmp(text, name, 3) == 0;
  }
  int month = 0;
  for (int i = 0; i < 12; ++i) {
    if (std::strncmp(text + 8, kMonths[i], 3) == 0) {
      month = i + 1;
    }
  }
  int day = 0;
  int year = 0;
  int hour = 0;
  int minute = 0;
  int second = 0;
  if (!dayKnown || month == 0 || !digits(text + 5, 2, day) || !digits(text + 12, 4, year) || !digits(text + 17, 2, hour) ||
      !digits(text + 20, 2, minute) || !digits(text + 23, 2, second)) {
    return false;
  }
  static const int kMonthDays[] = {31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (year < 2024 || year > 2099 || day < 1 || day > kMonthDays[month - 1] || hour > 23 || minute > 59 || second > 60) {
    return false;
  }
  epochSeconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + (second > 59 ? 59 : second);
  return true;
}

bool shouldSetClock(int64_t deviceSeconds, int64_t serverSeconds) {
  constexpr int64_t kFirst2024 = 1704067200;
  if (deviceSeconds < kFirst2024) {
    return true;
  }
  const int64_t difference = deviceSeconds > serverSeconds ? deviceSeconds - serverSeconds : serverSeconds - deviceSeconds;
  return difference > kClockSlackSeconds;
}

}  // namespace pet
