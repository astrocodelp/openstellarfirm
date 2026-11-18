import { afterEach, describe, expect, it } from "vitest";
import { type AgentDeps, runAgent } from "./agent";
import {
  ModelError,
  type ToolCall,
  type TurnEvent,
  type WireMessage,
} from "./models";
import {
  type Frame,
  MAX_PICTURE_BYTES,
  PERMISSION_LINE,
  REMOVED_PICTURE,
  SCREEN_TOOL_NAME,
  type ScreenDeps,
  screenAsk,
} from "./screen";
import { forgetTextModes, rememberTextMode } from "./text-tools";
import { toolsFor } from "./tools";
import type { WebDeps } from "./web";

afterEach(() => forgetTextModes());

const callOf = (
  name: string,
  args: unknown = {},
  id = `c-${name}`,
): ToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

/** A frame whose JPEG is `size` bytes of 7, whatever the side or quality. */
const frame = (size = 1000, empty = false): Frame => ({
  empty,
  encode: () => new Uint8Array(size).fill(7),
});

function fakeScreen(over: Partial<ScreenDeps> = {}) {
  const log: string[] = [];
  const deps: ScreenDeps = {
    where: "on this computer",
    platform: "linux",
    permission: () => "granted",
    screens: () => 2,
    capture: async (index) => {
      log.push(`capture:${index}`);
      return frame();
    },
    now: () => new Date(2026, 10, 19, 14, 5),
    ...over,
  };
  return { deps, log };
}

interface Snap {
  role: string;
  content: string;
  image: boolean;
  tools: string[];
}

/** A scripted model. It snapshots each message, since pictures are dropped in place. */
function script(turns: (TurnEvent[] | Error)[]) {
  const seen: Snap[][] = [];
  const live: WireMessage[][] = [];
  let index = 0;
  return {
    seen,
    live,
    async *turn(
      messages: WireMessage[],
      tools: { name: string }[],
    ): AsyncGenerator<TurnEvent> {
      live.push(messages);
      seen.push(
        messages.map((m) => ({
          role: m.role,
          content: m.content,
          image: m.role === "tool" && m.image !== undefined,
          tools: tools.map((t) => t.name),
        })),
      );
      const next = turns[index++] ?? [];
      if (next instanceof Error) throw next;
      for (const event of next) yield event;
    },
  };
}

const look = (id = "c1", args: unknown = {}): TurnEvent[] => [
  { type: "calls", calls: [callOf(SCREEN_TOOL_NAME, args, id)] },
];
const say = (text: string): TurnEvent[] => [{ type: "text", text }];

function deps(
  model: ReturnType<typeof script>,
  over: Partial<AgentDeps> = {},
): AgentDeps & { asks: string[] } {
  const asks: string[] = [];
  return {
    asks,
    turn: model.turn as AgentDeps["turn"],
    ask: async (ask) => {
      asks.push(ask.title);
      return "approve";
    },
    allowSite: () => {},
    onText: () => {},
    onActivity: () => {},
    signal: new AbortController().signal,
    ...over,
  };
}

const on = { folders: [], web: false, sites: [], screen: true };

describe("the screen tool is offered only with the switch", () => {
  it("is in the list only when the switch is on", () => {
    expect(toolsFor({ folders: [], web: false, sites: [] })).toEqual([]);
    expect(
      toolsFor({ folders: [], web: false, sites: [], screen: false }),
    ).toEqual([]);
    expect(toolsFor(on).map((t) => t.name)).toEqual([SCREEN_TOOL_NAME]);
  });

  it("takes no argument but an optional screen number", () => {
    const [tool] = toolsFor(on);
    const params = tool?.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(params.properties)).toEqual(["display"]);
    expect(params.required).toBeUndefined();
  });

  it("refuses the call outright when the switch is off", async () => {
    const { deps: screen, log } = fakeScreen();
    const model = script([look(), say("ok")]);
    const d = deps(model, { screen });
    const result = await runAgent(
      { folders: [], web: false, sites: [] },
      [],
      d,
    );
    expect(log).toEqual([]);
    expect(d.asks).toEqual([]);
    expect(result.steps[0]?.ok).toBe(false);
  });

  it("is never offered to a model that asks for tools in writing", async () => {
    rememberTextMode("s\nm");
    const { deps: screen } = fakeScreen();
    const model = script([say("no tools")]);
    await runAgent(
      { folders: [], web: true, sites: [], screen: true },
      [{ role: "system", content: "S" }],
      { ...deps(model, { screen }), modeKey: "s\nm" },
    );
    expect(model.seen[0]?.[0]?.content).not.toContain(SCREEN_TOOL_NAME);
    expect(model.seen[0]?.[0]?.tools).toEqual([]);
  });

  it("goes on without tools when the screen is all a model refuses", async () => {
    const { deps: screen } = fakeScreen();
    const model = script([new ModelError("no tools", 400), say("Hello.")]);
    const result = await runAgent(on, [], {
      ...deps(model, { screen }),
      modeKey: "a\nb",
    });
    expect(result.text).toBe("Hello.");
    expect(result.steps[0]?.label).toContain("cannot look at the screen");
  });
});

describe("every look asks, and takes the picture only after", () => {
  it("asks, then captures, in that order", async () => {
    const { deps: screen, log } = fakeScreen();
    const model = script([look(), say("I see it.")]);
    const d = deps(model, {
      screen,
      ask: async () => {
        log.push("ask");
        return "approve";
      },
    });
    const result = await runAgent(on, [], d);
    expect(log).toEqual(["ask", "capture:0"]);
    expect(result.text).toBe("I see it.");
    expect(result.steps).toEqual([
      { label: "Looked at the screen at 14:05", ok: true },
    ]);
  });

  it("says where the picture goes and to close anything private", () => {
    const local = screenAsk("on this computer");
    expect(local.title).toContain("look at your screen now");
    expect(local.detail).toContain("on this computer");
    expect(local.why).toContain("Close anything private");
    expect("site" in local).toBe(false);
    expect(screenAsk("OpenAI").detail).toContain("OpenAI");
  });

  it("asks again every time, and an 'always' remembers nothing", async () => {
    const { deps: screen, log } = fakeScreen();
    const model = script([look("a"), look("b"), say("done")]);
    const allowed: string[] = [];
    const assistant = { ...on, sites: [] as string[] };
    const d = deps(model, {
      screen,
      allowSite: (site) => allowed.push(site),
      ask: async () => {
        log.push("ask");
        // The page sends "always", though the card has no button for it.
        return "always";
      },
    });
    await runAgent(assistant, [], d);
    expect(log).toEqual(["ask", "capture:0", "ask", "capture:0"]);
    expect(allowed).toEqual([]);
    expect(assistant.sites).toEqual([]);
  });

  it("does not capture when the person says no, and tells the model so", async () => {
    const { deps: screen, log } = fakeScreen();
    const model = script([look(), say("Alright.")]);
    const result = await runAgent(on, [], {
      ...deps(model, { screen }),
      ask: async () => "reject",
    });
    expect(log).toEqual([]);
    expect(model.seen[1]?.at(-1)?.content).toContain("said no");
    expect(model.seen[1]?.at(-1)?.image).toBe(false);
    expect(result.steps).toEqual([
      { label: "You said no: Look at your screen", ok: false },
    ]);
  });

  it("looks at the main screen by default and at another by number", async () => {
    const { deps: screen, log } = fakeScreen();
    const model = script([look("a"), look("b", { display: 2 }), say("done")]);
    await runAgent(on, [], deps(model, { screen }));
    expect(log).toEqual(["capture:0", "capture:1"]);
  });

  it("says plainly when a screen number does not exist", async () => {
    const { deps: screen, log } = fakeScreen();
    const model = script([look("a", { display: 5 }), say("done")]);
    const d = deps(model, { screen });
    await runAgent(on, [], d);
    expect(d.asks).toEqual([]);
    expect(log).toEqual([]);
    expect(model.seen[1]?.at(-1)?.content).toContain("There is no screen 5");
  });

  it("stops at once when the answer is stopped while it waits", async () => {
    const { deps: screen, log } = fakeScreen();
    const controller = new AbortController();
    const model = script([look(), say("never")]);
    await expect(
      runAgent(on, [], {
        ...deps(model, { screen }),
        signal: controller.signal,
        ask: async () => {
          controller.abort();
          return "approve";
        },
      }),
    ).rejects.toThrow("Stopped.");
    expect(log).toEqual([]);
  });
});

describe("the system's permission and the picture's limits", () => {
  const run = async (screen: ScreenDeps) => {
    const model = script([look(), say("done")]);
    const d = deps(model, { screen });
    const result = await runAgent(on, [], d);
    return { model, d, result };
  };

  it("on a Mac without permission, fails with the plain line and asks nothing", async () => {
    for (const status of ["denied", "restricted", "unknown"]) {
      const { deps: screen, log } = fakeScreen({
        platform: "darwin",
        permission: () => status,
      });
      const { model, d, result } = await run(screen);
      expect(d.asks).toEqual([]);
      expect(log).toEqual([]);
      const told = model.seen[1]?.at(-1)?.content ?? "";
      expect(told).toContain("System Settings");
      expect(told).toContain("Privacy & Security");
      expect(told).toContain("Screen Recording");
      expect(told).toContain(PERMISSION_LINE);
      expect(result.steps[0]?.ok).toBe(false);
    }
  });

  it("asks the system for the permission while it is undecided", async () => {
    let asked = 0;
    const { deps: screen } = fakeScreen({
      platform: "darwin",
      permission: () => "not-determined",
      askPermission: async () => {
        asked += 1;
      },
    });
    await run(screen);
    expect(asked).toBe(1);
  });

  it("looks when the permission is granted, and ignores it off a Mac", async () => {
    const mac = fakeScreen({ platform: "darwin", permission: () => "granted" });
    await run(mac.deps);
    expect(mac.log).toEqual(["capture:0"]);
    const linux = fakeScreen({
      platform: "linux",
      permission: () => {
        throw new Error("not asked off a Mac");
      },
    });
    await run(linux.deps);
    expect(linux.log).toEqual(["capture:0"]);
  });

  it("says plainly when the capture comes back empty", async () => {
    const { deps: screen } = fakeScreen({
      capture: async () => frame(0, true),
    });
    const { model, result } = await run(screen);
    expect(model.seen[1]?.at(-1)?.content).toContain("came back empty");
    expect(model.seen[1]?.at(-1)?.image).toBe(false);
    expect(result.steps[0]?.ok).toBe(false);
  });

  it("makes the picture smaller until it fits the cap", async () => {
    const tried: [number, number][] = [];
    const big: Frame = {
      empty: false,
      encode: (side, quality) => {
        tried.push([side, quality]);
        return new Uint8Array(side <= 1024 ? 900_000 : MAX_PICTURE_BYTES + 1);
      },
    };
    const { deps: screen } = fakeScreen({ capture: async () => big });
    const { model } = await run(screen);
    expect(tried[0]).toEqual([1568, 80]);
    expect(tried.at(-1)?.[0]).toBe(1024);
    expect(model.seen[1]?.at(-1)?.image).toBe(true);
  });

  it("fails with a plain line when nothing fits", async () => {
    const huge: Frame = {
      empty: false,
      encode: () => new Uint8Array(MAX_PICTURE_BYTES + 1),
    };
    const { deps: screen } = fakeScreen({ capture: async () => huge });
    const { model } = await run(screen);
    expect(model.seen[1]?.at(-1)?.content).toContain("too large");
    expect(model.seen[1]?.at(-1)?.image).toBe(false);
  });
});

describe("what the screen does to later calls and to memory", () => {
  const web: WebDeps = {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    get: async () => ({ status: 200, type: "text/plain", body: "page" }),
  };
  const read = (id: string): TurnEvent[] => [
    {
      type: "calls",
      calls: [callOf("read_web_page", { url: "https://example.org/a" }, id)],
    },
  ];
  const assistant = {
    folders: [],
    web: true,
    sites: ["example.org"],
    screen: true,
  };

  it("lets an allowed site be read with no ask before a look", async () => {
    const { deps: screen } = fakeScreen();
    const model = script([read("a"), say("done")]);
    const d = deps(model, { screen, web });
    await runAgent({ ...assistant, sites: ["example.org"] }, [], d);
    expect(d.asks).toEqual([]);
  });

  it("asks again for that site once the answer has looked at the screen", async () => {
    const { deps: screen } = fakeScreen();
    const model = script([look("a"), read("b"), say("done")]);
    const asked: { title: string; why: string }[] = [];
    await runAgent({ ...assistant, sites: ["example.org"] }, [], {
      ...deps(model, { screen, web }),
      ask: async (ask) => {
        asked.push({ title: ask.title, why: ask.why });
        return "approve";
      },
    });
    expect(asked.map((a) => a.title)).toEqual([
      "Your assistant wants to look at your screen now",
      "Read a page on example.org",
    ]);
    expect(asked[1]?.why).toContain("looked at your screen");
  });

  it("sends only the newest picture on", async () => {
    const { deps: screen } = fakeScreen();
    const model = script([look("a"), look("b"), look("c"), say("done")]);
    await runAgent(on, [], deps(model, { screen }));
    const last = model.seen[3] ?? [];
    const tools = last.filter((m) => m.role === "tool");
    expect(tools.map((m) => m.image)).toEqual([false, false, true]);
    expect(tools[0]?.content).toBe(REMOVED_PICTURE);
    expect(tools[1]?.content).toBe(REMOVED_PICTURE);
    expect(tools[2]?.content).toContain(
      "The screen was captured. The picture follows.",
    );
  });

  it("keeps no picture in memory or in the result once the answer ends", async () => {
    const { deps: screen } = fakeScreen({ capture: async () => frame(2000) });
    const model = script([look(), say("I see a window.")]);
    const result = await runAgent(on, [], deps(model, { screen }));
    const data = Buffer.from(new Uint8Array(2000).fill(7)).toString("base64");
    for (const messages of model.live) {
      expect(JSON.stringify(messages)).not.toContain(data.slice(0, 40));
    }
    expect(JSON.stringify(result)).not.toContain(data.slice(0, 40));
    expect(result.steps).toEqual([
      { label: "Looked at the screen at 14:05", ok: true },
    ]);
  });

  it("goes on without the picture, once, for a model that cannot read pictures", async () => {
    const { deps: screen } = fakeScreen();
    const model = script([
      look(),
      new ModelError("no images", 400),
      say("I could not see it."),
    ]);
    const result = await runAgent(on, [], deps(model, { screen }));
    expect(result.text).toBe("I could not see it.");
    expect(model.seen).toHaveLength(3);
    expect(model.seen[2]?.at(-1)?.image).toBe(false);
    expect(model.seen[2]?.at(-1)?.content).toContain("cannot read pictures");
    expect(result.steps).toEqual([
      { label: "Looked at the screen at 14:05", ok: true },
      { label: "This model cannot read pictures", ok: false },
    ]);
  });

  it("does not loop when the model still refuses", async () => {
    const { deps: screen } = fakeScreen();
    const model = script([
      look(),
      new ModelError("no images", 400),
      new ModelError("still no", 400),
      say("never"),
    ]);
    await expect(runAgent(on, [], deps(model, { screen }))).rejects.toThrow(
      "still no",
    );
    expect(model.seen).toHaveLength(3);
  });
});
