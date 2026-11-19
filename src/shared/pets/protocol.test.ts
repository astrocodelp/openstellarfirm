import { describe, expect, it } from "vitest";
import { PET_LINES } from "./lines";
import {
  isHhMm,
  isQuietNow,
  isValidTimeZone,
  NOTICE_KINDS,
  type ParseResult,
  PET_AUDIO_DOWN_CONTENT_TYPE,
  PET_ERRORS,
  PET_HARDWARE_ID,
  PET_HEADERS,
  PET_STATES,
  parseClaimRequest,
  parseClaimResponse,
  parseClaimWaiting,
  parseHeartbeatRequest,
  parseHeartbeatResponse,
  parseInboxResponse,
  parseNotice,
  parsePairRequest,
  parsePairResponse,
  parsePetErrorBody,
  parsePetName,
  parsePetSettings,
  parseTurnAlreadyReceived,
  parseTurnSaved,
  petError,
  SAVED_NOTES_POLICIES,
} from "./protocol";

/** The value of a parse that must have worked. */
function value<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

const KEY = "A".repeat(43);
const ID = "B".repeat(22);
const NOW = "2026-10-21T14:02:00Z";

const settings = {
  paused: false,
  quietHours: { from: "22:00", to: "08:00", tz: "Europe/Athens" },
  speakNotices: true,
  volume: 0.6,
  voice: "talia",
  savedNotes: "send",
};

describe("constants", () => {
  it("names the headers of the contract", () => {
    expect(PET_HEADERS).toEqual({
      turn: "X-Pet-Turn",
      recordedAt: "X-Pet-Recorded-At",
      offline: "X-Pet-Offline",
      state: "X-Pet-State",
      chat: "X-Pet-Chat",
      run: "X-Pet-Run",
      line: "X-Pet-Line",
    });
  });

  it("lists the states, the notice kinds and the saved notes policies", () => {
    expect([...PET_STATES]).toEqual([
      "answered",
      "working",
      "needs-approve",
      "refused",
    ]);
    expect([...NOTICE_KINDS]).toEqual([
      "done",
      "approval",
      "stopped",
      "budget",
      "message",
      "settings",
    ]);
    expect([...SAVED_NOTES_POLICIES]).toEqual(["send", "draft"]);
  });

  it("labels the answer's audio as the contract does", () => {
    expect(PET_AUDIO_DOWN_CONTENT_TYPE).toBe("audio/L16;rate=22050");
    expect(PET_HARDWARE_ID).toBe("nano-esp32-v1");
  });
});

describe("PET_ERRORS and petError", () => {
  it("matches the contract's table, row by row", () => {
    const table: [string, number, string, string][] = [
      ["bad_request", 400, "bad_request", "busy"],
      ["bad_code", 400, "bad_code", "setup-refused"],
      ["forgotten", 401, "forgotten", "disconnected"],
      ["no_access", 401, "no_access", "no-access"],
      ["out_of_credits", 402, "out_of_credits", "out-of-credits"],
      ["spending_limit", 402, "spending_limit", "spending-limit"],
      ["off", 404, "off", "disconnected"],
      ["notice_gone", 404, "gone", "busy"],
      ["paused", 409, "paused", "paused"],
      ["gone", 410, "gone", "setup-refused"],
      ["too_long", 413, "too_long", "didnt-catch"],
      ["bad_audio", 415, "bad_audio", "didnt-catch"],
      ["heard_nothing", 422, "heard_nothing", "didnt-catch"],
      ["too_many", 429, "too_many", "busy"],
      ["voice_off", 503, "voice_off", "busy"],
      ["store_off", 503, "store_off", "busy"],
    ];
    expect(Object.keys(PET_ERRORS).sort()).toEqual(
      table.map(([key]) => key).sort(),
    );
    for (const [key, status, error, line] of table) {
      const entry = PET_ERRORS[key as keyof typeof PET_ERRORS];
      expect(entry, key).toEqual({ error, status, line });
    }
  });

  it("only ever names a line the voice pack has", () => {
    const ids = new Set<string>(PET_LINES.map((line) => line.id));
    for (const entry of Object.values(PET_ERRORS)) {
      expect(ids.has(entry.line), entry.line).toBe(true);
    }
  });

  it("gives the wire name gone to both 404 and 410", () => {
    expect(petError("gone")).toEqual({
      status: 410,
      body: { error: "gone", line: "setup-refused" },
    });
    expect(petError("notice_gone")).toEqual({
      status: 404,
      body: { error: "gone", line: "busy" },
    });
  });

  it("builds a body the error schema reads back", () => {
    for (const code of Object.keys(PET_ERRORS) as (keyof typeof PET_ERRORS)[]) {
      expect(parsePetErrorBody(petError(code).body).ok, code).toBe(true);
    }
    expect(parsePetErrorBody({ error: "nope", line: "busy" }).ok).toBe(false);
    expect(
      parsePetErrorBody({ error: "paused", line: "no-such-line" }).ok,
    ).toBe(false);
  });
});

describe("time", () => {
  it("reads HH:MM", () => {
    for (const ok of ["00:00", "08:30", "23:59"]) {
      expect(isHhMm(ok), ok).toBe(true);
    }
    for (const bad of ["24:00", "8:30", "12:60", "12:5", "1230", "", "ab:cd"]) {
      expect(isHhMm(bad), bad).toBe(false);
    }
    expect(isHhMm(830)).toBe(false);
  });

  it("knows IANA zones", () => {
    expect(isValidTimeZone("Europe/Athens")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("isQuietNow", () => {
  const night = { from: "22:00", to: "08:00", tz: "UTC" };
  const day = { from: "09:00", to: "17:00", tz: "UTC" };
  const at = (iso: string): Date => new Date(iso);

  it("is never quiet without quiet hours", () => {
    expect(isQuietNow(null, at("2026-10-21T03:00:00Z"))).toBe(false);
    expect(isQuietNow(undefined, at("2026-10-21T03:00:00Z"))).toBe(false);
  });

  it("covers [from, to) inside one day", () => {
    expect(isQuietNow(day, at("2026-10-21T08:59:00Z"))).toBe(false);
    expect(isQuietNow(day, at("2026-10-21T09:00:00Z"))).toBe(true);
    expect(isQuietNow(day, at("2026-10-21T16:59:00Z"))).toBe(true);
    expect(isQuietNow(day, at("2026-10-21T17:00:00Z"))).toBe(false);
  });

  it("wraps midnight", () => {
    expect(isQuietNow(night, at("2026-10-21T21:59:00Z"))).toBe(false);
    expect(isQuietNow(night, at("2026-10-21T22:00:00Z"))).toBe(true);
    expect(isQuietNow(night, at("2026-10-21T23:59:00Z"))).toBe(true);
    expect(isQuietNow(night, at("2026-10-22T00:00:00Z"))).toBe(true);
    expect(isQuietNow(night, at("2026-10-22T07:59:00Z"))).toBe(true);
    expect(isQuietNow(night, at("2026-10-22T08:00:00Z"))).toBe(false);
    expect(isQuietNow(night, at("2026-10-22T12:00:00Z"))).toBe(false);
  });

  it("reads the time in the window's own zone", () => {
    // Athens is UTC+3 in October (summer time ends on the 25th).
    const athens = { from: "22:00", to: "08:00", tz: "Europe/Athens" };
    expect(isQuietNow(athens, at("2026-10-21T18:59:00Z"))).toBe(false); // 21:59
    expect(isQuietNow(athens, at("2026-10-21T19:00:00Z"))).toBe(true); // 22:00
    expect(isQuietNow(athens, at("2026-10-22T04:59:00Z"))).toBe(true); // 07:59
    expect(isQuietNow(athens, at("2026-10-22T05:00:00Z"))).toBe(false); // 08:00
    // New York is UTC-4 then.
    const york = { from: "22:00", to: "08:00", tz: "America/New_York" };
    expect(isQuietNow(york, at("2026-10-22T01:59:00Z"))).toBe(false); // 21:59
    expect(isQuietNow(york, at("2026-10-22T02:00:00Z"))).toBe(true); // 22:00
  });

  it("follows the zone through a change of summer time", () => {
    const athens = { from: "22:00", to: "08:00", tz: "Europe/Athens" };
    // After 25 October 2026 Athens is UTC+2.
    expect(isQuietNow(athens, at("2026-10-26T19:59:00Z"))).toBe(false); // 21:59
    expect(isQuietNow(athens, at("2026-10-26T20:00:00Z"))).toBe(true); // 22:00
  });

  it("treats an empty window and an unknown zone as not quiet", () => {
    expect(
      isQuietNow(
        { from: "10:00", to: "10:00", tz: "UTC" },
        at("2026-10-21T10:00:00Z"),
      ),
    ).toBe(false);
    expect(
      isQuietNow(
        { from: "00:00", to: "23:59", tz: "Mars/Olympus" },
        at("2026-10-21T10:00:00Z"),
      ),
    ).toBe(false);
    expect(isQuietNow(night, new Date(Number.NaN))).toBe(false);
  });

  it("does not read midnight as hour 24", () => {
    expect(
      isQuietNow(
        { from: "00:00", to: "00:30", tz: "UTC" },
        at("2026-10-21T00:10:00Z"),
      ),
    ).toBe(true);
  });
});

describe("pet names", () => {
  it("accepts letters, spaces, apostrophes and hyphens", () => {
    for (const name of [
      "Nova",
      "Comet",
      "Mary-Jane",
      "O'Neil",
      "Zo\u00EB",
      "Sky Pup",
    ]) {
      expect(parsePetName(name).ok, name).toBe(true);
    }
  });

  it("trims the name", () => {
    expect(value(parsePetName("  Nova  "))).toBe("Nova");
  });

  it("refuses digits, a leading mark, symbols, an empty name and a long one", () => {
    for (const name of [
      "Nova2",
      "2Nova",
      "-Nova",
      "'Nova",
      "No_va",
      "Nova!",
      "",
      "   ",
    ]) {
      expect(parsePetName(name).ok, name).toBe(false);
    }
    expect(parsePetName("a".repeat(40)).ok).toBe(true);
    expect(parsePetName("a".repeat(41)).ok).toBe(false);
  });
});

describe("settings", () => {
  it("reads the contract's example", () => {
    expect(value(parsePetSettings(settings))).toEqual(settings);
    expect(parsePetSettings({ ...settings, quietHours: null }).ok).toBe(true);
  });

  it("refuses a bad volume, voice, policy or quiet window", () => {
    for (const patch of [
      { volume: 1.1 },
      { volume: -0.1 },
      { voice: "robot" },
      { savedNotes: "keep" },
      { quietHours: { from: "25:00", to: "08:00", tz: "UTC" } },
      { quietHours: { from: "22:00", to: "08:00", tz: "Nowhere/Land" } },
      { paused: "no" },
    ]) {
      expect(parsePetSettings({ ...settings, ...patch }).ok).toBe(false);
    }
  });
});

describe("pairing bodies", () => {
  const pair = {
    setupCode: "K7QXM-2PA9T",
    kind: "astronaut",
    hardware: "nano-esp32-v1",
    firmware: "0.1.0",
    deviceKey: KEY,
  };

  it("reads a pair request", () => {
    expect(value(parsePairRequest(pair))).toEqual(pair);
    expect(parsePairRequest({ ...pair, firmware: "1.2.3-rc.1" }).ok).toBe(true);
  });

  it("leaves a mistyped setup code to the server, which answers bad_code", () => {
    expect(parsePairRequest({ ...pair, setupCode: "nonsense" }).ok).toBe(true);
    expect(parsePairRequest({ ...pair, setupCode: "" }).ok).toBe(false);
    expect(parsePairRequest({ ...pair, setupCode: "x".repeat(33) }).ok).toBe(
      false,
    );
  });

  it("refuses a malformed pair request", () => {
    for (const patch of [
      { kind: "dog" },
      { hardware: "" },
      { hardware: "h".repeat(41) },
      { firmware: "v1" },
      { firmware: "1.0.0-".padEnd(21, "x") },
      { deviceKey: "short" },
      { deviceKey: `${"A".repeat(42)}=` },
    ]) {
      expect(parsePairRequest({ ...pair, ...patch }).ok).toBe(false);
    }
  });

  it("reads a pair response", () => {
    const body = {
      requestId: ID,
      confirmCode: "ABCD-EFGH",
      approveUrl: "https://192.168.1.20:8443/pets/approve?request=abc",
      expiresAt: "2026-10-21T14:12:00.000Z",
    };
    expect(value(parsePairResponse(body))).toEqual(body);
    expect(parsePairResponse({ ...body, confirmCode: "ABCDEFGH" }).ok).toBe(
      false,
    );
    expect(parsePairResponse({ ...body, confirmCode: "ABCD-EFG1" }).ok).toBe(
      false,
    );
    expect(parsePairResponse({ ...body, requestId: "short" }).ok).toBe(false);
    expect(
      parsePairResponse({
        ...body,
        approveUrl: "javascript:alert(1)",
      }).ok,
    ).toBe(false);
    expect(parsePairResponse({ ...body, expiresAt: "tomorrow" }).ok).toBe(
      false,
    );
  });

  it("reads a claim and its answers", () => {
    expect(parseClaimRequest({ requestId: ID, deviceSecret: KEY }).ok).toBe(
      true,
    );
    expect(parseClaimRequest({ requestId: ID, deviceSecret: "x" }).ok).toBe(
      false,
    );
    expect(value(parseClaimWaiting({ status: "waiting" }))).toEqual({
      status: "waiting",
    });
    const claimed = {
      deviceId: "dev_1",
      token: KEY,
      pet: { kind: "alien", name: "Zib", voice: "darian" },
      settings,
    };
    expect(value(parseClaimResponse(claimed))).toEqual(claimed);
    expect(
      parseClaimResponse({
        ...claimed,
        pet: { ...claimed.pet, name: "Zib 2" },
      }).ok,
    ).toBe(false);
  });
});

describe("heartbeat and inbox bodies", () => {
  const beat = {
    battery: 0.82,
    charging: true,
    rssi: -58,
    firmware: "0.1.0",
    queue: 2,
    skin: "astronaut",
    uptime: 3600,
  };

  it("reads a heartbeat", () => {
    expect(value(parseHeartbeatRequest(beat))).toEqual(beat);
    expect(parseHeartbeatRequest({ ...beat, skin: "none" }).ok).toBe(true);
  });

  it("refuses a heartbeat out of range", () => {
    for (const patch of [
      { battery: 1.2 },
      { rssi: 3 },
      { rssi: -58.5 },
      { queue: 51 },
      { queue: -1 },
      { skin: "dog" },
      { uptime: -1 },
      { uptime: 1.5 },
    ]) {
      expect(parseHeartbeatRequest({ ...beat, ...patch }).ok).toBe(false);
    }
  });

  it("reads the heartbeat answer", () => {
    expect(value(parseHeartbeatResponse({ settings, quiet: false }))).toEqual({
      settings,
      quiet: false,
    });
  });

  it("reads a notice with and without the optional parts", () => {
    const minimal = { seq: 1, kind: "message", at: NOW, line: "Hi!" };
    expect(value(parseNotice(minimal))).toEqual(minimal);
    const full = {
      seq: 12,
      kind: "done",
      at: NOW,
      line: "Your bakery landing page is ready. Open OpenStellarFirm to see it.",
      title: "bakery landing page",
      role: "developer",
      chat: "chat1",
      run: "run1",
    };
    expect(value(parseNotice(full))).toEqual(full);
    expect(
      parseNotice({ seq: 1, kind: "settings", at: NOW, line: "" }).ok,
    ).toBe(true);
  });

  it("refuses a bad notice", () => {
    const base = { seq: 1, kind: "done", at: NOW, line: "x" };
    for (const patch of [
      { seq: 0 },
      { seq: 1.5 },
      { kind: "alarm" },
      { at: "yesterday" },
      { role: "Developer" },
      { role: "" },
    ]) {
      expect(parseNotice({ ...base, ...patch }).ok).toBe(false);
    }
  });

  it("reads an inbox answer and holds it to fifty notices", () => {
    const notice = {
      seq: 3,
      kind: "approval",
      at: NOW,
      line: "x",
      role: "legal",
    };
    expect(
      value(parseInboxResponse({ notices: [notice], next: 3, quiet: false }))
        .next,
    ).toBe(3);
    expect(parseInboxResponse({ notices: [], next: 0, quiet: true }).ok).toBe(
      true,
    );
    const many = Array.from({ length: 51 }, (_, i) => ({
      ...notice,
      seq: i + 1,
    }));
    expect(
      parseInboxResponse({ notices: many, next: 51, quiet: false }).ok,
    ).toBe(false);
  });
});

describe("turn answers", () => {
  it("reads a saved note's answer", () => {
    expect(
      value(parseTurnSaved({ status: "sent", chat: "c1", run: "r1" })),
    ).toEqual({
      status: "sent",
      chat: "c1",
      run: "r1",
    });
    expect(parseTurnSaved({ status: "draft", chat: "c1" }).ok).toBe(true);
    expect(parseTurnSaved({ status: "lost", chat: "c1" }).ok).toBe(false);
  });

  it("reads the answer to a saved note with nothing in it", () => {
    expect(value(parseTurnSaved({ status: "empty" }))).toEqual({
      status: "empty",
    });
    // A sent or drafted note always names its chat; an empty one has none.
    expect(parseTurnSaved({ status: "sent" }).ok).toBe(false);
    expect(parseTurnSaved({ status: "draft" }).ok).toBe(false);
  });

  it("reads the 208 answer", () => {
    expect(parseTurnAlreadyReceived({ status: "already-received" }).ok).toBe(
      true,
    );
    expect(parseTurnAlreadyReceived({ status: "ok" }).ok).toBe(false);
  });
});

describe("how a body is read", () => {
  it("answers a sentence that names the wrong field", () => {
    const failed = parsePairRequest({ kind: "dog" });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/^setupCode:/);
    }
    const wrongKind = parsePairRequest({
      setupCode: "K7QXM-2PA9T",
      kind: "dog",
      hardware: "x",
      firmware: "0.1.0",
      deviceKey: KEY,
    });
    expect(wrongKind).toEqual({
      ok: false,
      error: "kind: not one of the known values.",
    });
  });

  it("refuses anything that is not an object", () => {
    for (const body of [null, undefined, 7, "x", [], true]) {
      expect(parsePairRequest(body).ok).toBe(false);
      expect(parseNotice(body).ok).toBe(false);
      expect(parsePetSettings(body).ok).toBe(false);
    }
  });

  it("leaves out a field the protocol does not know", () => {
    const read = value(
      parseHeartbeatRequest({
        battery: 0.5,
        charging: false,
        rssi: -60,
        firmware: "0.1.0",
        queue: 0,
        skin: "cat",
        uptime: 5,
        token: "never kept",
      }),
    );
    expect(Object.keys(read).sort()).toEqual([
      "battery",
      "charging",
      "firmware",
      "queue",
      "rssi",
      "skin",
      "uptime",
    ]);
  });

  it("reads a notice's optional parts only when they are there", () => {
    const read = value(
      parseNotice({ seq: 2, kind: "done", at: NOW, line: "x", title: "t" }),
    );
    expect(read).toEqual({
      seq: 2,
      kind: "done",
      at: NOW,
      line: "x",
      title: "t",
    });
    expect(Object.hasOwn(read, "role")).toBe(false);
  });

  it("checks that a date is a real one", () => {
    for (const at of [
      "2026-02-30T10:00:00Z",
      "2026-13-01T10:00:00Z",
      "2026-10-21T24:00:00Z",
      "2026-10-21T10:00:00",
      "2026-10-21 10:00:00Z",
      "2026-10-21",
    ]) {
      expect(parseNotice({ seq: 1, kind: "done", at, line: "x" }).ok, at).toBe(
        false,
      );
    }
    for (const at of [
      "2026-10-21T10:00Z",
      "2026-10-21T10:00:00Z",
      "2026-10-21T10:00:00.123456Z",
      "2026-10-21T10:00:00+03:00",
      "2024-02-29T10:00:00Z",
    ]) {
      expect(parseNotice({ seq: 1, kind: "done", at, line: "x" }).ok, at).toBe(
        true,
      );
    }
  });

  it("does not take a number that is not finite", () => {
    for (const volume of [Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
      expect(parsePetSettings({ ...settings, volume }).ok).toBe(false);
    }
  });

  it("takes a http or https approve address only", () => {
    const body = {
      requestId: ID,
      confirmCode: "ABCD-EFGH",
      approveUrl: "https://192.168.1.20:8443/approve",
      expiresAt: NOW,
    };
    expect(parsePairResponse(body).ok).toBe(true);
    expect(
      parsePairResponse({ ...body, approveUrl: "http://a.example" }).ok,
    ).toBe(true);
    for (const approveUrl of [
      "ftp://a.example",
      "not a url",
      `https://a.example/${"x".repeat(520)}`,
    ]) {
      expect(parsePairResponse({ ...body, approveUrl }).ok, approveUrl).toBe(
        false,
      );
    }
  });
});
