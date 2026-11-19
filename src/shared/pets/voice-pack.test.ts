import { describe, expect, it } from "vitest";
import { PET_LINES } from "./lines";
import {
  bootLineIds,
  decodeVoicePack,
  encodeVoicePack,
  VOICE_PACK_PATH,
  VoicePackFormatError,
} from "./voice-pack";

function sine(count: number, hz: number, rate: number, amp = 8000): Int16Array {
  return Int16Array.from({ length: count }, (_, i) =>
    Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate)),
  );
}

function maxError(a: Int16Array, b: Int16Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) {
    worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return worst;
}

describe("the voice pack path", () => {
  it("is served from /pets/voice", () => {
    expect(VOICE_PACK_PATH("talia")).toBe("/pets/voice/talia.sfvp");
  });
});

describe("bootLineIds", () => {
  it("lists the boot lines in pack order", () => {
    const ids = bootLineIds();
    expect(ids).toEqual(PET_LINES.filter((l) => l.boot).map((l) => l.id));
    expect(ids[0]).toBe("setup-join");
    expect(ids).toContain("char-K");
    expect(ids).not.toContain("hello");
  });
});

describe("the .sfvp file", () => {
  const clips = [
    { id: "setup-join", samples: sine(5000, 440, 22_050) },
    { id: "char-A", samples: sine(1017, 220, 22_050) },
    { id: "role-mechanical-engineer", samples: sine(30, 100, 22_050) },
    { id: "empty", samples: new Int16Array(0) },
  ];

  it("starts with the header of the contract", () => {
    const bytes = encodeVoicePack(clips);
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("SFVP");
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint16(6, true)).toBe(4);
    expect(view.getUint32(8, true)).toBe(22_050);
    expect(view.getUint16(12, true)).toBe(512);
    expect(view.getUint16(14, true)).toBe(0);
  });

  it("lays out 36-byte entries and clips from the end of the table", () => {
    const bytes = encodeVoicePack(clips);
    const view = new DataView(bytes.buffer);
    const tableEnd = 16 + 36 * 4;
    const entry = (i: number) => 16 + 36 * i;
    // The first clip's id is NUL padded and its data follows the table.
    expect(
      String.fromCharCode(...bytes.subarray(entry(0), entry(0) + 10)),
    ).toBe("setup-join");
    expect(bytes[entry(0) + 10]).toBe(0);
    expect(view.getUint32(entry(0) + 24, true)).toBe(tableEnd);
    expect(view.getUint32(entry(0) + 28, true)).toBe(512 * 5); // 5000 samples: 5 blocks
    expect(view.getUint32(entry(0) + 32, true)).toBe(5000);
    // Each clip starts where the last ended.
    expect(view.getUint32(entry(1) + 24, true)).toBe(tableEnd + 512 * 5);
    expect(view.getUint32(entry(1) + 28, true)).toBe(512);
    expect(view.getUint32(entry(3) + 28, true)).toBe(0);
    expect(bytes.length).toBe(tableEnd + 512 * 5 + 512 + 512 + 0);
  });

  it("holds a 24-character id with no terminator", () => {
    const id = "role-mechanical-engineer";
    expect(id).toHaveLength(24);
    const bytes = encodeVoicePack([{ id, samples: sine(10, 100, 22_050) }]);
    expect(String.fromCharCode(...bytes.subarray(16, 40))).toBe(id);
    expect(decodeVoicePack(bytes).clips[0]?.id).toBe(id);
  });

  it("round-trips the clips within the codec's error", () => {
    const pack = decodeVoicePack(encodeVoicePack(clips));
    expect(pack.sampleRate).toBe(22_050);
    expect(pack.blockAlign).toBe(512);
    expect(pack.clips.map((c) => c.id)).toEqual(clips.map((c) => c.id));
    for (const [i, clip] of pack.clips.entries()) {
      const original = clips[i]?.samples ?? new Int16Array(0);
      expect(clip.samples.length).toBe(original.length);
      // The sine is slow against the 22 kHz rate, so ADPCM tracks it closely
      // once the step size has settled.
      if (original.length > 1000) {
        expect(
          maxError(clip.samples.subarray(200), original.subarray(200)),
        ).toBeLessThan(600);
      }
    }
    // The header sample of each block is exact.
    expect(pack.clips[1]?.samples[0]).toBe(clips[1]?.samples[0]);
  });

  it("packs the whole line list", () => {
    const all = PET_LINES.map((l) => ({
      id: l.id,
      samples: sine(2000, 300, 22_050),
    }));
    const pack = decodeVoicePack(encodeVoicePack(all));
    expect(pack.clips.map((c) => c.id)).toEqual(PET_LINES.map((l) => l.id));
  });

  it("packs an empty pack", () => {
    const pack = decodeVoicePack(encodeVoicePack([]));
    expect(pack.clips).toEqual([]);
  });

  it("refuses a bad or repeated clip id", () => {
    const s = new Int16Array(4);
    expect(() => encodeVoicePack([{ id: "", samples: s }])).toThrow(RangeError);
    expect(() => encodeVoicePack([{ id: "a".repeat(25), samples: s }])).toThrow(
      RangeError,
    );
    expect(() => encodeVoicePack([{ id: "has space", samples: s }])).toThrow(
      RangeError,
    );
    expect(() =>
      encodeVoicePack([{ id: "d\u00E9j\u00E0", samples: s }]),
    ).toThrow(RangeError);
    expect(() =>
      encodeVoicePack([
        { id: "same", samples: s },
        { id: "same", samples: s },
      ]),
    ).toThrow(/twice/);
  });

  it("refuses a file that is not a voice pack", () => {
    const good = encodeVoicePack(clips);
    expect(() => decodeVoicePack(new Uint8Array(4))).toThrow(
      VoicePackFormatError,
    );
    const wrongMagic = good.slice();
    wrongMagic[0] = 0x58;
    expect(() => decodeVoicePack(wrongMagic)).toThrow(/magic/);
    const wrongVersion = good.slice();
    wrongVersion[4] = 2;
    expect(() => decodeVoicePack(wrongVersion)).toThrow(/version/);
    expect(() => decodeVoicePack(good.subarray(0, 100))).toThrow(
      VoicePackFormatError,
    );
    expect(() => decodeVoicePack(good.subarray(0, good.length - 1))).toThrow(
      /outside/,
    );
  });
});
