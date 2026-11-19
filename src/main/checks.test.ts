import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECK_EVERY,
  checkSettings,
  cleanLookFor,
  LOOK_FOR_MAX,
} from "../shared/checks";
import { buildBackup } from "./backup";
import {
  type CheckerDeps,
  CheckScheduler,
  checkMessage,
  dayOf,
  MAX_CHECK_TURNS,
  MAX_CHECKS_A_DAY,
  QUIET_AFTER_START_MS,
  updateNotice,
} from "./checks";
import type { CheckCounters } from "./store";
import { Store } from "./store";

const T0 = new Date(2026, 10, 19, 9, 0, 0);
const minutes = (n: number) => n * 60_000;

/** A scheduler on a clock the test moves by hand. */
function setup(over: Partial<CheckerDeps> = {}) {
  let now = new Date(T0);
  let counters: CheckCounters = { day: "", count: 0, failures: 0 };
  const log = {
    runs: 0,
    gaveUp: 0,
    saved: [] as CheckCounters[],
  };
  const world = {
    on: true,
    main: "main" as string | undefined,
    every: 60 as 15 | 30 | 60 | 180,
    lookFor: "new mail",
    busy: false,
    next: "done" as "done" | "stopped" | "fail",
  };
  const scheduler = new CheckScheduler({
    now: () => new Date(now),
    startedAt: new Date(T0),
    settings: () =>
      checkSettings({
        ...(world.main ? { mainAssistantId: world.main } : {}),
        checkOnItsOwn: world.on,
        checkEvery: world.every,
        checkLookFor: world.lookFor,
      }),
    busy: () => world.busy,
    load: () => ({ ...counters }),
    save: (c) => {
      counters = { ...c };
      log.saved.push({ ...c });
    },
    run: async () => {
      log.runs += 1;
      if (world.next === "fail") throw new Error("model down");
      return world.next;
    },
    giveUp: () => {
      log.gaveUp += 1;
    },
    ...over,
  });
  return {
    scheduler,
    world,
    log,
    counters: () => counters,
    setCounters: (c: CheckCounters) => {
      counters = c;
    },
    at: (ms: number) => {
      now = new Date(T0.getTime() + ms);
    },
  };
}

describe("the check message", () => {
  it("is a fixed sentence plus the person's own words, and says the app started it", () => {
    const text = checkMessage("urgent mail", T0);
    expect(text).toContain("The app started it on its own");
    expect(text).toContain("the person did not type it");
    expect(text).toContain("2026-11-19 09:00");
    expect(text).toContain("Do not try to change, save, send or ask");
    expect(text).toContain("say in your update that it is waiting for them");
    expect(text.endsWith("their own words:\nurgent mail")).toBe(true);
  });

  it("cuts and cleans what the person typed", () => {
    expect(cleanLookFor("  a\u0007b\nc\td  ")).toBe("ab\nc\td");
    expect(cleanLookFor("x".repeat(LOOK_FOR_MAX + 5))).toHaveLength(
      LOOK_FOR_MAX,
    );
    expect(cleanLookFor(5)).toBe("");
    expect(checkMessage("x".repeat(5000), T0).length).toBeLessThan(
      LOOK_FOR_MAX + 1000,
    );
  });

  it("a notice carries the name only, never text from the update", () => {
    expect(updateNotice("Scout")).toBe("Scout has an update");
    expect(updateNotice("Sco\nut")).toBe("Sco ut has an update");
    expect(updateNotice("n".repeat(100))).toBe(
      `${"n".repeat(60)} has an update`,
    );
  });

  it("keeps the model's turns to four", () => {
    expect(MAX_CHECK_TURNS).toBe(4);
  });
});

describe("when a check may start", () => {
  it("runs nothing in the first 60 seconds, then waits one interval from switching on", async () => {
    const t = setup();
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    t.at(QUIET_AFTER_START_MS - 1);
    expect(await t.scheduler.tick()).toBe("quiet");
    t.at(QUIET_AFTER_START_MS);
    expect(await t.scheduler.tick()).toBe("not-due");
    t.at(minutes(59));
    expect(await t.scheduler.tick()).toBe("not-due");
    t.at(minutes(60));
    expect(await t.scheduler.tick()).toBe("ran");
    expect(t.log.runs).toBe(1);
    t.at(minutes(61));
    expect(await t.scheduler.tick()).toBe("not-due");
  });

  it("does nothing while off, with no main assistant, or with nothing to look for", async () => {
    const t = setup();
    t.at(minutes(300));
    t.world.on = false;
    expect(await t.scheduler.tick()).toBe("off");
    t.world.on = true;
    delete t.world.main;
    expect(await t.scheduler.tick()).toBe("off");
    t.world.main = "main";
    t.world.lookFor = "  ";
    expect(await t.scheduler.tick()).toBe("no-text");
    expect(t.log.runs).toBe(0);
  });

  it("runs a slot missed in sleep once, not once for each", async () => {
    const t = setup();
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    t.world.every = 15;
    // The computer slept for ten hours.
    t.at(minutes(600));
    expect(await t.scheduler.tick()).toBe("ran");
    expect(await t.scheduler.tick()).toBe("not-due");
    t.at(minutes(600) + minutes(14));
    expect(await t.scheduler.tick()).toBe("not-due");
    expect(t.log.runs).toBe(1);
  });

  it("is skipped while the assistant is answering or a card waits, and tries again", async () => {
    const t = setup();
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    t.at(minutes(90));
    t.world.busy = true;
    expect(await t.scheduler.tick()).toBe("busy");
    expect(t.log.runs).toBe(0);
    t.world.busy = false;
    expect(await t.scheduler.tick()).toBe("ran");
  });

  it("runs one check at a time", async () => {
    let release = () => {};
    const t = setup({
      run: () =>
        new Promise((resolve) => {
          release = () => resolve("done");
        }),
    });
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    t.at(minutes(90));
    const first = t.scheduler.tick();
    expect(t.scheduler.running).toBe(true);
    t.at(minutes(300));
    expect(await t.scheduler.tick()).toBe("busy");
    await expect(t.scheduler.start()).rejects.toThrow(/already running/);
    release();
    await first;
    expect(t.scheduler.running).toBe(false);
  });

  it("allows at most 48 a day, kept across a restart, and starts again the next day", async () => {
    const t = setup();
    t.world.every = 15;
    t.setCounters({
      day: dayOf(new Date(T0.getTime() + minutes(120))),
      count: MAX_CHECKS_A_DAY,
      failures: 0,
      lastAt: T0.toISOString(),
    });
    t.at(minutes(120));
    expect(await t.scheduler.tick()).toBe("limit");
    await expect(t.scheduler.start()).rejects.toThrow(/Try again tomorrow/);
    // The next day the count starts again.
    t.at(minutes(24 * 60 + 120));
    expect(await t.scheduler.tick()).toBe("ran");
    expect(t.counters().count).toBe(1);
    expect(t.counters().day).toBe(
      dayOf(new Date(T0.getTime() + minutes(1560))),
    );
  });

  it("counts a check before it runs, so a crash in the middle gives no extra one", async () => {
    let during: CheckCounters | undefined;
    const t = setup({
      run: async () => {
        during = t.counters();
        return "done";
      },
    });
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    t.at(minutes(90));
    await t.scheduler.tick();
    expect(during?.count).toBe(1);
    expect(during?.lastAt).toBe(
      new Date(T0.getTime() + minutes(90)).toISOString(),
    );
  });
});

describe("failures", () => {
  it("turns checking off after three in a row, and says so once", async () => {
    const t = setup();
    t.world.every = 15;
    t.world.next = "fail";
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    for (const m of [20, 40]) {
      t.at(minutes(m));
      expect(await t.scheduler.tick()).toBe("ran");
      expect(t.log.gaveUp).toBe(0);
    }
    t.at(minutes(60));
    await t.scheduler.tick();
    expect(t.log.gaveUp).toBe(1);
    expect(t.counters().failures).toBe(0);
  });

  it("a success in between starts the count again", async () => {
    const t = setup();
    t.world.every = 15;
    t.setCounters({ day: "", count: 0, failures: 0, lastAt: T0.toISOString() });
    const order: ("fail" | "done")[] = ["fail", "fail", "done", "fail", "fail"];
    let m = 20;
    for (const next of order) {
      t.world.next = next;
      t.at(minutes(m));
      await t.scheduler.tick();
      m += 20;
    }
    expect(t.log.gaveUp).toBe(0);
    expect(t.counters().failures).toBe(2);
  });

  it("a check the person stopped is not a failure", async () => {
    const t = setup();
    t.world.every = 15;
    t.world.next = "stopped";
    t.setCounters({ day: "", count: 0, failures: 2, lastAt: T0.toISOString() });
    t.at(minutes(20));
    await t.scheduler.tick();
    expect(t.log.gaveUp).toBe(0);
    expect(t.counters().failures).toBe(2);
  });
});

describe("Check now", () => {
  it("works with the switch off, and starts without waiting for the end", async () => {
    const t = setup();
    t.world.on = false;
    t.at(minutes(5));
    await t.scheduler.start();
    await Promise.resolve();
    expect(t.log.runs).toBe(1);
  });

  it("says in a plain sentence why it cannot start", async () => {
    const t = setup();
    delete t.world.main;
    await expect(t.scheduler.start()).rejects.toThrow(
      /Pick the main assistant/,
    );
    t.world.main = "main";
    t.world.lookFor = "";
    await expect(t.scheduler.start()).rejects.toThrow(/what to look for/);
    t.world.lookFor = "x";
    t.world.busy = true;
    await expect(t.scheduler.start()).rejects.toThrow(/busy/);
    expect(t.log.runs).toBe(0);
  });
});

describe("the main assistant in the store", () => {
  let dir: string;
  let store: Store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stellarfirm-open-checks-"));
    store = new Store(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const input = {
    name: "Scout",
    group: "",
    pet: "glim",
    color: "sky",
    brief: "Plan trips.",
    skills: [],
  } as const;

  it("reads a new or old settings file with the defaults", () => {
    const s = checkSettings(store.settings());
    expect(s).toEqual({
      on: false,
      every: 60,
      lookFor: "",
      notify: false,
      unread: false,
    });
    expect([...CHECK_EVERY]).toEqual([15, 30, 60, 180]);
  });

  it("refuses unknown values and keeps the good ones", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    for (const bad of [
      { checkEvery: 5 as never },
      { checkEvery: "60" as never },
      { checkOnItsOwn: "yes" as never },
      { checkNotify: 1 as never },
      { mainAssistantId: 3 as never },
      { mainAssistantId: "not-here" },
      { checkLookFor: "x".repeat(LOOK_FOR_MAX + 1) },
      { checkLookFor: 4 as never },
      { checkUnread: true },
    ])
      expect(() => store.setSettings(bad), JSON.stringify(bad)).toThrow();
    // Not even one of the good values is kept from a bad patch.
    expect(() =>
      store.setSettings({ checkNotify: true, checkEvery: 7 as never }),
    ).toThrow();
    expect(checkSettings(store.settings()).notify).toBe(false);
    // On needs a main assistant.
    expect(() => store.setSettings({ checkOnItsOwn: true })).toThrow(
      /Pick the main assistant/,
    );
    store.setSettings({
      mainAssistantId: a.id,
      checkLookFor: "  urgent  ",
      checkEvery: 15,
      checkNotify: true,
    });
    store.setSettings({ checkOnItsOwn: true });
    expect(checkSettings(new Store(dir).settings())).toEqual({
      mainAssistantId: a.id,
      on: true,
      every: 15,
      lookFor: "urgent",
      notify: true,
      unread: false,
    });
  });

  it("starts the first check one wait after it is switched on, never at once", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    store.setSettings({ mainAssistantId: a.id });
    const before = Date.now();
    store.setSettings({ checkOnItsOwn: true });
    const at = Date.parse(store.checkCounters().lastAt ?? "");
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(store.checkCounters().failures).toBe(0);
  });

  it("drops a setting that does not read, and a main assistant that is gone", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    store.setSettings({ mainAssistantId: a.id });
    store.setSettings({ checkOnItsOwn: true });
    store.removeAssistant(a.id);
    const s = checkSettings(store.settings());
    expect(s.mainAssistantId).toBeUndefined();
    expect(s.on).toBe(false);
    expect(store.settings().mainAssistantId).toBeUndefined();
    // A hand-edited file with junk is read with defaults.
    const edited = new Store(
      mkdtempSync(join(tmpdir(), "stellarfirm-open-checks-")),
    );
    expect(edited.settings()).toBeDefined();
  });

  it("marks an update unread, only for the main assistant, and only the page may clear it", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    const b = store.saveAssistant({ ...input, name: "Other", skills: [] });
    store.setSettings({ mainAssistantId: a.id });
    store.markCheckUpdate(b.id);
    expect(checkSettings(store.settings()).unread).toBe(false);
    store.markCheckUpdate(a.id);
    expect(checkSettings(store.settings()).unread).toBe(true);
    expect(() => store.setSettings({ checkUnread: true })).toThrow();
    store.setSettings({ checkUnread: false });
    expect(checkSettings(store.settings()).unread).toBe(false);
    // Another main assistant starts with nothing unread and checks off.
    store.markCheckUpdate(a.id);
    store.setSettings({ mainAssistantId: b.id });
    const s = checkSettings(store.settings());
    expect(s).toMatchObject({
      mainAssistantId: b.id,
      on: false,
      unread: false,
    });
    store.setSettings({ mainAssistantId: "" });
    expect(checkSettings(store.settings()).mainAssistantId).toBeUndefined();
  });

  it("saves a check and its update marked as a check, with the time", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    const at = new Date("2026-11-19T09:00:00.000Z");
    const request = store.appendMessage(
      a.id,
      "user",
      "ask",
      false,
      [],
      "request",
      at,
    );
    const update = store.appendMessage(
      a.id,
      "assistant",
      "none",
      false,
      [],
      "update",
    );
    expect(request).toMatchObject({
      role: "user",
      check: "request",
      at: at.toISOString(),
    });
    expect(update).toMatchObject({ role: "assistant", check: "update" });
    expect(store.messages(a.id).map((m) => m.check)).toEqual([
      "request",
      "update",
    ]);
  });

  it("travels in no export, backup or persona", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    store.setSettings({
      mainAssistantId: a.id,
      checkLookFor: "SECRET-LOOK-FOR-TEXT",
    });
    store.appendMessage(
      a.id,
      "user",
      "SECRET-LOOK-FOR-TEXT",
      false,
      [],
      "request",
    );
    store.appendMessage(
      a.id,
      "assistant",
      "SECRET-UPDATE",
      false,
      [],
      "update",
    );
    store.appendMessage(a.id, "user", "hello");
    const backup = JSON.stringify(buildBackup(store, true));
    const file = JSON.stringify(store.exportFile(a.id));
    for (const text of [backup, file]) {
      expect(text).not.toContain("SECRET-LOOK-FOR-TEXT");
      expect(text).not.toContain("SECRET-UPDATE");
      expect(text).not.toContain("mainAssistantId");
      expect(text).not.toContain("checkOnItsOwn");
    }
    expect(backup).toContain("hello");
  });
});

describe("personas", () => {
  it("never carry a list of assistants to ask, or anything about checks", () => {
    const dir = join(import.meta.dirname, "../../personas");
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const text = readFileSync(join(dir, name), "utf8");
      expect(text, name).not.toMatch(/canAsk|mainAssistant|checkOnItsOwn/);
    }
  });
});
