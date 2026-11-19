import { describe, expect, it } from "vitest";
import { FRAME_EVERY, FramePoller, shouldPoll } from "./frame-poller";

/** A poller on hand-driven timers, counting the pictures it asks for. */
function poller() {
  const timers = new Map<number, () => void>();
  let next = 1;
  const asked: string[] = [];
  const poll = new FramePoller<string>({
    fetch: async (id) => {
      asked.push(id);
      return `frame ${asked.length}`;
    },
    setTimer: (run, ms) => {
      expect(ms).toBe(FRAME_EVERY);
      const at = next++;
      timers.set(at, run);
      return at;
    },
    clearTimer: (timer) => {
      timers.delete(timer as number);
    },
  });
  /** One second goes by: every timer that was waiting runs. */
  const tick = async () => {
    const due = [...timers.values()];
    timers.clear();
    for (const run of due) run();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { poll, asked, timers, tick };
}

describe("the live pictures of the computers", () => {
  it("are asked for only while watched, on and visible", () => {
    expect(shouldPoll({ watchers: 1, on: true, visible: true })).toBe(true);
    expect(shouldPoll({ watchers: 0, on: true, visible: true })).toBe(false);
    expect(shouldPoll({ watchers: 1, on: false, visible: true })).toBe(false);
    expect(shouldPoll({ watchers: 1, on: true, visible: false })).toBe(false);
  });

  it("asks about once a second while it shows, and stops when hidden", async () => {
    const { poll, asked, timers, tick } = poller();
    const seen: (string | null)[] = [];
    poll.setOn("a", true);
    const stop = poll.watch("a", (frame) => seen.push(frame));
    await tick();
    expect(asked).toEqual(["a"]);
    expect(seen).toEqual(["frame 1"]);
    await tick();
    expect(asked).toHaveLength(2);
    poll.setVisible(false);
    expect(timers.size).toBe(0);
    await tick();
    expect(asked).toHaveLength(2);
    poll.setVisible(true);
    await tick();
    expect(asked).toHaveLength(3);
    stop();
    await tick();
    await tick();
    expect(asked).toHaveLength(3);
  });

  it("never asks for a computer that is off, and forgets its picture", async () => {
    const { poll, asked, tick } = poller();
    const seen: (string | null)[] = [];
    poll.watch("a", (frame) => seen.push(frame));
    await tick();
    expect(asked).toEqual([]);
    poll.setOn("a", true);
    await tick();
    expect(poll.latest("a")).toBe("frame 1");
    poll.setOn("a", false);
    expect(poll.latest("a")).toBeNull();
    expect(seen.at(-1)).toBeNull();
    await tick();
    expect(asked).toHaveLength(1);
  });

  it("asks once a second however many places watch one computer", async () => {
    const { poll, asked, tick } = poller();
    poll.setOn("a", true);
    poll.watch("a", () => {});
    poll.watch("a", () => {});
    await tick();
    await tick();
    expect(asked).toHaveLength(2);
  });
});
