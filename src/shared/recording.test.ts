import { describe, expect, it } from "vitest";
import {
  batches,
  callsFor,
  changedCells,
  clockOf,
  GRID_COLS,
  GRID_ROWS,
  isJpeg,
  isNewPicture,
  looksPrivate,
  MAX_VIDEO_SAMPLES,
  toGray,
  videoSampleTimes,
} from "./recording";

const CELLS = GRID_COLS * GRID_ROWS;

function grid(fill: number): Uint8Array {
  return new Uint8Array(CELLS).fill(fill);
}

describe("gray levels", () => {
  it("reads red and blue from the right place for each order", () => {
    const red = toGray(new Uint8Array([255, 0, 0, 255]), "rgba");
    const asBgra = toGray(new Uint8Array([0, 0, 255, 255]), "bgra");
    expect(red[0]).toBe(76);
    expect(asBgra[0]).toBe(76);
    expect(toGray(new Uint8Array([255, 255, 255, 255]), "rgba")[0]).toBe(255);
  });
});

describe("keeping a picture only when the screen changed", () => {
  it("keeps the first look", () => {
    expect(isNewPicture(undefined, grid(0))).toBe(true);
  });

  it("does not keep the same picture twice", () => {
    expect(isNewPicture(grid(40), grid(40))).toBe(false);
  });

  it("does not keep a blinking cursor or a ticking clock", () => {
    const next = grid(40);
    next[10] = 200;
    next[11] = 200;
    expect(changedCells(grid(40), next)).toBe(2);
    expect(isNewPicture(grid(40), next)).toBe(false);
  });

  it("ignores small shifts in brightness", () => {
    expect(isNewPicture(grid(40), grid(48))).toBe(false);
  });

  it("keeps a picture when a part of the screen changed", () => {
    const next = grid(40);
    for (let i = 0; i < 30; i += 1) next[i] = 220;
    expect(isNewPicture(grid(40), next)).toBe(true);
  });

  it("treats grids of another size as changed", () => {
    expect(isNewPicture(grid(0), new Uint8Array(10))).toBe(true);
  });
});

describe("batches", () => {
  it("sends at most three pictures a call, in order", () => {
    const groups = batches([1, 2, 3, 4, 5, 6, 7]);
    expect(groups).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(groups.every((g) => g.length <= 3)).toBe(true);
  });

  it("counts one call a batch, then one to write the skill", () => {
    expect(callsFor(0)).toBe(0);
    expect(callsFor(1)).toBe(2);
    expect(callsFor(3)).toBe(2);
    expect(callsFor(4)).toBe(3);
    expect(callsFor(60)).toBe(21);
  });

  it("refuses an empty batch size", () => {
    expect(() => batches([1], 0)).toThrow();
  });
});

describe("looking through a video", () => {
  it("looks every two seconds", () => {
    expect(videoSampleTimes(7)).toEqual([0, 2, 4, 6]);
  });

  it("spreads the looks over a long video", () => {
    const times = videoSampleTimes(3600);
    expect(times.length).toBeLessThanOrEqual(MAX_VIDEO_SAMPLES);
    expect(times.at(-1)).toBeGreaterThan(3500);
  });

  it("has nothing to look at in a video with no length", () => {
    expect(videoSampleTimes(0)).toEqual([]);
    expect(videoSampleTimes(Number.NaN)).toEqual([]);
    expect(videoSampleTimes(Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("private windows", () => {
  it.each([
    "1Password",
    "Bitwarden — Vault",
    "KeePassXC",
    "Keychain Access",
    "Passwords",
    "Change your password - Mail",
  ])("reads %s as private", (title) => {
    expect(looksPrivate(title)).toBe(true);
  });

  it.each(["Notes", "Expenses — Sheets", "Entire screen", "Passport renewal"])(
    "does not read %s as private",
    (title) => {
      expect(looksPrivate(title)).toBe(false);
    },
  );
});

describe("small helpers", () => {
  it("says a time on the recording", () => {
    expect(clockOf(0)).toBe("0:00");
    expect(clockOf(65_400)).toBe("1:05");
    expect(clockOf(600_000)).toBe("10:00");
  });

  it("knows a JPEG by its first bytes", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
