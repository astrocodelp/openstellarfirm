import type { PetUsbParseRefusal, PetUsbReply } from "./usb";

/**
 * Golden vectors for pet-usb v1. They are written by hand, not computed by
 * `usb.ts`, so the TypeScript codec and the firmware's are each checked
 * against the same independent answers: `usb.test.ts` runs every row through
 * `parsePetUsbRequest`, `encodePetUsbReply` and `decodePetUsbReply`, and
 * `header.ts` writes the rows into `firmware/pet/include/generated/usb_vectors.h`
 * for the firmware's native tests.
 *
 * A line is a string of characters 0 to 255, one per byte, without its
 * newline.
 */

/** One request line and what a pet makes of it in a given state. */
export interface PetUsbRequestVector {
  readonly name: string;
  /** The pet is already set up. Absent means false. */
  readonly paired?: boolean;
  /** A setup try is running. Absent means false. */
  readonly busy?: boolean;
  readonly line: string;
  readonly expect:
    | { readonly outcome: "ignored" }
    | {
        readonly outcome: "ok";
        readonly op: "hello" | "scan" | "status" | "cancel";
      }
    | {
        readonly outcome: "ok";
        readonly op: "join";
        readonly ssid: readonly number[];
        readonly password: string;
        readonly setupCode: string;
      }
    | { readonly outcome: "refused"; readonly reason: PetUsbParseRefusal };
}

/** One reply line and the fixed inputs it is built from. */
export interface PetUsbReplyVector {
  readonly name: string;
  readonly reply: PetUsbReply;
  readonly line: string;
}

const P = "@pet1 ";

function bytesOf(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function hexOf(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A join line from the raw bytes of a name and password. */
function join(
  ssid: readonly number[],
  password: readonly number[] | "-",
  code: string,
): string {
  return `${P}join ${hexOf(ssid)} ${password === "-" ? "-" : hexOf(password)} ${code}`;
}

const HOME = bytesOf("Home Wi-Fi");
const CODE = "K7QXM2PA9T";
const RAW_KEY = "0123456789abcdef".repeat(4);

function ok(
  name: string,
  op: "hello" | "scan" | "status" | "cancel",
  state: { paired?: boolean; busy?: boolean } = {},
): PetUsbRequestVector {
  return { name, ...state, line: `${P}${op}`, expect: { outcome: "ok", op } };
}

function joined(
  name: string,
  line: string,
  ssid: readonly number[],
  password: string,
  setupCode: string,
): PetUsbRequestVector {
  return {
    name,
    line,
    expect: { outcome: "ok", op: "join", ssid, password, setupCode },
  };
}

function refused(
  name: string,
  line: string,
  reason: PetUsbParseRefusal,
  state: { paired?: boolean; busy?: boolean } = {},
): PetUsbRequestVector {
  return { name, ...state, line, expect: { outcome: "refused", reason } };
}

function ignored(name: string, line: string): PetUsbRequestVector {
  return { name, line, expect: { outcome: "ignored" } };
}

export const PET_USB_REQUEST_VECTORS: readonly PetUsbRequestVector[] = [
  // The four ops with no arguments.
  ok("hello", "hello"),
  ok("scan", "scan"),
  ok("status", "status"),
  ok("cancel", "cancel"),

  // A join: the name and password as hex, the code in its wire form.
  joined(
    "join-wpa2",
    join(HOME, bytesOf("correct horse"), CODE),
    HOME,
    "correct horse",
    CODE,
  ),
  joined(
    "join-code-lowercase-dashed",
    join(HOME, bytesOf("correct horse"), "k7qxm-2pa9t"),
    HOME,
    "correct horse",
    CODE,
  ),
  joined(
    "join-open-network",
    join(bytesOf("Cafe Guest"), "-", CODE),
    bytesOf("Cafe Guest"),
    "",
    CODE,
  ),
  joined(
    "join-ssid-not-utf8",
    join([0xff, 0xfe, 0x41], bytesOf("hunter22"), CODE),
    [0xff, 0xfe, 0x41],
    "hunter22",
    CODE,
  ),
  joined(
    "join-ssid-utf8",
    join([0x43, 0x61, 0x66, 0xc3, 0xa9], bytesOf("hunter22"), CODE),
    [0x43, 0x61, 0x66, 0xc3, 0xa9],
    "hunter22",
    CODE,
  ),
  joined(
    "join-ssid-32-bytes",
    join(bytesOf("s".repeat(32)), bytesOf("hunter22"), CODE),
    bytesOf("s".repeat(32)),
    "hunter22",
    CODE,
  ),
  joined(
    "join-password-8-characters",
    join(HOME, bytesOf("12345678"), CODE),
    HOME,
    "12345678",
    CODE,
  ),
  joined(
    "join-password-63-characters",
    join(HOME, bytesOf("p".repeat(63)), CODE),
    HOME,
    "p".repeat(63),
    CODE,
  ),
  joined(
    "join-password-64-hex-digits",
    join(HOME, bytesOf(RAW_KEY), CODE),
    HOME,
    RAW_KEY,
    CODE,
  ),

  // A join with a value the radio or the server would not take.
  refused(
    "join-ssid-33-bytes",
    join(bytesOf("s".repeat(33)), bytesOf("hunter22"), CODE),
    "bad_value",
  ),
  refused(
    "join-ssid-control-character",
    join([0x4f, 0x4b, 0x0a], bytesOf("hunter22"), CODE),
    "bad_value",
  ),
  refused(
    "join-ssid-delete-character",
    join([0x4f, 0x7f], bytesOf("hunter22"), CODE),
    "bad_value",
  ),
  refused(
    "join-password-7-characters",
    join(HOME, bytesOf("1234567"), CODE),
    "bad_value",
  ),
  refused(
    "join-password-64-not-hex",
    join(HOME, bytesOf("g".repeat(64)), CODE),
    "bad_value",
  ),
  refused(
    "join-password-65-characters",
    join(HOME, bytesOf("p".repeat(65)), CODE),
    "bad_value",
  ),
  refused(
    "join-password-not-ascii",
    join(HOME, [0x63, 0x61, 0x66, 0xc3, 0xa9, 0x31, 0x32, 0x33], CODE),
    "bad_value",
  ),
  refused(
    "join-password-control-character",
    join(HOME, bytesOf("pass\tword1"), CODE),
    "bad_value",
  ),
  refused(
    "join-hex-odd-length",
    `${P}join 486 ${hexOf(bytesOf("hunter22"))} ${CODE}`,
    "bad_value",
  ),
  refused(
    "join-hex-upper-case",
    `${P}join 486F ${hexOf(bytesOf("hunter22"))} ${CODE}`,
    "bad_value",
  ),
  refused(
    "join-hex-not-hex",
    `${P}join zz ${hexOf(bytesOf("hunter22"))} ${CODE}`,
    "bad_value",
  ),
  refused(
    "join-password-hex-not-hex",
    `${P}join ${hexOf(HOME)} zz ${CODE}`,
    "bad_value",
  ),
  refused(
    "join-code-too-short",
    join(HOME, bytesOf("hunter22"), "K7QXM2PA9"),
    "bad_value",
  ),
  refused(
    "join-code-too-long",
    join(HOME, bytesOf("hunter22"), "K7QXM2PA9TT"),
    "bad_value",
  ),
  refused(
    "join-code-letter-not-in-alphabet",
    join(HOME, bytesOf("hunter22"), "K7QXM2PA9I"),
    "bad_value",
  ),
  refused(
    "join-code-zero-not-in-alphabet",
    join(HOME, bytesOf("hunter22"), "K7QXM2PA90"),
    "bad_value",
  ),

  // An op the pet does not know, in any spelling.
  refused("unknown-op-flash", `${P}flash`, "unknown_op"),
  refused("unknown-op-upper-case", `${P}HELLO`, "unknown_op"),
  refused("unknown-op-with-arguments", `${P}reboot now`, "unknown_op"),

  // A line of the wrong shape.
  refused("empty-body", P, "bad_line"),
  refused("argument-on-hello", `${P}hello extra`, "bad_line"),
  refused("join-without-code", `${P}join ${hexOf(HOME)} -`, "bad_line"),
  refused(
    "join-with-extra-token",
    `${join(HOME, "-", CODE)} extra`,
    "bad_line",
  ),
  refused("double-space", `${P} hello`, "bad_line"),
  refused("trailing-space", `${P}hello `, "bad_line"),
  refused("tab-in-line", `${P}hello\tscan`, "bad_line"),
  refused("control-byte", `${P}hel\x01lo`, "bad_line"),
  refused("byte-above-ascii", `${P}h\xe9llo`, "bad_line"),

  // Not ours: no reply at all.
  ignored("no-prefix", "hello"),
  ignored("a-log-line", "[pet] wifi up"),
  ignored("prefix-without-space", "@pet1hello"),
  ignored("prefix-in-upper-case", "@PET1 hello"),
  ignored("another-version", "@pet2 hello"),
  ignored("empty-line", ""),

  // The length limit: 512 bytes are allowed, 513 are thrown away.
  refused("line-of-512-bytes", `${P}${"a".repeat(506)}`, "unknown_op"),
  refused("line-of-513-bytes", `${P}${"a".repeat(507)}`, "bad_line"),
  refused("join-line-of-600-bytes", `${P}join ${"a".repeat(600)}`, "bad_line"),
  ignored("long-line-without-prefix", "x".repeat(600)),

  // A paired pet answers hello and refuses everything else, without looking
  // at the values.
  ok("paired-hello", "hello", { paired: true }),
  refused("paired-scan", `${P}scan`, "paired", { paired: true }),
  refused("paired-status", `${P}status`, "paired", { paired: true }),
  refused("paired-cancel", `${P}cancel`, "paired", { paired: true }),
  refused("paired-join", join(HOME, bytesOf("hunter22"), CODE), "paired", {
    paired: true,
  }),
  refused("paired-join-bad-values", `${P}join zz zz zz`, "paired", {
    paired: true,
  }),
  refused("paired-unknown-op", `${P}flash`, "unknown_op", { paired: true }),
  refused("paired-bad-line", `${P}hello extra`, "bad_line", { paired: true }),
  refused("paired-and-busy-scan", `${P}scan`, "paired", {
    paired: true,
    busy: true,
  }),

  // A pet in the middle of a try takes no new scan or join.
  ok("busy-hello", "hello", { busy: true }),
  ok("busy-status", "status", { busy: true }),
  ok("busy-cancel", "cancel", { busy: true }),
  refused("busy-scan", `${P}scan`, "busy", { busy: true }),
  refused("busy-join", join(HOME, bytesOf("hunter22"), CODE), "busy", {
    busy: true,
  }),
];

function reply(
  name: string,
  value: PetUsbReply,
  line: string,
): PetUsbReplyVector {
  return { name, reply: value, line: `${P}${line}` };
}

export const PET_USB_REPLY_VECTORS: readonly PetUsbReplyVector[] = [
  reply(
    "hello-nova-unpaired-open",
    {
      type: "hello",
      version: 1,
      kind: "astronaut",
      firmware: "0.1.0",
      paired: false,
      setupOpen: true,
    },
    "hello 1 astronaut 0.1.0 unpaired open",
  ),
  reply(
    "hello-zib-unpaired-closed",
    {
      type: "hello",
      version: 1,
      kind: "alien",
      firmware: "0.1.0",
      paired: false,
      setupOpen: false,
    },
    "hello 1 alien 0.1.0 unpaired closed",
  ),
  reply(
    "hello-comet-paired-closed",
    {
      type: "hello",
      version: 1,
      kind: "cat",
      firmware: "1.2.3-rc.1",
      paired: true,
      setupOpen: false,
    },
    "hello 1 cat 1.2.3-rc.1 paired closed",
  ),

  reply(
    "net-locked",
    { type: "net", ssid: Uint8Array.from(HOME), rssi: -42, locked: true },
    `net ${hexOf(HOME)} -42 locked`,
  ),
  reply(
    "net-open-network",
    {
      type: "net",
      ssid: Uint8Array.from(bytesOf("Cafe Guest")),
      rssi: -71,
      locked: false,
    },
    `net ${hexOf(bytesOf("Cafe Guest"))} -71 open`,
  ),
  reply(
    "net-ssid-not-utf8",
    {
      type: "net",
      ssid: Uint8Array.from([0xff, 0xfe, 0x41]),
      rssi: -80,
      locked: true,
    },
    "net fffe41 -80 locked",
  ),
  reply(
    "net-ssid-32-bytes-strongest-signal",
    {
      type: "net",
      ssid: Uint8Array.from(bytesOf("s".repeat(32))),
      rssi: 0,
      locked: true,
    },
    `net ${hexOf(bytesOf("s".repeat(32)))} 0 locked`,
  ),
  reply(
    "net-weakest-signal",
    { type: "net", ssid: Uint8Array.from([0x41]), rssi: -127, locked: false },
    "net 41 -127 open",
  ),

  reply("scan-done-none", { type: "scan-done", count: 0 }, "scan-done 0"),
  reply("scan-done-some", { type: "scan-done", count: 7 }, "scan-done 7"),
  reply(
    "scan-done-at-the-cap",
    { type: "scan-done", count: 20 },
    "scan-done 20",
  ),

  reply("state-joining", { type: "state", state: "joining" }, "state joining"),
  reply("state-pairing", { type: "state", state: "pairing" }, "state pairing"),
  reply("state-confirm", { type: "state", state: "confirm" }, "state confirm"),
  reply("state-done", { type: "state", state: "done" }, "state done"),
  reply(
    "state-error-wifi-failed",
    { type: "state", state: "error", error: "wifi_failed" },
    "state error wifi_failed",
  ),
  reply(
    "state-error-code-refused",
    { type: "state", state: "error", error: "code_refused" },
    "state error code_refused",
  ),
  reply(
    "state-error-unreachable",
    { type: "state", state: "error", error: "unreachable" },
    "state error unreachable",
  ),
  reply(
    "state-error-timed-out",
    { type: "state", state: "error", error: "timed_out" },
    "state error timed_out",
  ),
  reply(
    "state-error-save-failed",
    { type: "state", state: "error", error: "save_failed" },
    "state error save_failed",
  ),

  reply(
    "refused-paired",
    { type: "refused", reason: "paired" },
    "refused paired",
  ),
  reply("refused-busy", { type: "refused", reason: "busy" }, "refused busy"),
  reply(
    "refused-bad-line",
    { type: "refused", reason: "bad_line" },
    "refused bad_line",
  ),
  reply(
    "refused-unknown-op",
    { type: "refused", reason: "unknown_op" },
    "refused unknown_op",
  ),
  reply(
    "refused-rate-limited",
    { type: "refused", reason: "rate_limited" },
    "refused rate_limited",
  ),
  reply(
    "refused-bad-value",
    { type: "refused", reason: "bad_value" },
    "refused bad_value",
  ),
];
