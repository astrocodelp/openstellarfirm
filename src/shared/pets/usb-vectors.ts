import type { PetUsb2Reply, PetUsbParseRefusal, PetUsbReply } from "./usb";

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

// -- pet-usb v2 --------------------------------------------------------------------

/** What a v2 pet has staged and is doing, for one request row. */
export interface PetUsb2State {
  readonly paired?: boolean;
  readonly busy?: boolean;
  readonly hasServer?: boolean;
  readonly hasWifi?: boolean;
}

/** One v2 request line and what a v2 pet makes of it in a given state. */
export interface PetUsb2RequestVector extends PetUsb2State {
  readonly name: string;
  readonly line: string;
  readonly expect:
    | { readonly outcome: "ignored" }
    | {
        readonly outcome: "ok";
        readonly op: "hello" | "scan" | "status" | "cancel";
      }
    | {
        readonly outcome: "ok";
        readonly op: "server";
        /** Empty for `-`, no address. */
        readonly address: string;
        readonly port: number;
        readonly fingerprint: string;
        readonly serverName: string;
      }
    | {
        readonly outcome: "ok";
        readonly op: "wifi";
        readonly ssid: readonly number[];
        readonly password: string;
      }
    | {
        readonly outcome: "ok";
        readonly op: "start";
        readonly setupCode: string;
      }
    | {
        readonly outcome: "refused";
        readonly reason: PetUsbParseRefusal | "not_ready";
      };
}

/** One v2 reply line and the fixed inputs it is built from. */
export interface PetUsb2ReplyVector {
  readonly name: string;
  readonly reply: PetUsb2Reply;
  readonly line: string;
}

const FP = "a1b2c3d4e5f60718".repeat(4);
const NAME = "osf-3fa91c0d.local";

function server(
  address: string,
  port: number | string,
  fingerprint: string,
  name: string,
): string {
  return `${P}server ${address} ${port} ${fingerprint} ${name}`;
}

function wifi(
  ssid: readonly number[],
  password: readonly number[] | "-",
): string {
  return `${P}wifi ${hexOf(ssid)} ${password === "-" ? "-" : hexOf(password)}`;
}

function ok2(
  name: string,
  op: "hello" | "scan" | "status" | "cancel",
  state: PetUsb2State = {},
): PetUsb2RequestVector {
  return { name, ...state, line: `${P}${op}`, expect: { outcome: "ok", op } };
}

function server2(
  name: string,
  line: string,
  address: string,
  port: number,
  state: PetUsb2State = {},
): PetUsb2RequestVector {
  return {
    name,
    ...state,
    line,
    expect: {
      outcome: "ok",
      op: "server",
      address,
      port,
      fingerprint: FP,
      serverName: NAME,
    },
  };
}

function wifi2(
  name: string,
  line: string,
  ssid: readonly number[],
  password: string,
): PetUsb2RequestVector {
  return {
    name,
    line,
    expect: { outcome: "ok", op: "wifi", ssid, password },
  };
}

function start2(
  name: string,
  line: string,
  setupCode: string,
  state: PetUsb2State,
): PetUsb2RequestVector {
  return {
    name,
    ...state,
    line,
    expect: { outcome: "ok", op: "start", setupCode },
  };
}

function refused2(
  name: string,
  line: string,
  reason: PetUsbParseRefusal | "not_ready",
  state: PetUsb2State = {},
): PetUsb2RequestVector {
  return { name, ...state, line, expect: { outcome: "refused", reason } };
}

const READY: PetUsb2State = { hasServer: true, hasWifi: true };

export const PET_USB2_REQUEST_VECTORS: readonly PetUsb2RequestVector[] = [
  // The v1 ops are read as they were.
  ok2("v2-hello", "hello"),
  ok2("v2-scan", "scan"),
  ok2("v2-status", "status"),
  ok2("v2-cancel", "cancel"),

  // server: an address (or none), the port, the pin and the mDNS name.
  server2(
    "server-ipv4",
    server("192.168.1.20", 4801, FP, NAME),
    "192.168.1.20",
    4801,
  ),
  server2(
    "server-ipv6-ula",
    server("fd12:3456:789a::1", 4801, FP, NAME),
    "fd12:3456:789a::1",
    4801,
  ),
  server2(
    "server-ipv6-full",
    server("fd12:3456:789a:1:2:3:4:5", 65535, FP, NAME),
    "fd12:3456:789a:1:2:3:4:5",
    65535,
  ),
  server2("server-no-address", server("-", 1, FP, NAME), "", 1),
  refused2(
    "server-address-leading-zero",
    server("192.168.01.20", 4801, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-address-octet-256",
    server("192.168.1.256", 4801, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-address-uppercase-ipv6",
    server("FD12::1", 4801, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-address-ipv6-zone",
    server("fe80::1%en0", 4801, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-address-hostname",
    server("computer.local", 4801, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-port-zero",
    server("192.168.1.20", 0, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-port-65536",
    server("192.168.1.20", 65536, FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-port-leading-zero",
    server("192.168.1.20", "04801", FP, NAME),
    "bad_value",
  ),
  refused2(
    "server-fingerprint-63",
    server("192.168.1.20", 4801, FP.slice(1), NAME),
    "bad_value",
  ),
  refused2(
    "server-fingerprint-uppercase",
    server("192.168.1.20", 4801, FP.toUpperCase(), NAME),
    "bad_value",
  ),
  refused2(
    "server-name-wrong-prefix",
    server("192.168.1.20", 4801, FP, "pet-3fa91c0d.local"),
    "bad_value",
  ),
  refused2(
    "server-name-short-label",
    server("192.168.1.20", 4801, FP, "osf-3fa91c0.local"),
    "bad_value",
  ),
  refused2(
    "server-name-not-local",
    server("192.168.1.20", 4801, FP, "osf-3fa91c0d.example.com"),
    "bad_value",
  ),
  refused2(
    "server-missing-name",
    `${P}server 192.168.1.20 4801 ${FP}`,
    "bad_line",
  ),
  refused2(
    "server-extra-token",
    `${server("192.168.1.20", 4801, FP, NAME)} x`,
    "bad_line",
  ),

  // wifi: the name and the password as hex, the same rules as v1's join.
  wifi2(
    "wifi-wpa2",
    wifi(HOME, bytesOf("correct horse")),
    HOME,
    "correct horse",
  ),
  wifi2(
    "wifi-open-network",
    wifi(bytesOf("Cafe Guest"), "-"),
    bytesOf("Cafe Guest"),
    "",
  ),
  wifi2(
    "wifi-ssid-not-utf8",
    wifi([0xff, 0xfe, 0x41], bytesOf("hunter22")),
    [0xff, 0xfe, 0x41],
    "hunter22",
  ),
  wifi2(
    "wifi-ssid-32-bytes",
    wifi(bytesOf("s".repeat(32)), bytesOf("hunter22")),
    bytesOf("s".repeat(32)),
    "hunter22",
  ),
  wifi2(
    "wifi-password-63-characters",
    wifi(HOME, bytesOf("p".repeat(63))),
    HOME,
    "p".repeat(63),
  ),
  wifi2(
    "wifi-password-64-hex-digits",
    wifi(HOME, bytesOf(RAW_KEY)),
    HOME,
    RAW_KEY,
  ),
  refused2(
    "wifi-ssid-33-bytes",
    wifi(bytesOf("s".repeat(33)), bytesOf("hunter22")),
    "bad_value",
  ),
  refused2(
    "wifi-ssid-control-character",
    wifi([0x4f, 0x0a], bytesOf("hunter22")),
    "bad_value",
  ),
  refused2(
    "wifi-password-7-characters",
    wifi(HOME, bytesOf("1234567")),
    "bad_value",
  ),
  refused2(
    "wifi-password-64-not-hex",
    wifi(HOME, bytesOf("g".repeat(64))),
    "bad_value",
  ),
  refused2(
    "wifi-password-not-ascii",
    wifi(HOME, [0x70, 0x61, 0x73, 0xc3, 0xa9, 0x31, 0x32, 0x33, 0x34]),
    "bad_value",
  ),
  refused2("wifi-password-not-hex", `${P}wifi ${hexOf(HOME)} zz`, "bad_value"),
  refused2("wifi-missing-password", `${P}wifi ${hexOf(HOME)}`, "bad_line"),

  // start: only with both stages in place.
  start2("start-ready", `${P}start ${CODE}`, CODE, READY),
  start2("start-ready-lowercase-dashed", `${P}start k7qxm-2pa9t`, CODE, READY),
  refused2("start-nothing-staged", `${P}start ${CODE}`, "not_ready"),
  refused2("start-no-wifi", `${P}start ${CODE}`, "not_ready", {
    hasServer: true,
  }),
  refused2("start-no-server", `${P}start ${CODE}`, "not_ready", {
    hasWifi: true,
  }),
  refused2("start-bad-code-before-ready", `${P}start NOTACODE`, "bad_value"),
  refused2("start-missing-code", `${P}start`, "bad_line"),

  // A paired pet answers only hello; a try that runs takes no new stage.
  refused2("paired-server", server("192.168.1.20", 4801, FP, NAME), "paired", {
    paired: true,
  }),
  refused2("paired-wifi", wifi(HOME, bytesOf("hunter22")), "paired", {
    paired: true,
  }),
  refused2("paired-start", `${P}start ${CODE}`, "paired", {
    paired: true,
    ...READY,
  }),
  refused2("paired-server-bad-values", `${P}server x x x x`, "paired", {
    paired: true,
  }),
  refused2("busy-server", server("192.168.1.20", 4801, FP, NAME), "busy", {
    busy: true,
  }),
  refused2("busy-wifi", wifi(HOME, bytesOf("hunter22")), "busy", {
    busy: true,
  }),
  refused2("busy-start", `${P}start ${CODE}`, "busy", { busy: true, ...READY }),
  ok2("busy-cancel-v2", "cancel", { busy: true }),
];

function reply2(
  name: string,
  value: PetUsb2Reply,
  line: string,
): PetUsb2ReplyVector {
  return { name, reply: value, line: `${P}${line}` };
}

export const PET_USB2_REPLY_VECTORS: readonly PetUsb2ReplyVector[] = [
  reply2(
    "hello-v2-unpaired-open",
    {
      type: "hello",
      version: 2,
      kind: "astronaut",
      firmware: "0.2.0",
      paired: false,
      setupOpen: false,
    },
    "hello 2 astronaut 0.2.0 unpaired closed",
  ),
  reply2(
    "hello-v2-paired",
    {
      type: "hello",
      version: 2,
      kind: "cat",
      firmware: "0.2.0",
      paired: true,
      setupOpen: false,
    },
    "hello 2 cat 0.2.0 paired closed",
  ),
  reply2("ok-server", { type: "ok", op: "server" }, "ok server"),
  reply2("ok-wifi", { type: "ok", op: "wifi" }, "ok wifi"),
  reply2("ok-start", { type: "ok", op: "start" }, "ok start"),
  reply2(
    "refused-not-ready",
    { type: "refused", reason: "not_ready" },
    "refused not_ready",
  ),
  reply2(
    "v2-refused-busy",
    { type: "refused", reason: "busy" },
    "refused busy",
  ),
  reply2(
    "v2-state-confirm",
    { type: "state", state: "confirm" },
    "state confirm",
  ),
];
