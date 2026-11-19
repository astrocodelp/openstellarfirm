import { describe, expect, it } from "vitest";
import { nextSeq, parseAfter, parseWait } from "./inbox";

const notice = (seq: number) => ({ seq, kind: "done", line: `n${seq}` });

describe("parseAfter", () => {
  it("reads a non-negative whole number", () => {
    expect(parseAfter("0")).toBe(0);
    expect(parseAfter("12")).toBe(12);
    expect(parseAfter("007")).toBe(7);
  });

  it("falls back to 0 for anything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "-1",
      "1.5",
      "abc",
      "1e3",
      " 4",
      "4 ",
      "+4",
      "0x10",
      "99999999999999999999",
    ]) {
      expect(parseAfter(bad), String(bad)).toBe(0);
    }
  });
});

describe("parseWait", () => {
  it("reads 0 to 20 seconds", () => {
    expect(parseWait("0")).toBe(0);
    expect(parseWait("7")).toBe(7);
    expect(parseWait("20")).toBe(20);
  });

  it("clamps to the range", () => {
    expect(parseWait("21")).toBe(20);
    expect(parseWait("3000")).toBe(20);
    expect(parseWait("-5")).toBe(0);
    expect(parseWait("2.9")).toBe(2);
  });

  it("waits the full 20 seconds when the value is missing or unreadable", () => {
    for (const bad of [null, undefined, "", "  ", "abc", "NaN", "Infinity"]) {
      expect(parseWait(bad), String(bad)).toBe(20);
    }
  });
});

describe("nextSeq", () => {
  it("is the highest sequence returned, else after", () => {
    expect(nextSeq([notice(3), notice(9), notice(5)], 2)).toBe(9);
    expect(nextSeq([], 7)).toBe(7);
    expect(nextSeq([notice(9)], 9)).toBe(9);
    expect(nextSeq([notice(1), notice(2)], 0)).toBe(2);
  });

  it("follows the notices even when they are below after", () => {
    // A counter that started over: the answer says where the pet now stands.
    expect(nextSeq([notice(1), notice(2)], 100)).toBe(2);
  });
});
