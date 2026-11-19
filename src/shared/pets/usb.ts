import { isSetupCode, normalizeCode } from "./codes";
import { isPetKind, type PetKind } from "./kinds";

/**
 * pet-usb v1: the small line protocol a desk pet speaks over its USB cable
 * while it is being set up. The OpenStellarFirm app opens the pet's data port and
 * sends it the Wi-Fi name, the Wi-Fi password and the setup code the owner made;
 * from there the pet joins the Wi-Fi, asks OpenStellarFirm to pair over HTTPS and
 * speaks its confirm code, exactly as it does for the setup network. This file
 * is the one description of the wire: the app's side, the golden vectors (`usb-vectors.ts`, `usb_vectors.h`) and the
 * firmware (`protocol.h`) all follow it.
 *
 * A line is `@pet1 `, space separated tokens and a newline. At most 512 bytes
 * go before the newline; a longer line is thrown away up to the next newline.
 * Bytes are printable ASCII, one space between tokens, no empty token. The
 * Wi-Fi name and password travel as lowercase hex, so a name that is not UTF-8
 * survives and nothing is escaped or nested.
 *
 *     page to pet:  hello | scan | status | cancel
 *                   join <ssidHex> <passwordHex or -> <setupCode>
 *     pet to page:  hello <version> <kind> <firmware> paired|unpaired open|closed
 *                   net <ssidHex> <rssi> open|locked
 *                   scan-done <count>
 *                   state joining|pairing|confirm|done
 *                   state error <code>
 *                   refused <reason>
 *
 * The pet checks a line in this order: no prefix (ignored, no reply), the rate
 * limit, the shape (`bad_line`), the op (`unknown_op`), the state (`paired`,
 * `busy`), then the values (`bad_value`). A paired pet answers only `hello`
 * and never looks at the values of anything else.
 *
 * Never across the cable, in either direction: the device token, the device
 * secret, the device id, a request id or a URL with an id, the confirm code,
 * an echo of the Wi-Fi password or the setup code, the setup passphrase,
 * audio, notes and transcripts. The state `confirm` only means "listen to your
 * pet". Every reply below is built from fixed words and numbers, and a reply
 * builder takes no password, setup code or confirm code to put in one.
 */

/** Every line starts with this. A line without it is not ours and is dropped. */
export const PET_USB_PREFIX = "@pet1 ";
export const PET_USB_VERSION = 1;
/** Bytes before the newline, the prefix included. */
export const PET_USB_MAX_LINE = 512;
/** Lines the pet takes in a second; the 11th is `refused rate_limited`. */
export const PET_USB_MAX_LINES_PER_SECOND = 10;
/** Never 1200: that baud rate is how a host asks some boards to reboot. */
export const PET_USB_BAUD = 115_200;
/** The Arduino Nano ESP32's own USB identity, for the browser's chooser. */
export const PET_USB_VENDOR_ID = 0x2341;
export const PET_USB_PRODUCT_ID = 0x0070;
/** The most networks one scan reports. */
export const PET_USB_MAX_NETWORKS = 20;
/** A Wi-Fi name is 1 to this many bytes. */
export const PET_USB_SSID_MAX_BYTES = 32;
/** A WPA2 passphrase is this many printable ASCII characters at least... */
export const PET_USB_PASSWORD_MIN_CHARS = 8;
/** ...and at most this many, or exactly 64 hex digits (a raw key). */
export const PET_USB_PASSWORD_MAX_CHARS = 63;
export const PET_USB_PASSWORD_HEX_CHARS = 64;
/** The most characters of the firmware version in `hello`. */
export const PET_USB_FIRMWARE_MAX_CHARS = 20;
/** The password token of an open network (an empty token is not allowed). */
export const PET_USB_OPEN_PASSWORD = "-";

/** What the page asks. No other op exists in v1. */
export const PET_USB_OPS = [
  "hello",
  "scan",
  "join",
  "status",
  "cancel",
] as const;
export type PetUsbOp = (typeof PET_USB_OPS)[number];

/** The first word of every line the pet sends. */
export const PET_USB_REPLY_TYPES = [
  "hello",
  "net",
  "scan-done",
  "state",
  "refused",
] as const;
export type PetUsbReplyType = (typeof PET_USB_REPLY_TYPES)[number];

/** Where a setup try is. `confirm` carries no code: the page waits for the person. */
export const PET_USB_STATES = [
  "joining",
  "pairing",
  "confirm",
  "done",
  "error",
] as const;
export type PetUsbState = (typeof PET_USB_STATES)[number];

/** Why a try ended, said only with `state error`. */
export const PET_USB_ERRORS = [
  "wifi_failed",
  "code_refused",
  "unreachable",
  "timed_out",
  "save_failed",
] as const;
export type PetUsbError = (typeof PET_USB_ERRORS)[number];

/** Why the pet did not do what a line asked. */
export const PET_USB_REFUSALS = [
  "paired",
  "busy",
  "bad_line",
  "unknown_op",
  "rate_limited",
  "bad_value",
] as const;
export type PetUsbRefusal = (typeof PET_USB_REFUSALS)[number];

/** The refusals a line can earn by itself, without a clock or the pet's state. */
export type PetUsbParseRefusal = Exclude<PetUsbRefusal, "rate_limited">;

/** The fixed words of `hello` and `net`. */
export const PET_USB_WORDS = {
  paired: "paired",
  unpaired: "unpaired",
  open: "open",
  closed: "closed",
  locked: "locked",
} as const;

/** Which input a rejected value came from, so a form can flag the right box. */
export type PetUsbField = "ssid" | "password" | "setupCode" | "line";

/**
 * A value or line that pet-usb does not allow. The message names the field,
 * never the value, so it is safe to show and to log.
 */
export class PetUsbFormatError extends Error {
  readonly field: PetUsbField;

  constructor(field: PetUsbField, message: string) {
    super(`Not a pet-usb value: ${message}`);
    this.name = "PetUsbFormatError";
    this.field = field;
  }
}

function isOneOf<const T extends readonly string[]>(
  list: T,
  value: unknown,
): value is T[number] {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

export function isPetUsbOp(value: unknown): value is PetUsbOp {
  return isOneOf(PET_USB_OPS, value);
}

/** The firmware version as protocol.ts and the pet's other calls give it. */
const FIRMWARE_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function isFirmware(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= PET_USB_FIRMWARE_MAX_CHARS &&
    FIRMWARE_SHAPE.test(value)
  );
}

const HEX_DIGITS = "0123456789abcdef";

/** Lowercase hex, two characters a byte. */
export function petUsbToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 15);
  }
  return out;
}

/**
 * Bytes of a lowercase hex token, or null: an uppercase digit, an odd length,
 * an empty token and any other character are all refused, so the page and the
 * pet read exactly the same lines.
 */
export function petUsbFromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] =
      HEX_DIGITS.indexOf(hex.charAt(i * 2)) * 16 +
      HEX_DIGITS.indexOf(hex.charAt(i * 2 + 1));
  }
  return out;
}

/** A Wi-Fi name the radio takes: 1 to 32 bytes and no control character. */
export function isPetUsbSsid(ssid: Uint8Array): boolean {
  if (ssid.length < 1 || ssid.length > PET_USB_SSID_MAX_BYTES) {
    return false;
  }
  for (const byte of ssid) {
    if (byte < 0x20 || byte === 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * A WPA2 passphrase (8 to 63 printable ASCII characters, or 64 hex digits for
 * a raw key), or empty for an open network.
 */
export function isPetUsbPassword(password: string): boolean {
  if (password.length === 0) {
    return true;
  }
  if (password.length === PET_USB_PASSWORD_HEX_CHARS) {
    return /^[0-9a-fA-F]{64}$/.test(password);
  }
  if (
    password.length < PET_USB_PASSWORD_MIN_CHARS ||
    password.length > PET_USB_PASSWORD_MAX_CHARS
  ) {
    return false;
  }
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

/**
 * The setup code as it goes on the wire: letters upper case, the dash and
 * anything else that is not a letter or digit dropped, accepted only when
 * exactly ten characters of the code alphabet are left. Null otherwise.
 */
export function petUsbSetupCode(input: string): string | null {
  return isSetupCode(input) ? normalizeCode(input) : null;
}

// -- Page to pet -------------------------------------------------------------------

/** A request as the pet reads it. */
export type PetUsbRequest =
  | { readonly op: "hello" | "scan" | "status" | "cancel" }
  | {
      readonly op: "join";
      /** The raw bytes of the name, not necessarily UTF-8. */
      readonly ssid: Uint8Array;
      /** Empty for an open network. */
      readonly password: string;
      /** Ten characters of the code alphabet, no dash. */
      readonly setupCode: string;
    };

/**
 * What the page hands the encoder. A name typed in a box is a string and goes
 * out as its UTF-8 bytes; a name picked from the pet's own scan is the bytes
 * the pet sent, so a name that is not UTF-8 comes back unchanged.
 */
export type PetUsbRequestInput =
  | { readonly op: "hello" | "scan" | "status" | "cancel" }
  | {
      readonly op: "join";
      readonly ssid: Uint8Array | string;
      readonly password: string;
      readonly setupCode: string;
    };

/** The line for a request, without its newline (`petUsbWire` adds that). */
export function encodePetUsbRequest(request: PetUsbRequestInput): string {
  if (!isPetUsbOp(request.op)) {
    throw new PetUsbFormatError("line", "unknown op");
  }
  if (request.op !== "join") {
    return `${PET_USB_PREFIX}${request.op}`;
  }
  const ssid =
    typeof request.ssid === "string"
      ? new TextEncoder().encode(request.ssid)
      : request.ssid;
  if (!isPetUsbSsid(ssid)) {
    throw new PetUsbFormatError(
      "ssid",
      "the Wi-Fi name must be 1 to 32 bytes with no control character",
    );
  }
  if (!isPetUsbPassword(request.password)) {
    throw new PetUsbFormatError(
      "password",
      "the Wi-Fi password must be 8 to 63 printable ASCII characters, 64 hex digits, or empty",
    );
  }
  const setupCode = petUsbSetupCode(request.setupCode);
  if (setupCode === null) {
    throw new PetUsbFormatError(
      "setupCode",
      "the setup code is not a setup code",
    );
  }
  const password =
    request.password === ""
      ? PET_USB_OPEN_PASSWORD
      : petUsbToHex(Uint8Array.from(request.password, (c) => c.charCodeAt(0)));
  return `${PET_USB_PREFIX}join ${petUsbToHex(ssid)} ${password} ${setupCode}`;
}

/** The pet's rules about when an op is allowed. */
export interface PetUsbPolicyState {
  /** A paired pet answers `hello` and refuses everything else. */
  readonly paired: boolean;
  /** A setup try is running: no new scan or join until it ends. */
  readonly busy: boolean;
}

/** Why the pet would turn an op away in this state, or null. */
export function petUsbRefusal(
  op: PetUsbOp,
  state: PetUsbPolicyState,
): "paired" | "busy" | null {
  if (state.paired) {
    return op === "hello" ? null : "paired";
  }
  if (state.busy && (op === "scan" || op === "join")) {
    return "busy";
  }
  return null;
}

export type PetUsbParse =
  /** Not a pet-usb line: no reply at all. */
  | { readonly outcome: "ignored" }
  | { readonly outcome: "ok"; readonly request: PetUsbRequest }
  | { readonly outcome: "refused"; readonly reason: PetUsbParseRefusal };

const IDLE: PetUsbPolicyState = { paired: false, busy: false };

type Split =
  | { readonly kind: "ignored" }
  | { readonly kind: "bad" }
  | { readonly kind: "tokens"; readonly tokens: readonly string[] };

/**
 * The prefix, the length, the characters and the spaces of a line, the same
 * rules in both directions. A line that does not start with the prefix is
 * ignored whatever else is wrong with it (a log line, a serial monitor).
 */
function split(line: string): Split {
  if (!line.startsWith(PET_USB_PREFIX)) {
    return { kind: "ignored" };
  }
  if (line.length > PET_USB_MAX_LINE || line.length === PET_USB_PREFIX.length) {
    return { kind: "bad" };
  }
  for (let i = PET_USB_PREFIX.length; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return { kind: "bad" };
    }
  }
  const tokens = line.slice(PET_USB_PREFIX.length).split(" ");
  if (tokens.includes("")) {
    return { kind: "bad" };
  }
  return { kind: "tokens", tokens };
}

function refused(reason: PetUsbParseRefusal): PetUsbParse {
  return { outcome: "refused", reason };
}

/**
 * What a pet makes of a line (the page never needs this; the vectors, the
 * simulator and the tests do). `state` is the pet's own; the policy is applied
 * as soon as the op is known, before any value is looked at.
 */
export function parsePetUsbRequest(
  line: string,
  state: PetUsbPolicyState = IDLE,
): PetUsbParse {
  const parts = split(line);
  if (parts.kind === "ignored") {
    return { outcome: "ignored" };
  }
  if (parts.kind === "bad") {
    return refused("bad_line");
  }
  const [op, ssidHex, passwordToken, codeToken] = parts.tokens;
  if (!isPetUsbOp(op)) {
    return refused("unknown_op");
  }
  if (parts.tokens.length !== (op === "join" ? 4 : 1)) {
    return refused("bad_line");
  }
  const turnedAway = petUsbRefusal(op, state);
  if (turnedAway !== null) {
    return refused(turnedAway);
  }
  if (op !== "join") {
    return { outcome: "ok", request: { op } };
  }

  const ssid = petUsbFromHex(ssidHex ?? "");
  if (ssid === null || !isPetUsbSsid(ssid)) {
    return refused("bad_value");
  }
  let password = "";
  if (passwordToken !== PET_USB_OPEN_PASSWORD) {
    const raw = petUsbFromHex(passwordToken ?? "");
    if (raw === null) {
      return refused("bad_value");
    }
    password = String.fromCharCode(...raw);
    if (!isPetUsbPassword(password)) {
      return refused("bad_value");
    }
  }
  const setupCode = petUsbSetupCode(codeToken ?? "");
  if (setupCode === null) {
    return refused("bad_value");
  }
  return { outcome: "ok", request: { op, ssid, password, setupCode } };
}

// -- Pet to page -------------------------------------------------------------------

/**
 * A line the pet sends. There is no field for a password, a setup code, a
 * confirm code, a token or an id, so none can be put in one.
 */
export type PetUsbReply =
  | {
      readonly type: "hello";
      readonly version: number;
      readonly kind: PetKind;
      readonly firmware: string;
      /** Set up already: the pet answers only `hello` from now on. */
      readonly paired: boolean;
      /** The setup network's ten minutes are running. */
      readonly setupOpen: boolean;
    }
  | {
      readonly type: "net";
      /** The raw bytes of the network's name. */
      readonly ssid: Uint8Array;
      /** Signal strength, 0 to -127. */
      readonly rssi: number;
      readonly locked: boolean;
    }
  | { readonly type: "scan-done"; readonly count: number }
  | {
      readonly type: "state";
      readonly state: Exclude<PetUsbState, "error">;
    }
  | {
      readonly type: "state";
      readonly state: "error";
      readonly error: PetUsbError;
    }
  | { readonly type: "refused"; readonly reason: PetUsbRefusal };

function isCount(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

function isRssi(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -127 &&
    value <= 0
  );
}

/**
 * The line for a reply, without its newline. Every word is checked against
 * the fixed lists, so even a caller that casts its way around the types
 * cannot put a password, a code or an id in a slot meant for a fixed word.
 */
export function encodePetUsbReply(reply: PetUsbReply): string {
  const bad = (what: string): never => {
    throw new PetUsbFormatError("line", `a reply with ${what}`);
  };
  switch (reply.type) {
    case "hello": {
      if (
        !Number.isInteger(reply.version) ||
        reply.version < 1 ||
        reply.version > 999
      ) {
        return bad("a version out of range");
      }
      if (!isPetKind(reply.kind)) {
        return bad("a figure that is not one of the three");
      }
      if (!isFirmware(reply.firmware)) {
        return bad("a firmware version of the wrong shape");
      }
      const paired = reply.paired
        ? PET_USB_WORDS.paired
        : PET_USB_WORDS.unpaired;
      const setup = reply.setupOpen ? PET_USB_WORDS.open : PET_USB_WORDS.closed;
      return `${PET_USB_PREFIX}hello ${reply.version} ${reply.kind} ${reply.firmware} ${paired} ${setup}`;
    }
    case "net": {
      if (!isPetUsbSsid(reply.ssid)) {
        return bad("a network name the radio would not take");
      }
      if (!isRssi(reply.rssi)) {
        return bad("a signal strength out of range");
      }
      const security = reply.locked ? PET_USB_WORDS.locked : PET_USB_WORDS.open;
      return `${PET_USB_PREFIX}net ${petUsbToHex(reply.ssid)} ${reply.rssi} ${security}`;
    }
    case "scan-done": {
      if (!isCount(reply.count, PET_USB_MAX_NETWORKS)) {
        return bad("a network count out of range");
      }
      return `${PET_USB_PREFIX}scan-done ${reply.count}`;
    }
    case "state": {
      if (!isOneOf(PET_USB_STATES, reply.state)) {
        return bad("a state that is not in the list");
      }
      if (reply.state === "error") {
        if (!isOneOf(PET_USB_ERRORS, reply.error)) {
          return bad("an error code that is not in the list");
        }
        return `${PET_USB_PREFIX}state error ${reply.error}`;
      }
      if ("error" in reply) {
        return bad("an error code on a state that is not an error");
      }
      return `${PET_USB_PREFIX}state ${reply.state}`;
    }
    case "refused": {
      if (!isOneOf(PET_USB_REFUSALS, reply.reason)) {
        return bad("a refusal that is not in the list");
      }
      return `${PET_USB_PREFIX}refused ${reply.reason}`;
    }
    default:
      return bad("a type that is not in the list");
  }
}

/** A whole number as the pet writes it: no sign, no leading zero. */
function decimal(text: string | undefined, max: number): number | null {
  if (text === undefined || !/^(?:0|[1-9][0-9]{0,2})$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return value <= max ? value : null;
}

/**
 * What the page makes of a line from the pet. Null for anything it should
 * drop: a line without the prefix (the firmware's own log lines share the
 * port), and a line with it that is malformed, from another version or not in
 * the lists.
 */
export function decodePetUsbReply(line: string): PetUsbReply | null {
  const parts = split(line);
  if (parts.kind !== "tokens") {
    return null;
  }
  const { tokens } = parts;
  const type = tokens[0];
  switch (type) {
    case "hello": {
      const [, versionToken, kind, firmware, pairedWord, setupWord] = tokens;
      const version = decimal(versionToken, 999);
      if (
        tokens.length !== 6 ||
        version === null ||
        version < 1 ||
        !isPetKind(kind) ||
        !isFirmware(firmware) ||
        (pairedWord !== PET_USB_WORDS.paired &&
          pairedWord !== PET_USB_WORDS.unpaired) ||
        (setupWord !== PET_USB_WORDS.open && setupWord !== PET_USB_WORDS.closed)
      ) {
        return null;
      }
      return {
        type,
        version,
        kind,
        firmware,
        paired: pairedWord === PET_USB_WORDS.paired,
        setupOpen: setupWord === PET_USB_WORDS.open,
      };
    }
    case "net": {
      const [, ssidHex, rssiToken, securityWord] = tokens;
      const ssid = petUsbFromHex(ssidHex ?? "");
      const rssi =
        rssiToken !== undefined && /^-[1-9][0-9]{0,2}$/.test(rssiToken)
          ? Number(rssiToken)
          : rssiToken === "0"
            ? 0
            : null;
      if (
        tokens.length !== 4 ||
        ssid === null ||
        !isPetUsbSsid(ssid) ||
        rssi === null ||
        !isRssi(rssi) ||
        (securityWord !== PET_USB_WORDS.open &&
          securityWord !== PET_USB_WORDS.locked)
      ) {
        return null;
      }
      return {
        type,
        ssid,
        rssi,
        locked: securityWord === PET_USB_WORDS.locked,
      };
    }
    case "scan-done": {
      const count = decimal(tokens[1], PET_USB_MAX_NETWORKS);
      if (tokens.length !== 2 || count === null) {
        return null;
      }
      return { type, count };
    }
    case "state": {
      const state = tokens[1];
      if (!isOneOf(PET_USB_STATES, state)) {
        return null;
      }
      if (state === "error") {
        const error = tokens[2];
        if (tokens.length !== 3 || !isOneOf(PET_USB_ERRORS, error)) {
          return null;
        }
        return { type, state, error };
      }
      return tokens.length === 2 ? { type, state } : null;
    }
    case "refused": {
      const reason = tokens[1];
      if (tokens.length !== 2 || !isOneOf(PET_USB_REFUSALS, reason)) {
        return null;
      }
      return { type, reason };
    }
    default:
      return null;
  }
}

// -- The wire ----------------------------------------------------------------------

/**
 * The bytes to write for a line: the line and a newline. Refuses a line that
 * is too long or holds anything but printable ASCII, so a page cannot send
 * what the pet would discard.
 */
export function petUsbWire(line: string): Uint8Array {
  if (!line.startsWith(PET_USB_PREFIX) || line.length > PET_USB_MAX_LINE) {
    throw new PetUsbFormatError(
      "line",
      "a line without the prefix or too long",
    );
  }
  const out = new Uint8Array(line.length + 1);
  for (let i = 0; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      throw new PetUsbFormatError(
        "line",
        "a line with a byte that is not printable ASCII",
      );
    }
    out[i] = code;
  }
  out[line.length] = 0x0a;
  return out;
}

/** What the splitter found: a whole line, or one it had to throw away. */
export type PetUsbSplit =
  | {
      readonly kind: "line";
      /** The bytes as characters 0 to 255, a trailing carriage return dropped. */
      readonly line: string;
    }
  | {
      readonly kind: "overflow";
      /** True when the discarded line began with the prefix (answer `bad_line`). */
      readonly prefixed: boolean;
    };

export interface PetUsbLineSplitter {
  /** Feeds a chunk; returns every line it completed, in order. */
  push(chunk: Uint8Array | string): PetUsbSplit[];
  /** Forgets a half-read line, for a new connection. */
  reset(): void;
}

/**
 * Puts lines back together from chunks of any size. A line holds at most
 * `PET_USB_MAX_LINE` bytes before its newline; one byte more and the rest of
 * that line is discarded up to the newline, so the splitter never holds more
 * than one line's worth. A string chunk is taken as its UTF-8 bytes.
 */
export function createPetUsbLineSplitter(): PetUsbLineSplitter {
  const buffer = new Uint8Array(PET_USB_MAX_LINE);
  let length = 0;
  let discarding = false;
  let prefixed = false;

  const startsWithPrefix = (): boolean => {
    for (let i = 0; i < PET_USB_PREFIX.length; i += 1) {
      if (buffer[i] !== PET_USB_PREFIX.charCodeAt(i)) {
        return false;
      }
    }
    return true;
  };

  return {
    push(chunk) {
      const bytes =
        typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      const found: PetUsbSplit[] = [];
      for (const byte of bytes) {
        if (byte === 0x0a) {
          if (discarding) {
            found.push({ kind: "overflow", prefixed });
          } else {
            const end =
              length > 0 && buffer[length - 1] === 0x0d ? length - 1 : length;
            found.push({
              kind: "line",
              line: String.fromCharCode(...buffer.subarray(0, end)),
            });
          }
          length = 0;
          discarding = false;
          prefixed = false;
        } else if (discarding) {
          // Thrown away up to the newline.
        } else if (length < PET_USB_MAX_LINE) {
          buffer[length] = byte;
          length += 1;
        } else {
          discarding = true;
          prefixed = startsWithPrefix();
        }
      }
      return found;
    },
    reset() {
      length = 0;
      discarding = false;
      prefixed = false;
    },
  };
}
