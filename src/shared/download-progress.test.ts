import { describe, expect, it } from "vitest";
import {
  cleanProgress,
  PROGRESS_INTERVAL_MS,
  progressPercent,
  progressThrottle,
} from "./download-progress";

describe("the share received", () => {
  it("is a whole number from 0 to 100", () => {
    expect(progressPercent(0, 1000)).toBe(0);
    expect(progressPercent(1, 1000)).toBe(0);
    expect(progressPercent(10, 1000)).toBe(1);
    expect(progressPercent(425, 1000)).toBe(42);
    expect(progressPercent(1000, 1000)).toBe(100);
  });

  it("says 100 only once every byte is in", () => {
    expect(progressPercent(999, 1000)).toBe(99);
    expect(progressPercent(1_525_435, 1_525_436)).toBe(99);
    expect(progressPercent(1_525_436, 1_525_436)).toBe(100);
  });

  it("reads nonsense as 0 and never goes past 100", () => {
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(-5, 100)).toBe(0);
    expect(progressPercent(Number.NaN, 100)).toBe(0);
    expect(progressPercent(50, Number.POSITIVE_INFINITY)).toBe(0);
    expect(progressPercent(500, 100)).toBe(100);
  });
});

describe("the throttle", () => {
  function clock() {
    let at = 1_000;
    return {
      now: () => at,
      tick: (ms: number) => {
        at += ms;
      },
    };
  }

  it("lets through at most one update an interval", () => {
    const time = clock();
    const sent: number[] = [];
    const throttle = progressThrottle(
      (n: number) => sent.push(n),
      PROGRESS_INTERVAL_MS,
      time.now,
    );
    throttle.push(1);
    time.tick(30);
    throttle.push(2);
    time.tick(30);
    throttle.push(3);
    time.tick(40);
    throttle.push(4);
    time.tick(99);
    throttle.push(5);
    time.tick(1);
    throttle.push(6);
    expect(sent).toEqual([1, 4, 6]);
  });

  it("is about ten a second however fast the bytes come", () => {
    const time = clock();
    let sent = 0;
    const throttle = progressThrottle(
      () => {
        sent += 1;
      },
      PROGRESS_INTERVAL_MS,
      time.now,
    );
    // A chunk every 2 ms for one second.
    for (let i = 0; i < 500; i += 1) {
      throttle.push(i);
      time.tick(2);
    }
    expect(sent).toBe(10);
  });

  it("always sends the last value, even right after another", () => {
    const time = clock();
    const sent: string[] = [];
    const throttle = progressThrottle(
      (s: string) => sent.push(s),
      PROGRESS_INTERVAL_MS,
      time.now,
    );
    throttle.push("first");
    throttle.push("dropped");
    throttle.flush("last");
    expect(sent).toEqual(["first", "last"]);
    // The flush counts as a send: the next push waits a whole interval.
    time.tick(50);
    throttle.push("too soon");
    expect(sent).toEqual(["first", "last"]);
  });
});

describe("a progress update the page receives", () => {
  it("keeps a known shape", () => {
    expect(cleanProgress({ code: "deu", received: 10, total: 100 })).toEqual({
      code: "deu",
      received: 10,
      total: 100,
    });
  });

  it("never reports more than the whole file", () => {
    expect(cleanProgress({ code: "deu", received: 200, total: 100 })).toEqual({
      code: "deu",
      received: 100,
      total: 100,
    });
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "deu",
      { code: "", received: 1, total: 2 },
      { code: "x".repeat(40), received: 1, total: 2 },
      { code: "deu", received: -1, total: 2 },
      { code: "deu", received: 1.5, total: 2 },
      { code: "deu", received: 1, total: 0 },
      { code: "deu", received: "1", total: 2 },
      { code: "deu", received: 1, total: Number.POSITIVE_INFINITY },
    ])
      expect(cleanProgress(bad)).toBeUndefined();
  });
});
