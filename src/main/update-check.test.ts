import { describe, expect, it, vi } from "vitest";
import { LATEST_RELEASE_API } from "../shared/links";
import type { Settings } from "../shared/types";
import {
  CHECK_EVERY_MS,
  isDue,
  LAUNCH_DELAY_MS,
  LAUNCH_GAP_MS,
  lookForUpdate,
  MAX_ANSWER_BYTES,
  scheduleUpdateChecks,
  UpdateChecker,
} from "./update-check";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

const base: Settings = {
  onboarded: true,
  theme: "system",
  textSize: "default",
  sendWith: "enter",
  checkUpdates: false,
};

function checker(
  settings: Partial<Settings>,
  fetchFn: typeof fetch,
  now = new Date("2026-11-19T10:00:00Z"),
) {
  const record = vi.fn();
  const notify = vi.fn();
  const markNotified = vi.fn();
  const instance = new UpdateChecker({
    fetch: fetchFn,
    now: () => now,
    version: "0.1.0",
    settings: () => ({ ...base, ...settings }),
    record,
    notify,
    markNotified,
  });
  return { instance, record, notify, markNotified };
}

/**
 * A checker over settings kept the way the store keeps them, so what one
 * check records is what the next one reads. The clock is moved by hand.
 */
function living(settings: Partial<Settings>, fetchFn: typeof fetch) {
  const kept: Settings = { ...base, ...settings };
  const clock = { now: new Date("2026-11-19T10:00:00Z") };
  const notify = vi.fn();
  const make = () =>
    new UpdateChecker({
      fetch: fetchFn,
      now: () => clock.now,
      version: "0.1.0",
      settings: () => ({ ...kept }),
      record: (at, newest) => {
        kept.lastUpdateCheck = at.toISOString();
        if (newest === null) delete kept.newestVersion;
        else if (newest !== undefined) kept.newestVersion = newest;
      },
      markNotified: (version) => {
        kept.notifiedVersion = version;
      },
      notify,
    });
  const later = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { kept, make, later, notify };
}

describe("the request", () => {
  it("asks the one fixed address, with nothing about the person", async () => {
    const fetchFn = vi.fn(async () => json({ tag_name: "v0.1.0" }));
    await lookForUpdate(fetchFn as unknown as typeof fetch, "0.1.0");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(LATEST_RELEASE_API);
    expect(url).toBe(
      "https://api.github.com/repos/astrocodelp/openstellarfirm/releases/latest",
    );
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({
      Accept: "application/vnd.github+json",
      "User-Agent": "OpenStellarFirm/0.1.0",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the answer", () => {
  const ask = (answer: () => Promise<Response>, version = "0.1.0") =>
    lookForUpdate((async () => answer()) as unknown as typeof fetch, version);

  it("finds a newer version, and compares numbers", async () => {
    expect(
      await ask(async () => json({ tag_name: "v0.10.0" }), "0.9.9"),
    ).toEqual({ status: "newer", version: "0.10.0" });
  });

  it("says current for the same or an older release", async () => {
    expect(await ask(async () => json({ tag_name: "v0.1.0" }))).toEqual({
      status: "current",
    });
    expect(await ask(async () => json({ tag_name: "v0.0.9" }))).toEqual({
      status: "current",
    });
  });

  it("says current when no release exists yet", async () => {
    expect(await ask(async () => new Response("", { status: 404 }))).toEqual({
      status: "current",
    });
  });

  it("never turns a hostile answer into a version", async () => {
    const hostile: (() => Promise<Response>)[] = [
      async () => json({ tag_name: "v1.0.0/../../x" }),
      async () => json({ tag_name: "v1.0.0 https://evil.example/a" }),
      async () => json({ tag_name: "v1.0.0-rc.1" }),
      async () => json({ tag_name: "1.0.0" }),
      async () => json({ tag_name: 7 }),
      async () => json({ html_url: "https://evil.example", tag_name: null }),
      async () => json(["v9.9.9"]),
      async () => json("v9.9.9"),
      async () => json(null),
      async () => new Response("not json", { status: 200 }),
      async () => json({ tag_name: "v9.9.9" }, { status: 500 }),
      async () => {
        throw new TypeError("redirect mode is set to error");
      },
    ];
    for (const answer of hostile)
      expect(await ask(answer)).toEqual({ status: "unknown" });
  });

  it("gives up on a body past the cap, however it is sent", async () => {
    const huge = `{"tag_name":"v9.9.9","pad":"${"x".repeat(MAX_ANSWER_BYTES)}"}`;
    expect(await ask(async () => new Response(huge))).toEqual({
      status: "unknown",
    });
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    expect(await ask(async () => new Response(stream))).toEqual({
      status: "unknown",
    });
  });

  it("treats a redirected answer as unknown", async () => {
    const redirected = json({ tag_name: "v9.9.9" });
    Object.defineProperty(redirected, "redirected", { value: true });
    expect(await ask(async () => redirected)).toEqual({ status: "unknown" });
  });

  it("gives up at the deadline", async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("late")));
      })) as unknown as typeof fetch;
    expect(await lookForUpdate(slow, "0.1.0", 20)).toEqual({
      status: "unknown",
    });
  });
});

describe("when it runs", () => {
  const answer = () => json({ tag_name: "v0.2.0" });

  it("makes no call while the switch is off", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { instance, record } = checker({}, fetchFn as never);
    expect(await instance.check("daily")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("checks once a day when the switch is on, and keeps what it found", async () => {
    const fetchFn = vi.fn(async () => answer());
    const now = new Date("2026-11-19T10:00:00Z");
    const first = checker({ checkUpdates: true }, fetchFn as never, now);
    expect(await first.instance.check("daily")).toEqual({
      status: "newer",
      version: "0.2.0",
    });
    expect(first.record).toHaveBeenCalledWith(now, "0.2.0");

    const soon = checker(
      { checkUpdates: true, lastUpdateCheck: now.toISOString() },
      fetchFn as never,
      new Date(now.getTime() + CHECK_EVERY_MS - 1000),
    );
    expect(await soon.instance.check("daily")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const later = checker(
      { checkUpdates: true, lastUpdateCheck: now.toISOString() },
      fetchFn as never,
      new Date(now.getTime() + CHECK_EVERY_MS),
    );
    expect(await later.instance.check("daily")).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("checks on a click whether the switch is on or off, even within a day", async () => {
    const fetchFn = vi.fn(async () => answer());
    const now = new Date("2026-11-19T10:00:00Z");
    const { instance } = checker(
      { checkUpdates: false, lastUpdateCheck: now.toISOString() },
      fetchFn as never,
      now,
    );
    expect(await instance.check("manual")).toEqual({
      status: "newer",
      version: "0.2.0",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps the time after a failure, forgets a version when current, and survives a bad disk", async () => {
    const failing = checker({ checkUpdates: true }, (async () => {
      throw new Error("offline");
    }) as never);
    expect(await failing.instance.check("daily")).toEqual({
      status: "unknown",
    });
    expect(failing.record).toHaveBeenCalledWith(expect.any(Date));
    expect(failing.record.mock.calls[0]).toHaveLength(1);

    const current = checker({}, (async () =>
      json({ tag_name: "v0.1.0" })) as never);
    await current.instance.check("manual");
    expect(current.record).toHaveBeenCalledWith(expect.any(Date), null);

    const broken = new UpdateChecker({
      fetch: (async () => answer()) as never,
      now: () => new Date(),
      version: "0.1.0",
      settings: () => base,
      record: () => {
        throw new Error("disk full");
      },
    });
    expect(await broken.check("manual")).toMatchObject({ status: "newer" });
  });

  it("does not ask twice at once", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { instance } = checker({}, fetchFn as never);
    await Promise.all([instance.check("manual"), instance.check("manual")]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("treats a bad or future time as due", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(isDue(undefined, now)).toBe(true);
    expect(isDue("garbage", now)).toBe(true);
    expect(isDue("2030-01-01T00:00:00Z", now)).toBe(true);
  });
});

describe("at every launch", () => {
  const answer = () => json({ tag_name: "v0.2.0" });

  it("checks once after start even within a day, and only once in a run", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { make, later } = living({ checkUpdates: true }, fetchFn as never);
    await make().check("daily");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    later(2 * 60 * 60 * 1000);
    // A new start of the app, two hours on: the day has not passed, it still asks.
    const run = make();
    expect(await run.check("launch")).toEqual({
      status: "newer",
      version: "0.2.0",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    later(2 * 60 * 60 * 1000);
    expect(await run.check("launch")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("asks nothing when the app starts again within ten minutes", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { make, later } = living({ checkUpdates: true }, fetchFn as never);
    await make().check("launch");
    later(LAUNCH_GAP_MS - 1000);
    expect(await make().check("launch")).toBeNull();
    later(1000);
    expect(await make().check("launch")).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("makes no call while the switch is off", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { instance, record } = checker({}, fetchFn as never);
    expect(await instance.check("launch")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("then checks once a day while the app stays open", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { make, later } = living({ checkUpdates: true }, fetchFn as never);
    const run = make();
    await run.check("launch");
    later(CHECK_EVERY_MS - 60 * 1000);
    expect(await run.check("daily")).toBeNull();
    later(60 * 1000);
    expect(await run.check("daily")).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("is scheduled a few seconds after start, then looks every hour", () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(async () => null);
      scheduleUpdateChecks({ check } as unknown as UpdateChecker);
      vi.advanceTimersByTime(LAUNCH_DELAY_MS - 1);
      expect(check).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(check).toHaveBeenLastCalledWith("launch");
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(check).toHaveBeenLastCalledWith("daily");
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the notice", () => {
  it("tells about a new version once, never again after a restart", async () => {
    let tag = "v0.2.0";
    const fetchFn = vi.fn(async () => json({ tag_name: tag }));
    const { kept, make, later, notify } = living(
      { checkUpdates: true },
      fetchFn as never,
    );
    await make().check("launch");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("0.2.0");
    expect(kept.notifiedVersion).toBe("0.2.0");
    later(LAUNCH_GAP_MS);
    await make().check("launch");
    later(CHECK_EVERY_MS);
    await make().check("daily");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledTimes(1);
    // A newer one still gets its own notice.
    tag = "v0.3.0";
    later(CHECK_EVERY_MS);
    await make().check("daily");
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith("0.3.0");
  });

  it("is never shown for a click on Check now, which counts as told", async () => {
    const fetchFn = vi.fn(async () => json({ tag_name: "v0.2.0" }));
    const { kept, make, later, notify } = living(
      { checkUpdates: true },
      fetchFn as never,
    );
    await make().check("manual");
    expect(notify).not.toHaveBeenCalled();
    expect(kept.notifiedVersion).toBe("0.2.0");
    later(LAUNCH_GAP_MS);
    await make().check("launch");
    expect(notify).not.toHaveBeenCalled();
  });

  it("is not shown when turned off, for a dismissed version, or for no newer one", async () => {
    const newer = (async () => json({ tag_name: "v0.2.0" })) as never;
    const off = checker({ checkUpdates: true, updateNotify: false }, newer);
    await off.instance.check("launch");
    expect(off.notify).not.toHaveBeenCalled();
    expect(off.markNotified).not.toHaveBeenCalled();

    const dismissed = checker(
      { checkUpdates: true, dismissedVersion: "0.2.0" },
      newer,
    );
    await dismissed.instance.check("launch");
    expect(dismissed.notify).not.toHaveBeenCalled();

    const told = checker(
      { checkUpdates: true, notifiedVersion: "0.3.0" },
      newer,
    );
    await told.instance.check("launch");
    expect(told.notify).not.toHaveBeenCalled();

    const current = checker({ checkUpdates: true }, (async () =>
      json({ tag_name: "v0.1.0" })) as never);
    await current.instance.check("launch");
    expect(current.notify).not.toHaveBeenCalled();
  });

  it("shows nothing when the told-about version cannot be kept, so it never repeats", async () => {
    const notify = vi.fn();
    const instance = new UpdateChecker({
      fetch: (async () => json({ tag_name: "v0.2.0" })) as never,
      now: () => new Date("2026-11-19T10:00:00Z"),
      version: "0.1.0",
      settings: () => ({ ...base, checkUpdates: true }),
      record: () => undefined,
      markNotified: () => {
        throw new Error("disk full");
      },
      notify,
    });
    expect(await instance.check("launch")).toMatchObject({ status: "newer" });
    expect(notify).not.toHaveBeenCalled();
  });
});
