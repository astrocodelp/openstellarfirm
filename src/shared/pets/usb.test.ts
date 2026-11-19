import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_ALPHABET } from "./codes";
import { PET_KINDS } from "./kinds";
import {
  createPetUsbLineSplitter,
  decodePetUsb2Reply,
  decodePetUsbReply,
  encodePetUsb2Reply,
  encodePetUsb2Request,
  encodePetUsbReply,
  encodePetUsbRequest,
  isPetUsbIpv4,
  isPetUsbIpv6,
  isPetUsbPassword,
  isPetUsbSsid,
  PET_USB_BAUD,
  PET_USB_ERRORS,
  PET_USB_MAX_LINE,
  PET_USB_MAX_LINES_PER_SECOND,
  PET_USB_MAX_NETWORKS,
  PET_USB_OPS,
  PET_USB_PREFIX,
  PET_USB_PRODUCT_ID,
  PET_USB_REFUSALS,
  PET_USB_REPLY_TYPES,
  PET_USB_STATES,
  PET_USB_VENDOR_ID,
  PET_USB_VERSION,
  PET_USB2_OPS,
  PET_USB2_REFUSALS,
  PET_USB2_VERSION,
  PetUsbFormatError,
  type PetUsbReply,
  type PetUsbSplit,
  parsePetUsb2Request,
  parsePetUsbRequest,
  petUsbFromHex,
  petUsbRefusal,
  petUsbSetupCode,
  petUsbSpeaksV2,
  petUsbToHex,
  petUsbWire,
} from "./usb";
import {
  PET_USB_REPLY_VECTORS,
  PET_USB_REQUEST_VECTORS,
  PET_USB2_REPLY_VECTORS,
  PET_USB2_REQUEST_VECTORS,
} from "./usb-vectors";

const P = "@pet1 ";
const HOME_HEX = "486f6d652057692d4669";
const CORRECT_HORSE_HEX = "636f727265637420686f727365";
const CODE = "K7QXM2PA9T";

/** The bytes of an ASCII or latin-1 string, one per character. */
function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function feed(text: string): PetUsbSplit[] {
  return createPetUsbLineSplitter().push(bytes(text));
}

describe("the constants", () => {
  it("are the ones of the design", () => {
    expect(PET_USB_PREFIX).toBe("@pet1 ");
    expect(PET_USB_PREFIX).toBe(`@pet${PET_USB_VERSION} `);
    expect(PET_USB_VERSION).toBe(1);
    expect(PET_USB_MAX_LINE).toBe(512);
    expect(PET_USB_MAX_LINES_PER_SECOND).toBe(10);
    expect(PET_USB_BAUD).toBe(115_200);
    expect(PET_USB_VENDOR_ID).toBe(0x2341);
    expect(PET_USB_PRODUCT_ID).toBe(0x0070);
    expect(PET_USB_MAX_NETWORKS).toBe(20);
  });

  it("list exactly the ops, replies, states, errors and refusals of v1", () => {
    expect([...PET_USB_OPS]).toEqual([
      "hello",
      "scan",
      "join",
      "status",
      "cancel",
    ]);
    expect([...PET_USB_REPLY_TYPES]).toEqual([
      "hello",
      "net",
      "scan-done",
      "state",
      "refused",
    ]);
    expect([...PET_USB_STATES]).toEqual([
      "joining",
      "pairing",
      "confirm",
      "done",
      "error",
    ]);
    expect([...PET_USB_ERRORS]).toEqual([
      "wifi_failed",
      "code_refused",
      "unreachable",
      "timed_out",
      "save_failed",
    ]);
    expect([...PET_USB_REFUSALS]).toEqual([
      "paired",
      "busy",
      "bad_line",
      "unknown_op",
      "rate_limited",
      "bad_value",
    ]);
  });
});

describe("hex", () => {
  it("is lowercase, two characters a byte", () => {
    expect(petUsbToHex(bytes("Home Wi-Fi"))).toBe(HOME_HEX);
    expect(petUsbToHex(Uint8Array.from([0x00, 0x0f, 0xa0, 0xff]))).toBe(
      "000fa0ff",
    );
    expect(petUsbToHex(new Uint8Array())).toBe("");
  });

  it("reads only lowercase hex of an even length", () => {
    expect([...(petUsbFromHex(HOME_HEX) ?? [])]).toEqual([
      ...bytes("Home Wi-Fi"),
    ]);
    expect(petUsbFromHex("fffe41")).toEqual(
      Uint8Array.from([0xff, 0xfe, 0x41]),
    );
    for (const bad of [
      "",
      "f",
      "abc",
      "FF",
      "4F4b",
      "zz",
      "0x41",
      "41 42",
      "-",
    ]) {
      expect(petUsbFromHex(bad), bad).toBeNull();
    }
  });
});

describe("the values the firmware checks", () => {
  it("takes a Wi-Fi name of 1 to 32 bytes with no control character", () => {
    expect(isPetUsbSsid(bytes("a"))).toBe(true);
    expect(isPetUsbSsid(bytes("s".repeat(32)))).toBe(true);
    expect(isPetUsbSsid(Uint8Array.from([0xff, 0xfe, 0x41]))).toBe(true);
    expect(isPetUsbSsid(new Uint8Array())).toBe(false);
    expect(isPetUsbSsid(bytes("s".repeat(33)))).toBe(false);
    expect(isPetUsbSsid(Uint8Array.from([0x41, 0x1f]))).toBe(false);
    expect(isPetUsbSsid(Uint8Array.from([0x41, 0x7f]))).toBe(false);
    expect(isPetUsbSsid(Uint8Array.from([0x20]))).toBe(true);
  });

  it("takes 8 to 63 printable ASCII characters, 64 hex digits, or nothing", () => {
    expect(isPetUsbPassword("")).toBe(true);
    expect(isPetUsbPassword("12345678")).toBe(true);
    expect(isPetUsbPassword("correct horse battery staple")).toBe(true);
    expect(isPetUsbPassword("p".repeat(63))).toBe(true);
    expect(isPetUsbPassword("0123456789abcdef".repeat(4))).toBe(true);
    expect(isPetUsbPassword("0123456789ABCDEF".repeat(4))).toBe(true);
    expect(isPetUsbPassword("1234567")).toBe(false);
    expect(isPetUsbPassword("p".repeat(64))).toBe(false);
    expect(isPetUsbPassword("p".repeat(65))).toBe(false);
    expect(isPetUsbPassword("pass\tword1")).toBe(false);
    expect(isPetUsbPassword("cafépass1")).toBe(false);
    expect(isPetUsbPassword("pass\u007fword")).toBe(false);
  });

  it("normalizes the setup code like the firmware", () => {
    expect(petUsbSetupCode("K7QXM-2PA9T")).toBe(CODE);
    expect(petUsbSetupCode("k7qxm 2pa9t")).toBe(CODE);
    expect(petUsbSetupCode(CODE)).toBe(CODE);
    for (const bad of [
      "",
      "K7QXM2PA9",
      "K7QXM2PA9TT",
      "K7QXM2PA9I",
      "K7QXM2PA90",
      "K7QXM2PA9L",
      "ABCD-EFGH",
    ]) {
      expect(petUsbSetupCode(bad), bad).toBeNull();
    }
  });
});

describe("encodePetUsbRequest", () => {
  it("writes the ops with no arguments", () => {
    for (const op of ["hello", "scan", "status", "cancel"] as const) {
      expect(encodePetUsbRequest({ op })).toBe(`${P}${op}`);
    }
  });

  it("writes a join with hex for the name and the password", () => {
    expect(
      encodePetUsbRequest({
        op: "join",
        ssid: "Home Wi-Fi",
        password: "correct horse",
        setupCode: "K7QXM-2PA9T",
      }),
    ).toBe(`${P}join ${HOME_HEX} ${CORRECT_HORSE_HEX} ${CODE}`);
  });

  it("sends a typed name as UTF-8 and a scanned name as the bytes the pet gave", () => {
    expect(
      encodePetUsbRequest({
        op: "join",
        ssid: "Café",
        password: "hunter22",
        setupCode: CODE,
      }),
    ).toBe(`${P}join 436166c3a9 68756e7465723232 ${CODE}`);
    expect(
      encodePetUsbRequest({
        op: "join",
        ssid: Uint8Array.from([0xff, 0xfe, 0x41]),
        password: "hunter22",
        setupCode: CODE,
      }),
    ).toBe(`${P}join fffe41 68756e7465723232 ${CODE}`);
  });

  it("sends a dash for an open network", () => {
    expect(
      encodePetUsbRequest({
        op: "join",
        ssid: "Cafe Guest",
        password: "",
        setupCode: CODE,
      }),
    ).toBe(`${P}join 43616665204775657374 - ${CODE}`);
  });

  it("refuses what the firmware would refuse, naming the field and never the value", () => {
    const secret = "short";
    const cases = [
      { ssid: "", password: "hunter22", setupCode: CODE, field: "ssid" },
      {
        ssid: "s".repeat(33),
        password: "hunter22",
        setupCode: CODE,
        field: "ssid",
      },
      {
        ssid: "tab\there",
        password: "hunter22",
        setupCode: CODE,
        field: "ssid",
      },
      { ssid: "Home", password: secret, setupCode: CODE, field: "password" },
      {
        ssid: "Home",
        password: "cafépass1",
        setupCode: CODE,
        field: "password",
      },
      {
        ssid: "Home",
        password: "hunter22",
        setupCode: "K7QXM2PA9",
        field: "setupCode",
      },
      {
        ssid: "Home",
        password: "hunter22",
        setupCode: "ABCD-EFGH",
        field: "setupCode",
      },
    ];
    for (const { field, ...rest } of cases) {
      let caught: unknown;
      try {
        encodePetUsbRequest({ op: "join", ...rest });
      } catch (error) {
        caught = error;
      }
      expect(caught, field).toBeInstanceOf(PetUsbFormatError);
      expect((caught as PetUsbFormatError).field).toBe(field);
      const message = (caught as Error).message;
      for (const value of [rest.password, rest.setupCode, rest.ssid]) {
        if (value.length >= 5) {
          expect(message).not.toContain(value);
        }
      }
    }
  });

  it("refuses an op that is not in v1", () => {
    expect(() => encodePetUsbRequest({ op: "flash" as never })).toThrow(
      PetUsbFormatError,
    );
  });

  it("always makes a line the pet's parser takes back whole", () => {
    // A small seeded generator, so the run is the same every time.
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed;
    };
    for (let n = 0; n < 300; n += 1) {
      const ssid = Uint8Array.from({ length: 1 + (next() % 32) }, () => {
        let byte = next() & 0xff;
        while (byte < 0x20 || byte === 0x7f) {
          byte = next() & 0xff;
        }
        return byte;
      });
      const open = next() % 5 === 0;
      const password = open
        ? ""
        : String.fromCharCode(
            ...Array.from(
              { length: 8 + (next() % 56) },
              () => 0x20 + (next() % 95),
            ),
          );
      const setupCode = Array.from({ length: 10 }, () =>
        CODE_ALPHABET.charAt(next() % CODE_ALPHABET.length),
      ).join("");
      const line = encodePetUsbRequest({
        op: "join",
        ssid,
        password,
        setupCode,
      });
      expect(line.length).toBeLessThanOrEqual(PET_USB_MAX_LINE);
      const parsed = parsePetUsbRequest(line);
      expect(parsed.outcome).toBe("ok");
      if (parsed.outcome === "ok" && parsed.request.op === "join") {
        expect([...parsed.request.ssid]).toEqual([...ssid]);
        expect(parsed.request.password).toBe(password);
        expect(parsed.request.setupCode).toBe(setupCode);
      }
    }
  });
});

describe("the request vectors", () => {
  it("are what parsePetUsbRequest makes of each line", () => {
    for (const vector of PET_USB_REQUEST_VECTORS) {
      const parsed = parsePetUsbRequest(vector.line, {
        paired: vector.paired ?? false,
        busy: vector.busy ?? false,
      });
      const { expect: want } = vector;
      expect(parsed.outcome, vector.name).toBe(want.outcome);
      if (want.outcome === "refused" && parsed.outcome === "refused") {
        expect(parsed.reason, vector.name).toBe(want.reason);
      }
      if (want.outcome === "ok" && parsed.outcome === "ok") {
        expect(parsed.request.op, vector.name).toBe(want.op);
        if (want.op === "join" && parsed.request.op === "join") {
          expect([...parsed.request.ssid], vector.name).toEqual([...want.ssid]);
          expect(parsed.request.password, vector.name).toBe(want.password);
          expect(parsed.request.setupCode, vector.name).toBe(want.setupCode);
        }
      }
    }
  });

  it("have unique names and are made of single bytes", () => {
    const names = PET_USB_REQUEST_VECTORS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const vector of PET_USB_REQUEST_VECTORS) {
      for (const char of vector.line) {
        expect(char.charCodeAt(0), vector.name).toBeLessThan(256);
      }
    }
  });

  it("cover every op, every refusal a line can earn and every kind of value", () => {
    const ok = new Set<string>();
    const refusals = new Set<string>();
    const outcomes = new Set<string>();
    for (const { expect: want } of PET_USB_REQUEST_VECTORS) {
      outcomes.add(want.outcome);
      if (want.outcome === "ok") {
        ok.add(want.op);
      }
      if (want.outcome === "refused") {
        refusals.add(want.reason);
      }
    }
    expect([...ok].sort()).toEqual([...PET_USB_OPS].sort());
    expect([...refusals].sort()).toEqual(
      PET_USB_REFUSALS.filter((reason) => reason !== "rate_limited").sort(),
    );
    expect([...outcomes].sort()).toEqual(["ignored", "ok", "refused"]);
    const names = PET_USB_REQUEST_VECTORS.map((v) => v.name).join(" ");
    for (const wanted of [
      "long-line",
      "512",
      "513",
      "not-utf8",
      "open-network",
      "password-7",
      "code-too-short",
      "hex-odd",
      "hex-upper",
      "unknown-op",
      "a-log-line",
    ]) {
      expect(names, wanted).toContain(wanted);
    }
  });
});

describe("parsePetUsbRequest", () => {
  it("ignores a line without the prefix, whatever else is wrong with it", () => {
    for (const line of [
      "",
      "hello",
      "[pet] wifi up",
      "@pet1hello",
      "@PET1 hello",
      "@pet2 hello",
      " @pet1 hello",
      "x".repeat(2000),
    ]) {
      expect(parsePetUsbRequest(line), line).toEqual({ outcome: "ignored" });
    }
  });

  it("checks shape, then op, then state, then values", () => {
    // A bad value in a paired pet is `paired`: the values are never looked at.
    expect(
      parsePetUsbRequest(`${P}join zz zz zz`, { paired: true, busy: false }),
    ).toEqual({
      outcome: "refused",
      reason: "paired",
    });
    // An unknown op is unknown whatever the state.
    expect(
      parsePetUsbRequest(`${P}flash`, { paired: true, busy: false }),
    ).toEqual({
      outcome: "refused",
      reason: "unknown_op",
    });
    // The wrong number of tokens is a bad line before the state is asked.
    expect(
      parsePetUsbRequest(`${P}scan now`, { paired: true, busy: false }),
    ).toEqual({
      outcome: "refused",
      reason: "bad_line",
    });
  });

  it("takes a line of 512 bytes and throws one of 513 away", () => {
    expect(parsePetUsbRequest(`${P}${"a".repeat(506)}`)).toEqual({
      outcome: "refused",
      reason: "unknown_op",
    });
    expect(parsePetUsbRequest(`${P}${"a".repeat(507)}`)).toEqual({
      outcome: "refused",
      reason: "bad_line",
    });
  });

  it("applies the state rules", () => {
    const states = [
      { paired: false, busy: false },
      { paired: false, busy: true },
      { paired: true, busy: false },
      { paired: true, busy: true },
    ];
    const want: Record<string, (string | null)[]> = {
      // idle, busy, paired, paired and busy
      hello: [null, null, null, null],
      scan: [null, "busy", "paired", "paired"],
      join: [null, "busy", "paired", "paired"],
      status: [null, null, "paired", "paired"],
      cancel: [null, null, "paired", "paired"],
    };
    for (const op of PET_USB_OPS) {
      states.forEach((state, i) => {
        expect(petUsbRefusal(op, state), `${op} ${i}`).toBe(want[op]?.[i]);
      });
    }
  });
});

describe("the reply vectors", () => {
  it("are what encodePetUsbReply writes for their inputs", () => {
    for (const vector of PET_USB_REPLY_VECTORS) {
      expect(encodePetUsbReply(vector.reply), vector.name).toBe(vector.line);
    }
  });

  it("are what decodePetUsbReply reads back", () => {
    for (const vector of PET_USB_REPLY_VECTORS) {
      expect(decodePetUsbReply(vector.line), vector.name).toEqual(vector.reply);
    }
  });

  it("cover every reply word, state, error and refusal", () => {
    const types = new Set<string>();
    const states = new Set<string>();
    const errors = new Set<string>();
    const reasons = new Set<string>();
    for (const { reply } of PET_USB_REPLY_VECTORS) {
      types.add(reply.type);
      if (reply.type === "state") {
        states.add(reply.state);
        if (reply.state === "error") {
          errors.add(reply.error);
        }
      }
      if (reply.type === "refused") {
        reasons.add(reply.reason);
      }
    }
    expect([...types].sort()).toEqual([...PET_USB_REPLY_TYPES].sort());
    expect([...states].sort()).toEqual([...PET_USB_STATES].sort());
    expect([...errors].sort()).toEqual([...PET_USB_ERRORS].sort());
    expect([...reasons].sort()).toEqual([...PET_USB_REFUSALS].sort());
  });

  it("include a name that is not UTF-8, an open network and the cap", () => {
    const lines = PET_USB_REPLY_VECTORS.map((v) => v.line);
    expect(lines).toContain(`${P}net fffe41 -80 locked`);
    expect(lines).toContain(`${P}net 43616665204775657374 -71 open`);
    expect(lines).toContain(`${P}scan-done ${PET_USB_MAX_NETWORKS}`);
  });
});

describe("decodePetUsbReply", () => {
  it("drops everything without the prefix, the firmware's own log lines included", () => {
    for (const line of [
      "",
      "[pet] wifi up",
      "I (123) wifi: connected",
      "hello 1 cat 0.1.0 paired open",
      "@pet2 hello 1 cat 0.1.0 paired open",
      "@pet1hello 1 cat 0.1.0 paired open",
    ]) {
      expect(decodePetUsbReply(line), line).toBeNull();
    }
  });

  it("drops a prefixed line that is malformed or not in the lists", () => {
    const good = {
      hello: "hello 1 cat 0.1.0 unpaired open",
      net: "net 486f6d65 -42 locked",
      scanDone: "scan-done 3",
      state: "state joining",
      refused: "refused busy",
    };
    for (const text of Object.values(good)) {
      expect(decodePetUsbReply(P + text), text).not.toBeNull();
    }
    for (const bad of [
      "",
      "unknown",
      "hello",
      "hello 0 cat 0.1.0 unpaired open",
      "hello 1 dog 0.1.0 unpaired open",
      "hello 1 cat 0.1 unpaired open",
      "hello 1 cat 0.1.0 maybe open",
      "hello 1 cat 0.1.0 unpaired shut",
      "hello 1 cat 0.1.0 unpaired open extra",
      "hello 01 cat 0.1.0 unpaired open",
      "hello 1 cat 0.1.0-with.a.very.long.suffix.xx unpaired open",
      "net 486F -42 locked",
      "net 486f6d65 42 locked",
      "net 486f6d65 -0 locked",
      "net 486f6d65 -128 locked",
      "net 486f6d65 -42 secret",
      "net  -42 locked",
      "net 00 -42 locked",
      `net ${"41".repeat(33)} -42 locked`,
      "net 486f6d65 -42",
      "scan-done",
      "scan-done 21",
      "scan-done -1",
      "scan-done 07",
      "scan-done 3 4",
      "state",
      "state running",
      "state error",
      "state error nonsense",
      "state error wifi_failed extra",
      "state joining wifi_failed",
      "state confirm ABCD-EFGH",
      "refused",
      "refused nonsense",
      "refused busy now",
      "hello  1 cat 0.1.0 unpaired open",
      "hello 1 cat 0.1.0 unpaired open ",
    ]) {
      expect(decodePetUsbReply(P + bad), bad).toBeNull();
    }
  });

  it("drops a line over 512 bytes or with a byte that is not printable ASCII", () => {
    expect(decodePetUsbReply(`${P}refused ${"a".repeat(600)}`)).toBeNull();
    expect(decodePetUsbReply(`${P}refused bus\u0000y`)).toBeNull();
    expect(decodePetUsbReply(`${P}refused busy\r`)).toBeNull();
    expect(decodePetUsbReply(`${P}refused busy\n`)).toBeNull();
    expect(decodePetUsbReply(`${P}refused büsy`)).toBeNull();
  });

  it("reads a network name as the bytes the pet sent", () => {
    const reply = decodePetUsbReply(`${P}net fffe41 -80 locked`);
    expect(reply?.type).toBe("net");
    if (reply?.type === "net") {
      expect([...reply.ssid]).toEqual([0xff, 0xfe, 0x41]);
      expect(reply.rssi).toBe(-80);
      expect(reply.locked).toBe(true);
    }
  });

  it("narrows a state reply by its state", () => {
    const failed = decodePetUsbReply(`${P}state error timed_out`);
    expect(failed).toEqual({
      type: "state",
      state: "error",
      error: "timed_out",
    });
    const joining = decodePetUsbReply(`${P}state joining`);
    expect(joining).toEqual({ type: "state", state: "joining" });
  });
});

describe("encodePetUsbReply", () => {
  it("refuses a word that is not in the lists", () => {
    const bad: unknown[] = [
      {
        type: "hello",
        version: 0,
        kind: "cat",
        firmware: "0.1.0",
        paired: false,
        setupOpen: true,
      },
      {
        type: "hello",
        version: 1,
        kind: "dog",
        firmware: "0.1.0",
        paired: false,
        setupOpen: true,
      },
      {
        type: "hello",
        version: 1,
        kind: "cat",
        firmware: "0.1",
        paired: false,
        setupOpen: true,
      },
      {
        type: "hello",
        version: 1,
        kind: "cat",
        firmware: "0.1.0 x",
        paired: false,
        setupOpen: true,
      },
      { type: "net", ssid: new Uint8Array(), rssi: -40, locked: true },
      { type: "net", ssid: bytes("Home"), rssi: 5, locked: true },
      { type: "net", ssid: bytes("Home"), rssi: -40.5, locked: true },
      { type: "scan-done", count: 21 },
      { type: "scan-done", count: -1 },
      { type: "state", state: "running" },
      { type: "state", state: "error" },
      { type: "state", state: "error", error: "nonsense" },
      { type: "state", state: "joining", error: "wifi_failed" },
      { type: "refused", reason: "nonsense" },
      { type: "bye" },
    ];
    for (const reply of bad) {
      expect(
        () => encodePetUsbReply(reply as PetUsbReply),
        JSON.stringify(reply),
      ).toThrow(PetUsbFormatError);
    }
  });
});

describe("the line splitter", () => {
  const lineOf = (line: string) => ({ kind: "line" as const, line });

  it("hands back whole lines", () => {
    expect(feed("@pet1 hello\n@pet1 scan\n")).toEqual([
      lineOf("@pet1 hello"),
      lineOf("@pet1 scan"),
    ]);
    expect(feed("@pet1 hello")).toEqual([]);
    expect(feed("\n")).toEqual([lineOf("")]);
  });

  it("puts a line back together from chunks of any size", () => {
    const stream = bytes("@pet1 hello\n[pet] log\n@pet1 scan-done 3\n");
    for (let cut = 0; cut <= stream.length; cut += 1) {
      const splitter = createPetUsbLineSplitter();
      const got = [
        ...splitter.push(stream.subarray(0, cut)),
        ...splitter.push(stream.subarray(cut)),
      ];
      expect(got, `cut at ${cut}`).toEqual([
        lineOf("@pet1 hello"),
        lineOf("[pet] log"),
        lineOf("@pet1 scan-done 3"),
      ]);
    }
    const splitter = createPetUsbLineSplitter();
    const oneByOne = [...stream].flatMap((byte) =>
      splitter.push(Uint8Array.of(byte)),
    );
    expect(oneByOne).toHaveLength(3);
  });

  it("drops a carriage return before the newline", () => {
    expect(feed("@pet1 hello\r\n")).toEqual([lineOf("@pet1 hello")]);
  });

  it("keeps bytes that are not ASCII as single characters", () => {
    const got = createPetUsbLineSplitter().push(
      Uint8Array.of(0xff, 0xc3, 0xa9, 0x0a),
    );
    expect(got).toEqual([lineOf("ÿÃ©")]);
  });

  it("takes a string chunk as its UTF-8 bytes", () => {
    expect(createPetUsbLineSplitter().push("@pet1 hello\n")).toEqual([
      lineOf("@pet1 hello"),
    ]);
    expect(createPetUsbLineSplitter().push("é\n")).toEqual([lineOf("Ã©")]);
  });

  it("allows 512 bytes before the newline and discards a line of 513", () => {
    const edge = `${P}${"a".repeat(506)}`;
    expect(edge).toHaveLength(512);
    expect(feed(`${edge}\n`)).toEqual([lineOf(edge)]);
    expect(feed(`${edge}a\n`)).toEqual([{ kind: "overflow", prefixed: true }]);
    expect(feed(`${"x".repeat(513)}\n`)).toEqual([
      { kind: "overflow", prefixed: false },
    ]);
  });

  it("throws the rest of a long line away across chunks, then carries on", () => {
    const splitter = createPetUsbLineSplitter();
    expect(splitter.push(bytes(`${P}${"a".repeat(600)}`))).toEqual([]);
    expect(splitter.push(bytes("b".repeat(5000)))).toEqual([]);
    expect(splitter.push(bytes("bbb\n@pet1 hello\n"))).toEqual([
      { kind: "overflow", prefixed: true },
      lineOf("@pet1 hello"),
    ]);
  });

  it("holds no more than one line however much arrives", () => {
    const splitter = createPetUsbLineSplitter();
    expect(splitter.push(new Uint8Array(2_000_000).fill(0x61))).toEqual([]);
    expect(splitter.push(Uint8Array.of(0x0a))).toEqual([
      { kind: "overflow", prefixed: false },
    ]);
    expect(splitter.push(bytes("@pet1 hello\n"))).toEqual([
      lineOf("@pet1 hello"),
    ]);
  });

  it("forgets a half line on reset", () => {
    const splitter = createPetUsbLineSplitter();
    splitter.push(bytes("@pet1 hel"));
    splitter.reset();
    expect(splitter.push(bytes("@pet1 scan\n"))).toEqual([
      lineOf("@pet1 scan"),
    ]);
    splitter.push(bytes("a".repeat(600)));
    splitter.reset();
    expect(splitter.push(bytes("@pet1 scan\n"))).toEqual([
      lineOf("@pet1 scan"),
    ]);
  });
});

describe("petUsbWire", () => {
  it("writes the line and a newline", () => {
    expect([...petUsbWire(`${P}hello`)]).toEqual([...bytes(`${P}hello\n`)]);
  });

  it("refuses a line that the pet would discard or ignore", () => {
    expect(() => petUsbWire("hello")).toThrow(PetUsbFormatError);
    expect(() => petUsbWire(`${P}${"a".repeat(507)}`)).toThrow(
      PetUsbFormatError,
    );
    expect(() => petUsbWire(`${P}hel\u0001lo`)).toThrow(PetUsbFormatError);
    expect(() => petUsbWire(`${P}héllo`)).toThrow(PetUsbFormatError);
    expect(petUsbWire(`${P}${"a".repeat(506)}`)).toHaveLength(513);
  });
});

describe("a whole setup, page and pet", () => {
  it("runs from hello to done through the splitter on both sides", () => {
    const page = createPetUsbLineSplitter();
    const pet = createPetUsbLineSplitter();

    // The page greets, then asks for a scan.
    const toPet = [
      ...pet.push(petUsbWire(encodePetUsbRequest({ op: "hello" }))),
      ...pet.push(petUsbWire(encodePetUsbRequest({ op: "scan" }))),
    ];
    expect(
      toPet.map((s) =>
        s.kind === "line" ? parsePetUsbRequest(s.line).outcome : "x",
      ),
    ).toEqual(["ok", "ok"]);

    // The pet answers, with a log line in between that the page drops.
    const replies: PetUsbReply[] = [
      {
        type: "hello",
        version: 1,
        kind: "alien",
        firmware: "0.1.0",
        paired: false,
        setupOpen: true,
      },
      { type: "net", ssid: bytes("Home Wi-Fi"), rssi: -42, locked: true },
      { type: "scan-done", count: 1 },
    ];
    const wire = [
      ...replies.slice(0, 1).map((r) => petUsbWire(encodePetUsbReply(r))),
      bytes("[pet] scanning\n"),
      ...replies.slice(1).map((r) => petUsbWire(encodePetUsbReply(r))),
    ];
    const seen = wire.flatMap((chunk) => page.push(chunk));
    const decoded = seen.flatMap((s) => {
      const reply = s.kind === "line" ? decodePetUsbReply(s.line) : null;
      return reply === null ? [] : [reply];
    });
    expect(decoded).toEqual(replies);

    // The page joins; the pet reads exactly what was typed.
    const network = decoded[1];
    const join = encodePetUsbRequest({
      op: "join",
      ssid: network?.type === "net" ? network.ssid : "",
      password: "correct horse",
      setupCode: "K7QXM-2PA9T",
    });
    const heard = pet.push(petUsbWire(join));
    const first = heard[0];
    expect(first?.kind).toBe("line");
    const parsed =
      first?.kind === "line" ? parsePetUsbRequest(first.line) : null;
    expect(parsed).toMatchObject({
      outcome: "ok",
      request: { op: "join", password: "correct horse", setupCode: CODE },
    });
  });
});

describe("the pet never echoes a secret", () => {
  const PASSWORD = "hunter2hunter2";
  const CONFIRM = "ABCD-EFGH";
  const SECRETS = [
    PASSWORD,
    petUsbToHex(bytes(PASSWORD)),
    CODE,
    "K7QXM-2PA9T",
    CONFIRM,
    "ABCDEFGH",
  ];

  /** Every reply the fixed words and numbers can make, and some network names. */
  function everyReply(): PetUsbReply[] {
    const replies: PetUsbReply[] = [];
    for (const kind of PET_KINDS) {
      for (const paired of [true, false]) {
        for (const setupOpen of [true, false]) {
          replies.push({
            type: "hello",
            version: 1,
            kind,
            firmware: "0.1.0",
            paired,
            setupOpen,
          });
        }
      }
    }
    for (const ssid of ["Home Wi-Fi", "Cafe Guest", "s".repeat(32)]) {
      for (const locked of [true, false]) {
        replies.push({ type: "net", ssid: bytes(ssid), rssi: -50, locked });
      }
    }
    for (let count = 0; count <= PET_USB_MAX_NETWORKS; count += 1) {
      replies.push({ type: "scan-done", count });
    }
    for (const state of PET_USB_STATES) {
      if (state === "error") {
        for (const error of PET_USB_ERRORS) {
          replies.push({ type: "state", state, error });
        }
      } else {
        replies.push({ type: "state", state });
      }
    }
    for (const reason of PET_USB_REFUSALS) {
      replies.push({ type: "refused", reason });
    }
    return replies;
  }

  it("builds only replies that fit the grammar, with no secret in them", () => {
    const grammar =
      /^@pet1 (?:hello [1-9] (?:astronaut|alien|cat) \d+\.\d+\.\d+ (?:paired|unpaired) (?:open|closed)|net [0-9a-f]{2,64} (?:0|-[1-9][0-9]{0,2}) (?:open|locked)|scan-done (?:0|[1-9][0-9]?)|state (?:joining|pairing|confirm|done|error (?:wifi_failed|code_refused|unreachable|timed_out|save_failed))|refused (?:paired|busy|bad_line|unknown_op|rate_limited|bad_value))$/;
    for (const reply of everyReply()) {
      const line = encodePetUsbReply(reply);
      expect(line, line).toMatch(grammar);
      for (const secret of SECRETS) {
        expect(line, `${line} / ${secret}`).not.toContain(secret);
      }
      // A confirm code or a setup code has no lower case, but a reply word has no
      // upper case run of four, so nothing code-like fits in a fixed slot.
      if (!line.startsWith(`${P}net`)) {
        expect(line).not.toMatch(/[A-Z2-9]{4}-?[A-Z2-9]{4}/);
      }
    }
  });

  it("refuses to put a secret in a slot meant for a fixed word", () => {
    const cast = (reply: unknown): PetUsbReply => reply as PetUsbReply;
    for (const secret of [PASSWORD, CODE, CONFIRM]) {
      for (const reply of [
        { type: "state", state: "error", error: secret },
        { type: "state", state: secret },
        { type: "refused", reason: secret },
        {
          type: "hello",
          version: 1,
          kind: secret,
          firmware: "0.1.0",
          paired: false,
          setupOpen: true,
        },
        {
          type: "hello",
          version: 1,
          kind: "cat",
          firmware: secret,
          paired: false,
          setupOpen: true,
        },
        { type: "scan-done", count: secret },
        { type: "net", ssid: bytes("Home"), rssi: secret, locked: true },
      ]) {
        expect(
          () => encodePetUsbReply(cast(reply)),
          JSON.stringify(reply),
        ).toThrow(PetUsbFormatError);
      }
    }
  });

  it("says only 'listen to your pet' at confirm, whatever the caller passes", () => {
    const line = encodePetUsbReply({
      type: "state",
      state: "confirm",
      // @ts-expect-error a state reply has no field for the confirm code
      code: CONFIRM,
    });
    expect(line).toBe(`${P}state confirm`);
    expect(() =>
      encodePetUsbReply({
        type: "state",
        state: "error",
        // @ts-expect-error only a code from the list fits here
        error: PASSWORD,
      }),
    ).toThrow(PetUsbFormatError);
    expect(() =>
      encodePetUsbReply({
        type: "refused",
        // @ts-expect-error only a reason from the list fits here
        reason: CODE,
      }),
    ).toThrow(PetUsbFormatError);
  });

  it("decodes nothing from a line that carries a secret in a fixed slot", () => {
    for (const secret of [PASSWORD, CODE, "K7QXM-2PA9T", CONFIRM]) {
      for (const line of [
        `state confirm ${secret}`,
        `state error ${secret}`,
        `state ${secret}`,
        `refused ${secret}`,
        `scan-done ${secret}`,
        `hello 1 cat ${secret} paired open`,
        `hello 1 ${secret} 0.1.0 paired open`,
        `net 486f6d65 ${secret} locked`,
      ]) {
        expect(decodePetUsbReply(P + line), line).toBeNull();
      }
    }
  });

  it("decodes the vectors into values that hold no secret", () => {
    const text = JSON.stringify(
      PET_USB_REPLY_VECTORS.map((v) => decodePetUsbReply(v.line)),
    );
    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
    }
  });

  it("has no password, setup code, confirm code, token or id in the reply half of the source", () => {
    const source = readFileSync(join(import.meta.dirname, "usb.ts"), "utf8");
    const from = source.indexOf("// -- Pet to page");
    const to = source.indexOf("// -- The wire");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const half = source
      .slice(from, to)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(half).not.toMatch(
      /password|setupCode|confirmCode|\btoken\b|secret|deviceId|requestId|passphrase/i,
    );
  });
});

describe("pet-usb v2", () => {
  const FP = "a1b2c3d4e5f60718".repeat(4);
  const NAME = "osf-3fa91c0d.local";
  const server = {
    op: "server",
    address: "192.168.1.20",
    port: 4801,
    fingerprint: FP,
    name: NAME,
  } as const;

  it("keeps v1 as it was: the prefix, the ops and the refusals", () => {
    expect(PET_USB_VERSION).toBe(1);
    expect(PET_USB_PREFIX).toBe("@pet1 ");
    expect(PET_USB_OPS).toEqual(["hello", "scan", "join", "status", "cancel"]);
    expect(PET_USB2_VERSION).toBe(2);
    expect(PET_USB2_OPS).toEqual(["server", "wifi", "start"]);
    expect(PET_USB2_REFUSALS).toEqual([...PET_USB_REFUSALS, "not_ready"]);
  });

  it("tells a v1 pet from a v2 one by its hello", () => {
    expect(petUsbSpeaksV2({ version: 1 })).toBe(false);
    expect(petUsbSpeaksV2({ version: 2 })).toBe(true);
    expect(petUsbSpeaksV2({ version: 3 })).toBe(true);
  });

  it("reads every golden request vector", () => {
    for (const vector of PET_USB2_REQUEST_VECTORS) {
      const state = {
        paired: vector.paired === true,
        busy: vector.busy === true,
        hasServer: vector.hasServer === true,
        hasWifi: vector.hasWifi === true,
      };
      const got = parsePetUsb2Request(vector.line, state);
      const { expect: want } = vector;
      if (want.outcome === "ignored") {
        expect(got, vector.name).toEqual({ outcome: "ignored" });
      } else if (want.outcome === "refused") {
        expect(got, vector.name).toEqual({
          outcome: "refused",
          reason: want.reason,
        });
      } else if (want.op === "server") {
        expect(got, vector.name).toEqual({
          outcome: "ok",
          request: {
            op: "server",
            address: want.address === "" ? null : want.address,
            port: want.port,
            fingerprint: want.fingerprint,
            name: want.serverName,
          },
        });
      } else if (want.op === "wifi") {
        expect(got, vector.name).toEqual({
          outcome: "ok",
          request: {
            op: "wifi",
            ssid: Uint8Array.from(want.ssid),
            password: want.password,
          },
        });
      } else if (want.op === "start") {
        expect(got, vector.name).toEqual({
          outcome: "ok",
          request: { op: "start", setupCode: want.setupCode },
        });
      } else {
        expect(got, vector.name).toEqual({
          outcome: "ok",
          request: { op: want.op },
        });
      }
    }
  });

  it("builds and reads every golden reply vector", () => {
    for (const vector of PET_USB2_REPLY_VECTORS) {
      expect(encodePetUsb2Reply(vector.reply), vector.name).toBe(vector.line);
      expect(decodePetUsb2Reply(vector.line), vector.name).toEqual(
        vector.reply,
      );
    }
  });

  it("round trips what the page encodes through what the pet parses", () => {
    const ready = {
      paired: false,
      busy: false,
      hasServer: true,
      hasWifi: true,
    };
    const wifi = {
      op: "wifi",
      ssid: "Home Wi-Fi",
      password: "correct horse",
    } as const;
    expect(parsePetUsb2Request(encodePetUsb2Request(server), ready)).toEqual({
      outcome: "ok",
      request: {
        op: "server",
        address: "192.168.1.20",
        port: 4801,
        fingerprint: FP,
        name: NAME,
      },
    });
    expect(
      parsePetUsb2Request(
        encodePetUsb2Request({ ...server, address: null }),
        ready,
      ),
    ).toMatchObject({ request: { address: null } });
    expect(parsePetUsb2Request(encodePetUsb2Request(wifi), ready)).toEqual({
      outcome: "ok",
      request: {
        op: "wifi",
        ssid: new TextEncoder().encode("Home Wi-Fi"),
        password: "correct horse",
      },
    });
    expect(
      parsePetUsb2Request(
        encodePetUsb2Request({ op: "wifi", ssid: "Cafe", password: "" }),
        ready,
      ),
    ).toMatchObject({ request: { password: "" } });
    expect(
      parsePetUsb2Request(
        encodePetUsb2Request({ op: "start", setupCode: "K7QXM-2PA9T" }),
        ready,
      ),
    ).toEqual({
      outcome: "ok",
      request: { op: "start", setupCode: "K7QXM2PA9T" },
    });
  });

  it("writes the exact bytes the firmware will read", () => {
    expect(encodePetUsb2Request(server)).toBe(
      `@pet1 server 192.168.1.20 4801 ${FP} ${NAME}`,
    );
    expect(encodePetUsb2Request({ ...server, address: null, port: 1 })).toBe(
      `@pet1 server - 1 ${FP} ${NAME}`,
    );
    expect(
      encodePetUsb2Request({
        op: "wifi",
        ssid: "Home Wi-Fi",
        password: "correct horse",
      }),
    ).toBe(`@pet1 wifi ${HOME_HEX} ${CORRECT_HORSE_HEX}`);
    expect(
      encodePetUsb2Request({ op: "wifi", ssid: "Cafe Guest", password: "" }),
    ).toBe(`@pet1 wifi ${petUsbToHex(bytes("Cafe Guest"))} -`);
    expect(
      encodePetUsb2Request({ op: "start", setupCode: "k7qxm-2pa9t" }),
    ).toBe("@pet1 start K7QXM2PA9T");
    expect(encodePetUsb2Request({ op: "hello" })).toBe("@pet1 hello");
  });

  it("refuses to encode a value the pet would refuse, naming the field only", () => {
    const bad = (input: Parameters<typeof encodePetUsb2Request>[0]) => {
      try {
        encodePetUsb2Request(input);
      } catch (e) {
        return e as PetUsbFormatError;
      }
      throw new Error("did not throw");
    };
    expect(bad({ ...server, port: 0 }).field).toBe("server");
    expect(bad({ ...server, address: "192.168.1" }).field).toBe("server");
    expect(bad({ ...server, fingerprint: FP.toUpperCase() }).field).toBe(
      "server",
    );
    expect(bad({ ...server, name: "pet.local" }).field).toBe("server");
    const short = bad({ op: "wifi", ssid: "Home", password: "hunter2" });
    expect(short.field).toBe("password");
    expect(short.message).not.toContain("hunter2");
    expect(bad({ op: "wifi", ssid: "", password: "" }).field).toBe("ssid");
    expect(bad({ op: "start", setupCode: "nope" }).field).toBe("setupCode");
  });

  it("keeps every request line within the pet's line limit", () => {
    const longest = encodePetUsb2Request({
      op: "wifi",
      ssid: new Uint8Array(32).fill(0x41),
      password: "p".repeat(63),
    });
    expect(longest.length).toBeLessThanOrEqual(PET_USB_MAX_LINE);
    expect(encodePetUsb2Request(server).length).toBeLessThanOrEqual(
      PET_USB_MAX_LINE,
    );
  });

  it("never lets a reply carry a password, a code or a token", () => {
    for (const vector of PET_USB2_REPLY_VECTORS) {
      expect(vector.line).not.toMatch(/[0-9a-f]{20,}/);
    }
    expect(() =>
      encodePetUsb2Reply({ type: "ok", op: "join" } as never),
    ).toThrow(PetUsbFormatError);
    expect(decodePetUsb2Reply("@pet1 ok start K7QXM2PA9T")).toBeNull();
    expect(decodePetUsb2Reply("@pet1 refused not_ready extra")).toBeNull();
  });

  it("is read as v1 reads a v1 line, and a v1 reader drops what is new", () => {
    for (const vector of PET_USB_REQUEST_VECTORS) {
      expect(
        parsePetUsb2Request(vector.line, {
          paired: vector.paired === true,
          busy: vector.busy === true,
          hasServer: false,
          hasWifi: false,
        }),
        vector.name,
      ).toEqual(
        parsePetUsbRequest(vector.line, {
          paired: vector.paired === true,
          busy: vector.busy === true,
        }),
      );
    }
    for (const vector of PET_USB_REPLY_VECTORS) {
      expect(decodePetUsb2Reply(`${P}${vector.line.slice(P.length)}`)).toEqual(
        decodePetUsbReply(vector.line),
      );
    }
    // A v1 pet's reader ignores the new replies: they are not in its lists.
    expect(decodePetUsbReply("@pet1 ok server")).toBeNull();
    expect(decodePetUsbReply("@pet1 refused not_ready")).toBeNull();
    // A v1 pet turns the new ops away without reading their values.
    expect(parsePetUsbRequest(encodePetUsb2Request(server))).toEqual({
      outcome: "refused",
      reason: "unknown_op",
    });
  });

  it("checks addresses strictly", () => {
    expect(isPetUsbIpv4("10.0.0.1")).toBe(true);
    expect(isPetUsbIpv4("10.0.0.256")).toBe(false);
    expect(isPetUsbIpv4("10.0.00.1")).toBe(false);
    expect(isPetUsbIpv6("fd00::1")).toBe(true);
    expect(isPetUsbIpv6("::1")).toBe(true);
    expect(isPetUsbIpv6("fd00::1::2")).toBe(false);
    expect(isPetUsbIpv6("fd00:1")).toBe(false);
    expect(isPetUsbIpv6("::ffff:10.0.0.1")).toBe(false);
    expect(isPetUsbIpv6("fd00::g")).toBe(false);
    expect(isPetUsbIpv6("1:2:3:4:5:6:7:8:9")).toBe(false);
  });
});
