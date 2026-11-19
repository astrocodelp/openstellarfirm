import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeskPetsStatus } from "../shared/desk-pets";
import {
  createPetUsbLineSplitter,
  encodePetUsb2Reply,
  type PetUsb2PolicyState,
  type PetUsb2Reply,
  parsePetUsb2Request,
} from "../shared/pets/usb";
import {
  connectProblem,
  FAILURE_TEXT,
  type PairInput,
  type PetLink,
  PetUsbSession,
  serverTarget,
} from "./src/pet-usb-driver";

const PASSWORD = "correct horse battery";
const SSID = "Home Wi-Fi";
const FP = "a1b2c3d4e5f60718".repeat(4);
const NAME = "osf-3fa91c0d.local";
const server = {
  address: "192.168.1.20",
  port: 4801,
  fingerprint: FP,
  name: NAME,
};

function hex(text: string): string {
  return Array.from(text, (c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
}

interface PetRig {
  link: PetLink;
  /** Every line the page wrote to the cable, without its newline. */
  written: string[];
  /** Plugs the cable out. */
  unplug(): void;
  /** What the pet says next, whatever the page asked. */
  say(reply: PetUsb2Reply): void;
}

/**
 * A pet on the other end of the cable, speaking by the codec's own rules: it
 * reads each line with `parsePetUsb2Request` and answers like firmware would.
 * `version` 1 makes it an old pet, which knows no v2 op.
 */
function petRig(
  options: {
    version?: number;
    paired?: boolean;
    silent?: boolean;
    after?: PetUsb2Reply[];
  } = {},
): PetRig {
  const version = options.version ?? 2;
  const splitter = createPetUsbLineSplitter();
  const written: string[] = [];
  const data = new Set<(chunk: Uint8Array) => void>();
  const closes = new Set<() => void>();
  const staged: { -readonly [K in keyof PetUsb2PolicyState]: boolean } = {
    paired: options.paired === true,
    busy: false,
    hasServer: false,
    hasWifi: false,
  };
  const say = (reply: PetUsb2Reply) => {
    const bytes = new TextEncoder().encode(`${encodePetUsb2Reply(reply)}\n`);
    queueMicrotask(() => {
      for (const listener of data) listener(bytes);
    });
  };
  const link: PetLink = {
    async write(bytes) {
      for (const piece of splitter.push(bytes)) {
        if (piece.kind !== "line") continue;
        written.push(piece.line);
        if (options.silent) continue;
        const parsed = parsePetUsb2Request(piece.line, staged);
        if (parsed.outcome === "refused") {
          say({ type: "refused", reason: parsed.reason });
        } else if (parsed.outcome === "ok") {
          const { request } = parsed;
          if (request.op === "hello") {
            say({
              type: "hello",
              version,
              kind: "astronaut",
              firmware: version >= 2 ? "0.2.0" : "0.1.0",
              paired: staged.paired,
              setupOpen: false,
            });
          } else if (version < 2 && request.op !== "cancel") {
            // An old pet never gets here: the page sends it nothing.
            say({ type: "refused", reason: "unknown_op" });
          } else if (request.op === "server") {
            staged.hasServer = true;
            say({ type: "ok", op: "server" });
          } else if (request.op === "wifi") {
            staged.hasWifi = true;
            say({ type: "ok", op: "wifi" });
          } else if (request.op === "start") {
            say({ type: "ok", op: "start" });
            for (const reply of options.after ?? [
              { type: "state", state: "joining" },
              { type: "state", state: "pairing" },
              { type: "state", state: "confirm" },
            ])
              say(reply);
          }
        }
      }
    },
    onData(listener) {
      data.add(listener);
      return () => data.delete(listener);
    },
    onClose(listener) {
      closes.add(listener);
      return () => closes.delete(listener);
    },
    async close() {},
  };
  return {
    link,
    written,
    unplug: () => {
      for (const listener of closes) listener();
    },
    say,
  };
}

/** The app as the page sees it, recording every call it makes and what went with it. */
function recordingApi() {
  const calls: { method: string; args: unknown[] }[] = [];
  const api = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args });
          if (method === "petsStartAdding") {
            return { code: "K7QXM-2PA9T", expiresAt: "2026-11-19T12:00:00Z" };
          }
          return undefined;
        },
    },
  ) as { petsStartAdding(): Promise<{ code: string; expiresAt: string }> };
  return { api, calls };
}

const quick = { replyTimeoutMs: 40, tryTimeoutMs: 400, helloAttempts: 2 };
const input = (over: Partial<PairInput> = {}): PairInput => ({
  ssid: SSID,
  password: PASSWORD,
  server,
  ...over,
});

describe("setting a pet up over the cable", () => {
  it("stages the server, then the Wi-Fi, then starts, and ends at confirm", async () => {
    const rig = petRig();
    const { api, calls } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    expect(await session.hello()).toEqual({
      outcome: "ready",
      kind: "astronaut",
      firmware: "0.2.0",
    });
    const states: string[] = [];
    const result = await session.pair(
      input({ onState: (s) => states.push(s) }),
      api,
    );
    expect(result).toEqual({ outcome: "confirm" });
    expect(states).toEqual(["joining", "pairing", "confirm"]);
    expect(rig.written).toEqual([
      "@pet1 hello",
      `@pet1 server 192.168.1.20 4801 ${FP} ${NAME}`,
      `@pet1 wifi ${hex(SSID)} ${hex(PASSWORD)}`,
      "@pet1 start K7QXM2PA9T",
    ]);
    expect(calls.map((c) => c.method)).toEqual(["petsStartAdding"]);
  });

  it("sends the Wi-Fi password only to the cable, never to the app", async () => {
    const rig = petRig();
    const { api, calls } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    const result = await session.pair(input(), api);
    await session.close();

    // It did reach the cable...
    expect(rig.written.some((line) => line.includes(hex(PASSWORD)))).toBe(true);
    // ...and no call to the app carried it, in any form, nor the Wi-Fi name.
    const everything = JSON.stringify(calls);
    for (const secret of [PASSWORD, hex(PASSWORD), SSID, hex(SSID)]) {
      expect(everything).not.toContain(secret);
    }
    expect(calls.every((c) => c.args.length === 0)).toBe(true);
    // ...and nothing the page is told back holds it either.
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("tells a v1 pet to update and writes it nothing but hello", async () => {
    const rig = petRig({ version: 1 });
    const { api, calls } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    expect(await session.hello()).toEqual({
      outcome: "needs-update",
      kind: "astronaut",
      firmware: "0.1.0",
    });
    // Even if the page tried, no Wi-Fi frame can be written.
    const result = await session.pair(input(), api);
    expect(result.outcome).toBe("not-ready");
    expect(rig.written).toEqual(["@pet1 hello"]);
    expect(calls).toEqual([]);
    expect(rig.written.join("\n")).not.toContain(hex(PASSWORD));
  });

  it("sends nothing to a pet that is already paired", async () => {
    const rig = petRig({ paired: true });
    const { api, calls } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    expect((await session.hello()).outcome).toBe("already-paired");
    expect((await session.pair(input(), api)).outcome).toBe("not-ready");
    expect(rig.written).toEqual(["@pet1 hello"]);
    expect(calls).toEqual([]);
  });

  it("refuses a bad value before anything is sent or a setup code is made", async () => {
    const rig = petRig();
    const { api, calls } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    const short = await session.pair(input({ password: "short" }), api);
    expect(short).toMatchObject({ outcome: "invalid", field: "password" });
    expect(JSON.stringify(short)).not.toContain('short"');
    const empty = await session.pair(input({ ssid: "" }), api);
    expect(empty).toMatchObject({ outcome: "invalid", field: "ssid" });
    const noServer = await session.pair(
      input({ server: { ...server, port: 0 } }),
      api,
    );
    expect(noServer).toMatchObject({ outcome: "invalid", field: "server" });
    expect(rig.written).toEqual(["@pet1 hello"]);
    expect(calls).toEqual([]);
  });

  it("takes an open network with an empty password", async () => {
    const rig = petRig();
    const { api } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    await session.pair(input({ ssid: "Cafe Guest", password: "" }), api);
    expect(rig.written).toContain(`@pet1 wifi ${hex("Cafe Guest")} -`);
  });

  it("reports why a try failed in plain words", async () => {
    const rig = petRig({
      after: [
        { type: "state", state: "joining" },
        { type: "state", state: "error", error: "wifi_failed" },
      ],
    });
    const { api } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    const result = await session.pair(input(), api);
    expect(result).toEqual({
      outcome: "failed",
      error: "wifi_failed",
      message: FAILURE_TEXT.wifi_failed,
    });
    expect(result.outcome === "failed" && result.message).not.toContain(
      PASSWORD,
    );
  });

  it("does not take an old answer for the answer to a new line", async () => {
    const rig = petRig();
    const { api } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    rig.say({ type: "refused", reason: "busy" });
    expect((await session.pair(input(), api)).outcome).toBe("confirm");
  });

  it("says so, in words, when the pet turns a line away", async () => {
    const rig = petRig();
    const { api } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    // A pet that already holds a try refuses the first stage.
    rig.link.write = async () => {
      queueMicrotask(() => rig.say({ type: "refused", reason: "busy" }));
    };
    const result = await session.pair(input(), api);
    expect(result).toMatchObject({ outcome: "refused", reason: "busy" });
    expect(result.outcome === "refused" && result.message).toMatch(/busy/);
  });

  it("counts a pet that never answers as silent", async () => {
    const quiet = petRig({ silent: true });
    const session = new PetUsbSession(quiet.link, quick);
    expect((await session.hello()).outcome).toBe("no-answer");
    expect(quiet.written).toEqual(["@pet1 hello", "@pet1 hello"]);
  });

  it("notices a cable that is pulled out", async () => {
    const rig = petRig({ after: [{ type: "state", state: "joining" }] });
    const { api } = recordingApi();
    const session = new PetUsbSession(rig.link, quick);
    await session.hello();
    const pending = session.pair(input(), api);
    setTimeout(() => rig.unplug(), 10);
    expect((await pending).outcome).toBe("unplugged");
  });

  it("gives up when the pet goes quiet", async () => {
    const rig = petRig({ after: [] });
    const { api } = recordingApi();
    const session = new PetUsbSession(rig.link, {
      ...quick,
      tryTimeoutMs: 80,
    });
    await session.hello();
    expect((await session.pair(input(), api)).outcome).toBe("timed-out");
  });
});

describe("telling the pet where the computer is", () => {
  const status = (over: Partial<DeskPetsStatus> = {}): DeskPetsStatus => ({
    enabled: true,
    running: true,
    port: 4801,
    mdnsName: NAME,
    mdnsRunning: true,
    fingerprint: FP,
    addresses: ["fd12::1", "192.168.1.20"],
    pets: [],
    pending: null,
    drafts: [],
    voiceKey: false,
    voiceProblem: null,
    setupExpiresAt: null,
    problem: null,
    ...over,
  });

  it("takes the private IPv4 address first, the pin and the name", () => {
    expect(serverTarget(status())).toEqual({ ok: true, server });
  });

  it("falls back to IPv6, then to the name alone", () => {
    expect(serverTarget(status({ addresses: ["FD12::1"] }))).toMatchObject({
      ok: true,
      server: { address: "fd12::1" },
    });
    expect(serverTarget(status({ addresses: [] }))).toMatchObject({
      ok: true,
      server: { address: null },
    });
  });

  it("says why it cannot when Desk pets are off or not ready", () => {
    expect(serverTarget(status({ running: false })).ok).toBe(false);
    expect(serverTarget(status({ enabled: false })).ok).toBe(false);
    expect(serverTarget(status({ port: null })).ok).toBe(false);
    expect(serverTarget(status({ fingerprint: null })).ok).toBe(false);
  });
});

describe("a request for the USB port that fails", () => {
  it("is told in words, never with the browser's own text", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(connectProblem(named("NotFoundError"))).toMatch(/No desk pet/);
    expect(connectProblem(named("SecurityError"))).toMatch(/not allowed/);
    expect(connectProblem(named("NetworkError"))).toMatch(/busy/);
    expect(connectProblem(new Error("secret detail"))).not.toContain("secret");
  });
});

describe("where the Wi-Fi password may go, read from the source", () => {
  const dir = join(import.meta.dirname, "src");
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const shared = join(import.meta.dirname, "../shared");

  it("is not in any call between the page and the app's main process", () => {
    const calls = readFileSync(join(shared, "types.ts"), "utf8");
    const preload = readFileSync(
      join(import.meta.dirname, "../preload/index.ts"),
      "utf8",
    );
    for (const text of [calls, preload]) {
      for (const line of text.split("\n")) {
        if (/pets[A-Z]|serial[A-Z]|onSerial/.test(line)) {
          expect(line, line).not.toMatch(/wifi|ssid|password|passphrase/i);
        }
      }
    }
  });

  it("is never logged, stored or put in a link by the driver or the screen", () => {
    for (const name of ["pet-usb-driver.ts", "DeskPets.tsx"]) {
      const text = read(name)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(text, name).not.toMatch(
        /console\.|localStorage|sessionStorage|indexedDB|document\.cookie|ipcRenderer|postMessage|fetch\(/,
      );
    }
  });

  it("is typed in a password field that no one is asked to remember", () => {
    const screen = read("DeskPets.tsx");
    expect(screen).toMatch(/type="password"[\s\S]{0,400}autoComplete="off"/);
    expect(screen).toMatch(/data-1p-ignore/);
    expect(screen).toMatch(/data-lpignore/);
  });
});
