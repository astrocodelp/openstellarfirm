import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CONFIRM_CODE_LENGTH,
  formatConfirmCode,
  formatSetupCode,
  isConfirmCode,
  isSetupCode,
  makeCode,
  makeConfirmCode,
  makeSetupCode,
  normalizeCode,
  SETUP_CODE_LENGTH,
} from "./codes";

/** A small seeded generator, so a statistical test is the same every run. */
function seededBytes(seed: number): (count: number) => Uint8Array {
  let state = seed >>> 0;
  return (count) => {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      // xorshift32
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out[i] = state & 0xff;
    }
    return out;
  };
}

describe("the code alphabet", () => {
  it("has 31 distinct characters without the look-alikes", () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(new Set(CODE_ALPHABET).size).toBe(31);
    for (const banned of "ILO01") {
      expect(CODE_ALPHABET).not.toContain(banned);
    }
    expect(CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
  });
});

describe("makeCode", () => {
  it("maps bytes below 248 to the alphabet and turns the rest away", () => {
    // 0 -> A, 30 -> 9, 31 -> A again; 248 and 255 are rejected.
    const bytes = Uint8Array.from([0, 30, 31, 247, 248, 255, 1]);
    const code = makeCode(5, () => bytes);
    expect(code).toBe(
      [0, 30, 31 % 31, 247 % 31, 1]
        .map((b) => CODE_ALPHABET.charAt(b))
        .join(""),
    );
  });

  it("asks again when a round of bytes is not enough", () => {
    let calls = 0;
    const code = makeCode(4, () => {
      calls += 1;
      return Uint8Array.from([255, 255, 3, 255, 255, 255, 255, 255]);
    });
    expect(calls).toBeGreaterThan(1);
    expect(code).toBe("DDDD");
  });

  it("gives up on a source that never gives a usable byte", () => {
    expect(() => makeCode(4, (n) => new Uint8Array(n).fill(255))).toThrow(
      /usable bytes/,
    );
    expect(() => makeCode(4, () => new Uint8Array(0))).toThrow();
  });

  it("refuses a length that is not a positive whole number", () => {
    expect(() => makeCode(0, () => new Uint8Array(4))).toThrow(RangeError);
    expect(() => makeCode(2.5, () => new Uint8Array(4))).toThrow(RangeError);
  });

  it("is uniform: every character comes up about as often as any other", () => {
    const random = seededBytes(0x9e3779b9);
    const counts = new Map<string, number>();
    const total = 31 * 4000;
    const codes = Math.ceil(total / SETUP_CODE_LENGTH);
    for (let i = 0; i < codes; i += 1) {
      for (const char of makeCode(SETUP_CODE_LENGTH, random)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(31);
    const expected = (codes * SETUP_CODE_LENGTH) / 31;
    for (const [char, count] of counts) {
      // About 6 standard deviations of a binomial count, so a fixed seed
      // that passes once passes always and a biased mapping would not.
      expect(Math.abs(count - expected), char).toBeLessThan(
        6 * Math.sqrt(expected),
      );
    }
  });

  it("is not biased towards the first characters, as a plain remainder is", () => {
    // Every byte 0..247 once: each of the 31 characters appears exactly 8
    // times. A remainder of all 256 bytes would favour the first 8.
    const all = Uint8Array.from({ length: 248 }, (_, i) => i);
    const code = makeCode(248, () => all);
    for (const char of CODE_ALPHABET) {
      expect(code.split(char).length - 1, char).toBe(8);
    }
  });
});

describe("normalizing and formatting", () => {
  it("uppercases and drops everything but letters and digits", () => {
    expect(normalizeCode(" k7qxm-2pa9t ")).toBe("K7QXM2PA9T");
    expect(normalizeCode("k7qxm 2pa9t\n")).toBe("K7QXM2PA9T");
    expect(normalizeCode("")).toBe("");
  });

  it("does not let non-ASCII letters turn into code characters", () => {
    expect(normalizeCode("\u00DF")).toBe("");
    expect(normalizeCode("\u0131")).toBe("");
    expect(normalizeCode("\uFF21")).toBe("");
  });

  it("puts the dash in the middle", () => {
    expect(formatSetupCode("k7qxm2pa9t")).toBe("K7QXM-2PA9T");
    expect(formatConfirmCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(formatSetupCode("K7QXM-2PA9T")).toBe("K7QXM-2PA9T");
  });

  it("formats a code typed so far, for a box that adds the dash", () => {
    expect(formatSetupCode("k7q")).toBe("K7Q");
    expect(formatSetupCode("k7qxm2")).toBe("K7QXM-2");
    expect(formatConfirmCode("abcde")).toBe("ABCD-E");
  });
});

describe("checking a code", () => {
  it("accepts the shown form and the bare form, in any case", () => {
    expect(isSetupCode("K7QXM-2PA9T")).toBe(true);
    expect(isSetupCode("k7qxm2pa9t")).toBe(true);
    expect(isSetupCode(" k7qxm 2pa9t ")).toBe(true);
    expect(isConfirmCode("ABCD-EFGH")).toBe(true);
    expect(isConfirmCode("abcdefgh")).toBe(true);
  });

  it("refuses the wrong length", () => {
    expect(isSetupCode("K7QXM-2PA9")).toBe(false);
    expect(isSetupCode("K7QXM-2PA9TT")).toBe(false);
    expect(isConfirmCode("ABCD-EFG")).toBe(false);
    expect(isConfirmCode("ABCD-EFGHJ")).toBe(false);
    expect(isSetupCode("")).toBe(false);
  });

  it("refuses a character outside the alphabet", () => {
    for (const banned of ["I", "L", "O", "0", "1"]) {
      expect(isConfirmCode(`ABCD-EFG${banned}`), banned).toBe(false);
      expect(isSetupCode(`K7QXM-2PA9${banned}`), banned).toBe(false);
    }
  });

  it("refuses what is not a string", () => {
    expect(isSetupCode(undefined)).toBe(false);
    expect(isSetupCode(1234567890)).toBe(false);
    expect(isConfirmCode(null)).toBe(false);
  });

  it("does not mix the two kinds of code up", () => {
    expect(isSetupCode("ABCD-EFGH")).toBe(false);
    expect(isConfirmCode("K7QXM-2PA9T")).toBe(false);
  });
});

describe("making codes in their shown form", () => {
  it("makes a setup code like K7QXM-2PA9T", () => {
    const code = makeSetupCode(seededBytes(1));
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(isSetupCode(code)).toBe(true);
  });

  it("makes a confirm code like ABCD-EFGH", () => {
    const code = makeConfirmCode(seededBytes(2));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(isConfirmCode(code)).toBe(true);
    expect(normalizeCode(code)).toHaveLength(CONFIRM_CODE_LENGTH);
  });
});
