import { describe, expect, it, vi } from "vitest";
import { LATEST_RELEASE_API } from "../shared/links";
import type { Settings } from "../shared/types";
import {
  CHECK_EVERY_MS,
  isDue,
  lookForUpdate,
  MAX_ANSWER_BYTES,
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
  const instance = new UpdateChecker({
    fetch: fetchFn,
    now: () => now,
    version: "0.1.0",
    settings: () => ({ ...base, ...settings }),
    record,
  });
  return { instance, record };
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
    expect(await instance.check(false)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("checks once a day when the switch is on, and keeps what it found", async () => {
    const fetchFn = vi.fn(async () => answer());
    const now = new Date("2026-11-19T10:00:00Z");
    const first = checker({ checkUpdates: true }, fetchFn as never, now);
    expect(await first.instance.check(false)).toEqual({
      status: "newer",
      version: "0.2.0",
    });
    expect(first.record).toHaveBeenCalledWith(now, "0.2.0");

    const soon = checker(
      { checkUpdates: true, lastUpdateCheck: now.toISOString() },
      fetchFn as never,
      new Date(now.getTime() + CHECK_EVERY_MS - 1000),
    );
    expect(await soon.instance.check(false)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const later = checker(
      { checkUpdates: true, lastUpdateCheck: now.toISOString() },
      fetchFn as never,
      new Date(now.getTime() + CHECK_EVERY_MS),
    );
    expect(await later.instance.check(false)).not.toBeNull();
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
    expect(await instance.check(true)).toEqual({
      status: "newer",
      version: "0.2.0",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps the time after a failure, forgets a version when current, and survives a bad disk", async () => {
    const failing = checker({ checkUpdates: true }, (async () => {
      throw new Error("offline");
    }) as never);
    expect(await failing.instance.check(false)).toEqual({ status: "unknown" });
    expect(failing.record).toHaveBeenCalledWith(expect.any(Date));
    expect(failing.record.mock.calls[0]).toHaveLength(1);

    const current = checker({}, (async () =>
      json({ tag_name: "v0.1.0" })) as never);
    await current.instance.check(true);
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
    expect(await broken.check(true)).toMatchObject({ status: "newer" });
  });

  it("does not ask twice at once", async () => {
    const fetchFn = vi.fn(async () => answer());
    const { instance } = checker({}, fetchFn as never);
    await Promise.all([instance.check(true), instance.check(true)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("treats a bad or future time as due", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(isDue(undefined, now)).toBe(true);
    expect(isDue("garbage", now)).toBe(true);
    expect(isDue("2030-01-01T00:00:00Z", now)).toBe(true);
  });
});
