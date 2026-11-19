import { CODE_ALPHABET } from "./codes";
import {
  PET_KINDS,
  PET_VOICE_IDS,
  type PetKind,
  type PetVoiceId,
} from "./kinds";
import { PET_LIMITS } from "./limits";
import { isPetLineId, type PetLineId } from "./lines";

/** The version of this protocol. The firmware header carries it too. */
export const PET_PROTOCOL_VERSION = 1;

/** What a pet sends as `hardware` when it pairs. */
export const PET_HARDWARE_ID = "nano-esp32-v1";

/** Audio up: a RIFF/WAVE file, PCM16 or IMA-ADPCM, 16 kHz mono. */
export const PET_AUDIO_UP_CONTENT_TYPE = "audio/wav";

/**
 * Audio down: raw PCM16 mono at 22.05 kHz, little-endian. The registered
 * `audio/L16` type means big-endian samples; the pet and the server agree to
 * use this label for little-endian ones, since that is what the pet's I2S
 * amplifier reads without swapping.
 */
export const PET_AUDIO_DOWN_CONTENT_TYPE = "audio/L16;rate=22050";

/** HTTP header names (case-insensitive on the wire). */
export const PET_HEADERS = {
  /** A uuid that makes a turn happen once. */
  turn: "X-Pet-Turn",
  /** When the note was recorded, ISO 8601; optional. */
  recordedAt: "X-Pet-Recorded-At",
  /** `1` only on a saved note sent after the pet was offline. */
  offline: "X-Pet-Offline",
  /** One of `PET_STATES`, on a turn's answer. */
  state: "X-Pet-State",
  /** The pet's chat. */
  chat: "X-Pet-Chat",
  /** The run the turn started. */
  run: "X-Pet-Run",
  /** The spoken text, `encodeURIComponent` encoded. */
  line: "X-Pet-Line",
} as const;

/** How the team stands when a turn's answer is spoken. */
export const PET_STATES = [
  "answered",
  "working",
  "needs-approve",
  "refused",
] as const;

export type PetState = (typeof PET_STATES)[number];

export const NOTICE_KINDS = [
  "done",
  "approval",
  "stopped",
  "budget",
  "message",
  "settings",
] as const;

/** What happens to a note the pet saved while offline. */
export const SAVED_NOTES_POLICIES = ["send", "draft"] as const;

export type SavedNotesPolicy = (typeof SAVED_NOTES_POLICIES)[number];

// -- Errors ------------------------------------------------------------------

/**
 * Every error a pet route answers, keyed by a name that is unique per
 * status. `error` is what goes on the wire; `gone` is on the wire for both
 * `gone` (410, pairing) and `notice_gone` (404, say), so the keys differ
 * where the wire does not. `line` is the voice pack clip the pet plays.
 */
export const PET_ERRORS = {
  bad_request: { error: "bad_request", status: 400, line: "busy" },
  bad_code: { error: "bad_code", status: 400, line: "setup-refused" },
  forgotten: { error: "forgotten", status: 401, line: "disconnected" },
  no_access: { error: "no_access", status: 401, line: "no-access" },
  out_of_credits: {
    error: "out_of_credits",
    status: 402,
    line: "out-of-credits",
  },
  spending_limit: {
    error: "spending_limit",
    status: 402,
    line: "spending-limit",
  },
  off: { error: "off", status: 404, line: "disconnected" },
  notice_gone: { error: "gone", status: 404, line: "busy" },
  paused: { error: "paused", status: 409, line: "paused" },
  gone: { error: "gone", status: 410, line: "setup-refused" },
  too_long: { error: "too_long", status: 413, line: "didnt-catch" },
  bad_audio: { error: "bad_audio", status: 415, line: "didnt-catch" },
  heard_nothing: { error: "heard_nothing", status: 422, line: "didnt-catch" },
  too_many: { error: "too_many", status: 429, line: "busy" },
  voice_off: { error: "voice_off", status: 503, line: "busy" },
  store_off: { error: "store_off", status: 503, line: "busy" },
} as const satisfies Record<
  string,
  { error: string; status: number; line: PetLineId }
>;

/** A key of `PET_ERRORS`: what a server module names an error by. */
export type PetErrorCode = keyof typeof PET_ERRORS;

/** What the `error` field of a body says on the wire. */
export type PetErrorName = (typeof PET_ERRORS)[PetErrorCode]["error"];

const PET_ERROR_NAMES = [
  ...new Set(Object.values(PET_ERRORS).map((entry) => entry.error)),
] as [PetErrorName, ...PetErrorName[]];

/** The status and the JSON body of an error answer. */
export function petError(code: PetErrorCode): {
  status: number;
  body: { error: PetErrorName; line: PetLineId };
} {
  const { error, status, line } = PET_ERRORS[code];
  return { status, body: { error, line } };
}

// -- Time --------------------------------------------------------------------

const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** True for a 24-hour `HH:MM` time such as `22:00`. */
export function isHhMm(value: unknown): boolean {
  return typeof value === "string" && HH_MM.test(value);
}

/** True when the runtime knows the IANA time zone. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/**
 * True when the local time in the quiet hours' zone falls in `[from, to)`,
 * wrapping midnight (22:00 to 08:00). A window whose ends are the same is
 * empty, and an unknown zone counts as not quiet. The server works this out
 * so the pet needs no time zone database.
 */
export function isQuietNow(
  quietHours: QuietHours | null | undefined,
  now: Date,
): boolean {
  if (!quietHours || Number.isNaN(now.getTime())) {
    return false;
  }
  if (!isHhMm(quietHours.from) || !isHhMm(quietHours.to)) {
    return false;
  }
  let hour: number;
  let minute: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: quietHours.tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    hour = Number(parts.find((part) => part.type === "hour")?.value);
    minute = Number(parts.find((part) => part.type === "minute")?.value);
  } catch {
    return false;
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false;
  }
  const local = (hour % 24) * 60 + minute;
  const from = minutesOf(quietHours.from);
  const to = minutesOf(quietHours.to);
  if (from === to) {
    return false;
  }
  return from < to ? local >= from && local < to : local >= from || local < to;
}

// -- Reading a body ----------------------------------------------------------

/**
 * What every parser below answers: the value with only the fields the
 * protocol knows (an unknown field is left out, as it always was), or a plain
 * sentence that says which field is wrong. A body is never taken as it came.
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** A field that is not what the protocol says. Only these parsers throw it. */
class Invalid extends Error {}

function bad(path: string, reason: string): never {
  throw new Invalid(`${path}: ${reason}`);
}

/** Runs one parser's reads; an `Invalid` becomes the failed result. */
function run<T>(read: () => T): ParseResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof Invalid) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

type Fields = Readonly<Record<string, unknown>>;

function objectOf(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return bad(path, "expected an object.");
  }
  return value as Fields;
}

function stringOf(
  value: unknown,
  path: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") {
    return bad(path, "expected text.");
  }
  if (value.length < min || value.length > max) {
    return bad(path, `expected ${min} to ${max} characters.`);
  }
  return value;
}

function patternOf(
  value: unknown,
  path: string,
  pattern: RegExp,
  max: number,
): string {
  const text = stringOf(value, path, 1, max);
  return pattern.test(text) ? text : bad(path, "not in the expected form.");
}

function boolOf(value: unknown, path: string): boolean {
  return typeof value === "boolean"
    ? value
    : bad(path, "expected true or false.");
}

function numberOf(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return bad(path, "expected a number.");
  }
  if (integer && !Number.isInteger(value)) {
    return bad(path, "expected a whole number.");
  }
  return value >= min && value <= max
    ? value
    : bad(path, `expected ${min} to ${max}.`);
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : bad(path, "not one of the known values.");
}

/** A field that may be missing; a present one is read by `read`. */
function optionalOf<T>(
  value: unknown,
  read: (value: unknown) => T,
): T | undefined {
  return value === undefined ? undefined : read(value);
}

// -- Building blocks ---------------------------------------------------------

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)$/;

/** An ISO 8601 date and time; the server writes `Z`, an offset is read too. */
function isoOf(value: unknown, path: string): string {
  const text = stringOf(value, path, 1, 64);
  const match = ISO.exec(text);
  if (match) {
    const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
      number,
      number,
      number,
    ];
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    ) {
      return text;
    }
  }
  return bad(path, "expected an ISO 8601 date and time.");
}

/** Base64url without padding, as the length it has for that many bytes. */
function base64urlOf(value: unknown, path: string, bytes: 16 | 32): string {
  const pattern = bytes === 16 ? /^[A-Za-z0-9_-]{22}$/ : /^[A-Za-z0-9_-]{43}$/;
  return typeof value === "string" && pattern.test(value)
    ? value
    : bad(path, `expected ${bytes} bytes as base64url.`);
}

const confirmShape = new RegExp(
  `^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`,
);

const FIRMWARE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function firmwareOf(value: unknown, path: string): string {
  return patternOf(value, path, FIRMWARE, 20);
}

const NAME = /^\p{L}[\p{L}\p{M} '\u2019-]*$/u;

/**
 * A pet's name: letters, spaces, apostrophes and hyphens, starting with a
 * letter, trimmed. No digits, since a name is spoken in the pairing hello and
 * no spoken line carries a digit.
 */
function nameOf(value: unknown, path: string): string {
  if (typeof value !== "string") {
    return bad(path, "expected text.");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > PET_LIMITS.nameMaxChars) {
    return bad(path, `expected 1 to ${PET_LIMITS.nameMaxChars} characters.`);
  }
  return NAME.test(name)
    ? name
    : bad(path, "only letters, spaces, apostrophes and hyphens.");
}

export function parsePetName(value: unknown): ParseResult<string> {
  return run(() => nameOf(value, "name"));
}

function kindOf(value: unknown, path: string): PetKind {
  return oneOf(value, path, PET_KINDS);
}

function voiceOf(value: unknown, path: string): PetVoiceId {
  return oneOf(value, path, PET_VOICE_IDS);
}

// -- Settings ----------------------------------------------------------------

export interface QuietHours {
  readonly from: string;
  readonly to: string;
  readonly tz: string;
}

function quietHoursOf(value: unknown, path: string): QuietHours {
  const o = objectOf(value, path);
  const from = stringOf(o.from, `${path}.from`, 0, 5);
  const to = stringOf(o.to, `${path}.to`, 0, 5);
  if (!isHhMm(from)) {
    return bad(`${path}.from`, "use HH:MM.");
  }
  if (!isHhMm(to)) {
    return bad(`${path}.to`, "use HH:MM.");
  }
  const tz = stringOf(o.tz, `${path}.tz`, 1, 64);
  if (!isValidTimeZone(tz)) {
    return bad(`${path}.tz`, "unknown time zone.");
  }
  return { from, to, tz };
}

export interface PetSettings {
  readonly paused: boolean;
  readonly quietHours: QuietHours | null;
  readonly speakNotices: boolean;
  readonly volume: number;
  readonly voice: PetVoiceId;
  readonly savedNotes: SavedNotesPolicy;
}

function settingsOf(value: unknown, path: string): PetSettings {
  const o = objectOf(value, path);
  return {
    paused: boolOf(o.paused, `${path}.paused`),
    quietHours:
      o.quietHours === null
        ? null
        : quietHoursOf(o.quietHours, `${path}.quietHours`),
    speakNotices: boolOf(o.speakNotices, `${path}.speakNotices`),
    volume: numberOf(o.volume, `${path}.volume`, 0, 1),
    voice: voiceOf(o.voice, `${path}.voice`),
    savedNotes: oneOf(o.savedNotes, `${path}.savedNotes`, SAVED_NOTES_POLICIES),
  };
}

export function parsePetSettings(value: unknown): ParseResult<PetSettings> {
  return run(() => settingsOf(value, "settings"));
}

// -- Pairing -----------------------------------------------------------------

export interface PairRequest {
  readonly setupCode: string;
  readonly kind: PetKind;
  readonly hardware: string;
  readonly firmware: string;
  /** Base64url of the SHA-256 of the pet's 256-bit secret. */
  readonly deviceKey: string;
}

/**
 * `setupCode` is only bounded here. Whether it has the right shape is the
 * server's to say with `isSetupCode`, so a mistyped code answers `bad_code`
 * ("OpenStellarFirm didn't accept that") and not a generic `bad_request`.
 */
export function parsePairRequest(value: unknown): ParseResult<PairRequest> {
  return run(() => {
    const o = objectOf(value, "pair");
    return {
      setupCode: stringOf(o.setupCode, "setupCode", 1, 32),
      kind: kindOf(o.kind, "kind"),
      hardware: stringOf(o.hardware, "hardware", 1, 40),
      firmware: firmwareOf(o.firmware, "firmware"),
      deviceKey: base64urlOf(o.deviceKey, "deviceKey", 32),
    };
  });
}

export interface PairResponse {
  readonly requestId: string;
  readonly confirmCode: string;
  readonly approveUrl: string;
  readonly expiresAt: string;
}

function httpUrlOf(value: unknown, path: string, max: number): string {
  const text = stringOf(value, path, 1, max);
  try {
    const { protocol } = new URL(text);
    if (protocol === "https:" || protocol === "http:") {
      return text;
    }
  } catch {
    // Falls through to the refusal below.
  }
  return bad(path, "expected an http or https address.");
}

export function parsePairResponse(value: unknown): ParseResult<PairResponse> {
  return run(() => {
    const o = objectOf(value, "pairResponse");
    return {
      requestId: base64urlOf(o.requestId, "requestId", 16),
      confirmCode: patternOf(o.confirmCode, "confirmCode", confirmShape, 9),
      approveUrl: httpUrlOf(o.approveUrl, "approveUrl", 512),
      expiresAt: isoOf(o.expiresAt, "expiresAt"),
    };
  });
}

export interface ClaimRequest {
  readonly requestId: string;
  /** The 256-bit secret itself, base64url. Its SHA-256 is the `deviceKey`. */
  readonly deviceSecret: string;
}

export function parseClaimRequest(value: unknown): ParseResult<ClaimRequest> {
  return run(() => {
    const o = objectOf(value, "claim");
    return {
      requestId: base64urlOf(o.requestId, "requestId", 16),
      deviceSecret: base64urlOf(o.deviceSecret, "deviceSecret", 32),
    };
  });
}

export interface ClaimWaiting {
  readonly status: "waiting";
}

export function parseClaimWaiting(value: unknown): ParseResult<ClaimWaiting> {
  return run(() => {
    const o = objectOf(value, "claimWaiting");
    return { status: oneOf(o.status, "status", ["waiting"] as const) };
  });
}

export interface ClaimResponse {
  readonly deviceId: string;
  /** The device token, 256 bits as base64url. Shown to the pet once. */
  readonly token: string;
  readonly pet: {
    readonly kind: PetKind;
    readonly name: string;
    readonly voice: PetVoiceId;
  };
  readonly settings: PetSettings;
}

export function parseClaimResponse(value: unknown): ParseResult<ClaimResponse> {
  return run(() => {
    const o = objectOf(value, "claimResponse");
    const pet = objectOf(o.pet, "pet");
    return {
      deviceId: stringOf(o.deviceId, "deviceId", 1, 64),
      token: base64urlOf(o.token, "token", 32),
      pet: {
        kind: kindOf(pet.kind, "pet.kind"),
        name: nameOf(pet.name, "pet.name"),
        voice: voiceOf(pet.voice, "pet.voice"),
      },
      settings: settingsOf(o.settings, "settings"),
    };
  });
}

// -- Heartbeat and inbox -----------------------------------------------------

export interface HeartbeatRequest {
  readonly battery: number;
  readonly charging: boolean;
  readonly rssi: number;
  readonly firmware: string;
  readonly queue: number;
  readonly skin: PetKind | "none";
  readonly uptime: number;
}

export function parseHeartbeatRequest(
  value: unknown,
): ParseResult<HeartbeatRequest> {
  return run(() => {
    const o = objectOf(value, "heartbeat");
    return {
      battery: numberOf(o.battery, "battery", 0, 1),
      charging: boolOf(o.charging, "charging"),
      rssi: numberOf(o.rssi, "rssi", -127, 0, true),
      firmware: firmwareOf(o.firmware, "firmware"),
      queue: numberOf(o.queue, "queue", 0, PET_LIMITS.savedNotesMax, true),
      skin: oneOf(o.skin, "skin", [...PET_KINDS, "none"] as const),
      uptime: numberOf(o.uptime, "uptime", 0, 4_294_967_295, true),
    };
  });
}

export interface HeartbeatResponse {
  readonly settings: PetSettings;
  /** Whether quiet hours are on right now, worked out on the server. */
  readonly quiet: boolean;
}

export function parseHeartbeatResponse(
  value: unknown,
): ParseResult<HeartbeatResponse> {
  return run(() => {
    const o = objectOf(value, "heartbeatResponse");
    return {
      settings: settingsOf(o.settings, "settings"),
      quiet: boolOf(o.quiet, "quiet"),
    };
  });
}

export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface Notice {
  readonly seq: number;
  readonly kind: NoticeKind;
  readonly at: string;
  /** What the pet says. Empty for a silent `settings` notice. */
  readonly line: string;
  /** The cleaned work title, on a `done` notice that has one. */
  readonly title?: string;
  /** A canonical persona id. */
  readonly role?: string;
  readonly chat?: string;
  readonly run?: string;
}

const ROLE_ID = /^[a-z][a-z0-9-]{0,39}$/;

function noticeOf(value: unknown, path: string): Notice {
  const o = objectOf(value, path);
  const title = optionalOf(o.title, (v) =>
    stringOf(v, `${path}.title`, 1, 120),
  );
  const role = optionalOf(o.role, (v) =>
    patternOf(v, `${path}.role`, ROLE_ID, 40),
  );
  const chat = optionalOf(o.chat, (v) => stringOf(v, `${path}.chat`, 1, 64));
  const noticeRun = optionalOf(o.run, (v) => stringOf(v, `${path}.run`, 1, 64));
  return {
    seq: numberOf(o.seq, `${path}.seq`, 1, Number.MAX_SAFE_INTEGER, true),
    kind: oneOf(o.kind, `${path}.kind`, NOTICE_KINDS),
    at: isoOf(o.at, `${path}.at`),
    line: stringOf(o.line, `${path}.line`, 0, 400),
    ...(title === undefined ? {} : { title }),
    ...(role === undefined ? {} : { role }),
    ...(chat === undefined ? {} : { chat }),
    ...(noticeRun === undefined ? {} : { run: noticeRun }),
  };
}

export function parseNotice(value: unknown): ParseResult<Notice> {
  return run(() => noticeOf(value, "notice"));
}

export interface InboxResponse {
  readonly notices: readonly Notice[];
  /** The highest `seq` returned, else the `after` that was asked for. */
  readonly next: number;
  readonly quiet: boolean;
}

export function parseInboxResponse(value: unknown): ParseResult<InboxResponse> {
  return run(() => {
    const o = objectOf(value, "inbox");
    if (!Array.isArray(o.notices)) {
      return bad("notices", "expected a list.");
    }
    if (o.notices.length > PET_LIMITS.inboxMaxNotices) {
      return bad("notices", `at most ${PET_LIMITS.inboxMaxNotices}.`);
    }
    return {
      notices: o.notices.map((item, i) => noticeOf(item, `notices[${i}]`)),
      next: numberOf(o.next, "next", 0, Number.MAX_SAFE_INTEGER, true),
      quiet: boolOf(o.quiet, "quiet"),
    };
  });
}

// -- Turns and errors --------------------------------------------------------

/**
 * The answer to a saved note (`X-Pet-Offline: 1`): JSON, no audio. `sent` and
 * `draft` name the chat the note went to. `empty` means nothing was heard in
 * the note: it is as final as the others (nothing is run or kept, and the turn
 * id is taken), so the pet deletes the note on it, and it names no chat. A live
 * turn with nothing heard still answers 422 `heard_nothing`.
 */
export interface TurnSaved {
  readonly status: "sent" | "draft" | "empty";
  readonly chat?: string;
  readonly run?: string;
}

export function parseTurnSaved(value: unknown): ParseResult<TurnSaved> {
  return run(() => {
    const o = objectOf(value, "turn");
    const status = oneOf(o.status, "status", [
      "sent",
      "draft",
      "empty",
    ] as const);
    const chat = optionalOf(o.chat, (v) => stringOf(v, "chat", 1, 64));
    const turnRun = optionalOf(o.run, (v) => stringOf(v, "run", 1, 64));
    if (status !== "empty" && chat === undefined) {
      return bad("chat", "a sent or drafted note names its chat.");
    }
    return {
      status,
      ...(chat === undefined ? {} : { chat }),
      ...(turnRun === undefined ? {} : { run: turnRun }),
    };
  });
}

/** The `208` answer to a turn id that was already taken. */
export interface TurnAlreadyReceived {
  readonly status: "already-received";
}

export function parseTurnAlreadyReceived(
  value: unknown,
): ParseResult<TurnAlreadyReceived> {
  return run(() => {
    const o = objectOf(value, "turn");
    return {
      status: oneOf(o.status, "status", ["already-received"] as const),
    };
  });
}

export interface PetErrorBody {
  readonly error: PetErrorName;
  readonly line: string;
}

export function parsePetErrorBody(value: unknown): ParseResult<PetErrorBody> {
  return run(() => {
    const o = objectOf(value, "error");
    const line = stringOf(o.line, "line", 1, 64);
    if (!isPetLineId(line)) {
      return bad("line", "not a voice pack line.");
    }
    return { error: oneOf(o.error, "error", PET_ERROR_NAMES), line };
  });
}
