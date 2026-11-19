import { describe, expect, it } from "vitest";
import {
  GRID_COLS,
  GRID_ROWS,
  MAX_FRAMES,
  MAX_RECORDING_MS,
  type RecordStatus,
} from "../../shared/recording";
import { type Grab, RecordingSession, type SessionDeps } from "./session";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function look(fill: number, title = "Notes"): Grab {
  return {
    title,
    grid: new Uint8Array(GRID_COLS * GRID_ROWS).fill(fill),
    encode: () => JPEG,
    thumb: () => `data:image/jpeg;base64,${fill}`,
  };
}

/** A session on a hand-turned clock and a list of looks, with no capture. */
function fake(
  looks: (Grab | undefined)[],
  options: { ownFront?: boolean } = {},
) {
  let now = 1_000;
  let ids = 0;
  let ticking = false;
  const seen: RecordStatus[] = [];
  const queue = [...looks];
  const deps: SessionDeps = {
    grab: async () => queue.shift(),
    ownInFront: () => options.ownFront ?? false,
    thumbOf: () => "data:image/jpeg;base64,thumb",
    now: () => now,
    every: () => {
      ticking = true;
      return () => {
        ticking = false;
      };
    },
    id: () => {
      ids += 1;
      return `f${ids}`;
    },
    onChange: (status) => seen.push(status),
  };
  const session = new RecordingSession(deps);
  return {
    session,
    seen,
    get ticking() {
      return ticking;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

const window = { id: "window:1", name: "Notes", kind: "window" } as const;
const screen = {
  id: "screen:1",
  name: "Entire screen",
  kind: "screen",
} as const;

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("a live recording", () => {
  it("keeps a picture only when the screen changed", async () => {
    const t = fake([look(10), look(10), look(200), look(200)]);
    t.session.start(screen);
    await settle(); // the first look, at once
    for (let i = 0; i < 3; i += 1) {
      t.advance(2000);
      await t.session.tick();
    }
    const status = t.session.status();
    expect(status.frames.map((f) => f.atMs)).toEqual([0, 4000]);
    expect(status.recording).toBe(true);
    expect(t.ticking).toBe(true);
  });

  it("never keeps a look while this app is in front", async () => {
    const t = fake([look(10), look(200)], { ownFront: true });
    t.session.start(screen);
    await settle();
    await t.session.tick();
    expect(t.session.status().frames).toHaveLength(0);
    expect(t.session.status().skipped).toBe(2);
  });

  it("does not skip a window's look because this app is in front", async () => {
    const t = fake([look(10)], { ownFront: true });
    t.session.start(window);
    await settle();
    expect(t.session.status().frames).toHaveLength(1);
    expect(t.session.status().skipped).toBe(0);
  });

  it("skips a look while the recorded window's title reads like a password manager", async () => {
    const t = fake([look(10), look(200, "1Password"), look(90)]);
    t.session.start(window);
    await settle();
    t.advance(2000);
    await t.session.tick();
    t.advance(2000);
    await t.session.tick();
    const status = t.session.status();
    expect(status.frames).toHaveLength(2);
    expect(status.skipped).toBe(1);
  });

  it("refuses to start on a window that reads like a password manager", () => {
    const t = fake([]);
    expect(() =>
      t.session.start({ id: "window:9", name: "Bitwarden", kind: "window" }),
    ).toThrow(/password manager/);
  });

  it("stops at ten minutes", async () => {
    const t = fake([look(10)]);
    t.session.start(screen);
    await settle();
    t.advance(MAX_RECORDING_MS);
    await t.session.tick();
    expect(t.session.status().recording).toBe(false);
    expect(t.session.status().stopped).toBe("time");
    expect(t.ticking).toBe(false);
  });

  it("stops at the most pictures a recording keeps", async () => {
    const looks = Array.from({ length: MAX_FRAMES + 5 }, (_, i) =>
      look(i % 2 === 0 ? 10 : 200),
    );
    const t = fake(looks);
    t.session.start(screen);
    await settle();
    for (let i = 0; i < MAX_FRAMES + 4; i += 1) await t.session.tick();
    expect(t.session.status().frames).toHaveLength(MAX_FRAMES);
    expect(t.session.status().stopped).toBe("frames");
  });

  it("stops when the window is gone", async () => {
    const t = fake([undefined, undefined, undefined]);
    t.session.start(window);
    await settle();
    await t.session.tick();
    await t.session.tick();
    expect(t.session.status().stopped).toBe("gone");
  });

  it("keeps nothing that is not a JPEG", async () => {
    const bad = { ...look(10), encode: () => new Uint8Array([1, 2, 3]) };
    const t = fake([bad]);
    t.session.start(screen);
    await settle();
    expect(t.session.status().frames).toHaveLength(0);
  });

  it("lets the person remove a picture, and clear them all", async () => {
    const t = fake([look(10), look(200)]);
    t.session.start(screen);
    await settle();
    await t.session.tick();
    t.session.stop();
    const [first] = t.session.status().frames;
    t.session.removeFrame(first?.id);
    expect(t.session.status().frames).toHaveLength(1);
    expect(t.session.pictures()).toHaveLength(1);
    t.session.clear();
    expect(t.session.status().frames).toHaveLength(0);
    expect(t.session.pictures()).toHaveLength(0);
  });

  it("says each change to the page", async () => {
    const t = fake([look(10)]);
    t.session.start(screen);
    await settle();
    expect(t.seen.length).toBeGreaterThan(0);
    expect(t.seen.at(-1)?.frames[0]?.thumb).toMatch(/^data:image\/jpeg/);
  });
});

describe("pictures from a video", () => {
  const b64 = Buffer.from(JPEG).toString("base64");

  it("takes a JPEG and its time", () => {
    const t = fake([]);
    const status = t.session.addVideoFrame(b64, 4000);
    expect(status.kind).toBe("video");
    expect(status.frames[0]?.atMs).toBe(4000);
    expect(t.session.pictures()[0]?.jpeg).toEqual(JPEG);
  });

  it.each([
    ["not text", 42, 0],
    ["not base64", "**", 0],
    ["not a JPEG", Buffer.from("hello").toString("base64"), 0],
    ["a bad time", b64, -1],
    ["no time", b64, Number.NaN],
  ])("refuses %s", (_label, jpeg, at) => {
    const t = fake([]);
    expect(() => t.session.addVideoFrame(jpeg, at)).toThrow();
  });

  it("refuses a picture larger than the limit", () => {
    const big = new Uint8Array(1_200_000);
    big.set(JPEG);
    const t = fake([]);
    expect(() =>
      t.session.addVideoFrame(Buffer.from(big).toString("base64"), 0),
    ).toThrow();
  });

  it("stops taking pictures at the limit", () => {
    const t = fake([]);
    for (let i = 0; i < MAX_FRAMES; i += 1) t.session.addVideoFrame(b64, i);
    expect(() => t.session.addVideoFrame(b64, 999)).toThrow(/at most/);
  });

  it("takes none while a live recording runs", async () => {
    const t = fake([look(10)]);
    t.session.start(screen);
    await settle();
    expect(() => t.session.addVideoFrame(b64, 0)).toThrow(/Stop/);
  });
});
