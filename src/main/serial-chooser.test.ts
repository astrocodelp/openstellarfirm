import { describe, expect, it } from "vitest";
import type { SerialChoice } from "../shared/types";
import { SerialChooser } from "./serial-chooser";

const nano = (portId: string) => ({
  portId,
  portName: `tty${portId}`,
  vendorId: "9025",
  productId: "112",
});
const other = { portId: "x", vendorId: "4292", productId: "60000" };

function rig(asks = true) {
  const asked: SerialChoice[] = [];
  const timers: { run: () => void; cleared: boolean }[] = [];
  const chooser = new SerialChooser({
    ask: (choice) => {
      asked.push(choice);
      return asks;
    },
    newId: () => `req-${asked.length + 1}`,
    setTimer: (run) => {
      const timer = { run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  return { chooser, asked, timers };
}

describe("the USB chooser", () => {
  it("ends with nothing when no pet board is plugged in", () => {
    const { chooser, asked } = rig();
    const done: string[] = [];
    chooser.select([other], (id) => done.push(id));
    expect(done).toEqual([""]);
    expect(asked).toEqual([]);
  });

  it("takes the one board without asking", () => {
    const { chooser, asked } = rig();
    const done: string[] = [];
    chooser.select([other, nano("a")], (id) => done.push(id));
    expect(done).toEqual(["a"]);
    expect(asked).toEqual([]);
  });

  it("asks the page when there are several, and offers only the boards", () => {
    const { chooser, asked } = rig();
    const done: string[] = [];
    chooser.select([nano("a"), other, nano("b")], (id) => done.push(id));
    expect(done).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.ports.map((p) => p.portId)).toEqual(["a", "b"]);
    chooser.answer(asked[0]?.requestId, "b");
    expect(done).toEqual(["b"]);
  });

  it("refuses an answer that names a port it did not offer", () => {
    const { chooser, asked } = rig();
    const done: string[] = [];
    chooser.select([nano("a"), nano("b")], (id) => done.push(id));
    chooser.answer(asked[0]?.requestId, "x");
    expect(done).toEqual([""]);
  });

  it("ends with nothing on Cancel, on a late answer and on a request nobody made", () => {
    const { chooser, asked } = rig();
    const done: string[] = [];
    chooser.select([nano("a"), nano("b")], (id) => done.push(id));
    chooser.answer("other", "a");
    expect(done).toEqual([]);
    chooser.answer(asked[0]?.requestId, null);
    chooser.answer(asked[0]?.requestId, "a");
    expect(done).toEqual([""]);
  });

  it("ends with nothing when there is no page to ask, or the person does not answer", () => {
    const quiet = rig(false);
    const done: string[] = [];
    quiet.chooser.select([nano("a"), nano("b")], (id) => done.push(id));
    expect(done).toEqual([""]);

    const slow = rig();
    slow.chooser.select([nano("a"), nano("b")], (id) => done.push(id));
    slow.timers[0]?.run();
    expect(done).toEqual(["", ""]);
  });

  it("lets a new ask replace one still waiting", () => {
    const { chooser, asked } = rig();
    const done: string[] = [];
    chooser.select([nano("a"), nano("b")], (id) => done.push(`first:${id}`));
    chooser.select([nano("c"), nano("d")], (id) => done.push(`second:${id}`));
    expect(done).toEqual(["first:"]);
    chooser.answer(asked[1]?.requestId, "d");
    expect(done).toEqual(["first:", "second:d"]);
  });
});
