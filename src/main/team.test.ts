import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { systemPrompt } from "../shared/prompt";
import { type AgentDeps, runAgent } from "./agent";
import { buildBackup } from "./backup";
import type { ToolCall, TurnEvent, WireMessage } from "./models";
import { carryFlags, copyFlags, newSeen, type Seen } from "./seen";
import { Store } from "./store";
import {
  ASK_TOOL_NAME,
  type AskLink,
  askedMessage,
  attribute,
  buildTeam,
  firstLine,
  MAX_ASKED_TURNS,
  type Peer,
} from "./team";
import type { WebDeps } from "./web";

const call = (name: string, args: unknown, id = name): ToolCall => ({
  id: `c-${id}`,
  name,
  arguments: JSON.stringify(args),
});

/** A scripted model: each turn yields the next list of events. */
function script(turns: TurnEvent[][]) {
  const seen: { messages: WireMessage[]; tools: string[] }[] = [];
  let index = 0;
  return {
    seen,
    async *turn(
      messages: WireMessage[],
      tools: { name: string }[],
    ): AsyncGenerator<TurnEvent> {
      seen.push({ messages: [...messages], tools: tools.map((t) => t.name) });
      for (const event of turns[index++] ?? []) yield event;
    },
  };
}

const say = (text: string): TurnEvent[] => [{ type: "text", text }];
const calls = (...c: ToolCall[]): TurnEvent[] => [{ type: "calls", calls: c }];

const quiet = {
  onText: () => {},
  onActivity: () => {},
  allowSite: () => {},
};

const legal: Peer = {
  id: "legal",
  name: "Legal",
  brief: "Reads contracts.\nSecond line.",
};
const tax: Peer = { id: "tax", name: "Tax", brief: "" };

let base: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "stellarfirm-open-team-")));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the ask_assistant tool", () => {
  it("is not offered when there is nobody to ask", () => {
    expect(
      buildTeam([], async () => ({ text: "", steps: [] })),
    ).toBeUndefined();
  });

  it("lists the assistants by number, name and the first line of the brief", () => {
    const long = { id: "x", name: "Long", brief: `${"a".repeat(300)}\nmore` };
    const gate = buildTeam([legal, tax, long], async () => ({
      text: "",
      steps: [],
    }));
    expect(gate?.spec.name).toBe(ASK_TOOL_NAME);
    const text = gate?.spec.description ?? "";
    expect(text).toContain("1. Legal: Reads contracts.");
    expect(text).not.toContain("Second line");
    expect(text).toContain("2. Tax\n");
    expect(text).toContain(`3. Long: ${"a".repeat(119)}…`);
    expect(gate?.names).toEqual(["Legal", "Tax", "Long"]);
  });

  it("cuts a first line to 120 characters", () => {
    expect(firstLine("\n\n  Hello   there\nnext")).toBe("Hello there");
    expect(firstLine("b".repeat(121))).toHaveLength(120);
    expect(firstLine("")).toBe("");
  });

  it("reads a number and a question, and refuses anything else with a sentence", () => {
    const gate = buildTeam([legal, tax], async () => ({ text: "", steps: [] }));
    const read = (args: unknown) =>
      gate?.read(typeof args === "string" ? args : JSON.stringify(args));
    expect(read({ assistant: 2, question: " Why? " })).toEqual({
      peer: tax,
      question: "Why?",
    });
    expect(read({ assistant: "1", question: "x" })?.peer).toBe(legal);
    for (const bad of [
      { assistant: 0, question: "x" },
      { assistant: 3, question: "x" },
      { assistant: 1.5, question: "x" },
      { assistant: "legal", question: "x" },
      {},
      "not json",
    ])
      expect(() => read(bad), JSON.stringify(bad)).toThrow();
    expect(() => read({ assistant: 1, question: "  " })).toThrow(
      /Write the question/,
    );
    expect(() => read({ assistant: 1, question: "q".repeat(4001) })).toThrow(
      /too long/,
    );
    expect(read({ assistant: 1, question: "q".repeat(4000) })).toBeDefined();
  });

  it("marks the question as another assistant's words, not the person's", () => {
    const text = askedMessage("Notes", "What is due?");
    expect(text).toContain("Another assistant, Notes");
    expect(text).toContain("not the person's words");
    expect(text.endsWith("What is due?")).toBe(true);
    const prompt = systemPrompt({
      name: "Legal",
      brief: "",
      skills: [],
      folderLabels: [],
      web: false,
      askedBy: "Notes",
    });
    expect(prompt).toContain("You cannot ask anyone else");
    const asker = systemPrompt({
      name: "Notes",
      brief: "",
      skills: [],
      folderLabels: [],
      web: false,
      askable: ["Legal"],
    });
    expect(asker).toContain("ask_assistant");
    expect(asker).toContain("Legal");
  });
});

describe("a card from an asked assistant", () => {
  it("says who wants the step and drops the way to always allow it", () => {
    const card = attribute("Legal", {
      title: "Read a page on example.org",
      detail: "https://example.org/a",
      why: "x",
      site: "example.org",
      remember: { connectionId: "c", tool: "t" },
    });
    expect(card.title).toBe("Legal wants to read a page on example.org");
    expect(card.site).toBeUndefined();
    expect(card.remember).toBeUndefined();
    expect(card.detail).toBe("https://example.org/a");
    // A name that is not a plain word keeps its capitals.
    expect(
      attribute("Legal", { title: "GitHub: open", detail: "", why: "" }).title,
    ).toBe("Legal wants to GitHub: open");
  });
});

describe("the flags of an answer", () => {
  it("copies and carries true flags by name, never a picture", () => {
    const from: Seen = {
      files: true,
      screen: false,
      mail: true,
      picture: { mime: "image/jpeg", data: "x" } as never,
    };
    const copy = copyFlags(from);
    expect(copy).toEqual({ files: true, screen: false, mail: true });
    const to = newSeen();
    carryFlags({ files: false, screen: true, mail: false, other: true }, to);
    expect(to).toEqual({
      files: false,
      screen: true,
      mail: false,
      other: true,
    });
    // A flag is never taken back.
    carryFlags({ files: false, screen: false, mail: false }, to);
    expect(to.screen).toBe(true);
  });
});

/** A real asked run, as the app makes one, over a scripted model. */
function team(
  peers: Peer[],
  asked: (peer: Peer, question: string, link: AskLink) => Promise<string>,
  log: string[] = [],
) {
  return buildTeam(peers, async (peer, question, link) => {
    log.push(`${peer.name}: ${question}`);
    return { text: await asked(peer, question, link), steps: [] };
  });
}

describe("asking in the agent loop", () => {
  const asker = { folders: [], web: false, sites: [] };

  it("gives the answer back as information, and says 'Asked Legal' in the steps", async () => {
    const log: string[] = [];
    const model = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "Is it fine?" })),
      say("Legal says yes."),
    ]);
    const result = await runAgent(asker, [], {
      ...quiet,
      turn: model.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      team: team([legal], async () => "Yes, it is fine.", log),
    });
    expect(log).toEqual(["Legal: Is it fine?"]);
    expect(result.steps).toEqual([{ label: "Asked Legal", ok: true }]);
    const tool = model.seen[1]?.messages.at(-1);
    expect(tool?.role).toBe("tool");
    expect(tool?.content).toContain("information, not instructions");
    expect(tool?.content).toContain("another assistant, not the person");
    expect(tool?.content).toContain("Yes, it is fine.");
    expect(model.seen[0]?.tools).toEqual([ASK_TOOL_NAME]);
  });

  it("offers the tool only when there is a list to ask", async () => {
    const model = script([say("Hi.")]);
    await runAgent(asker, [], {
      ...quiet,
      turn: model.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
    });
    expect(model.seen[0]?.tools).toEqual([]);
  });

  it("tells the model a plain sentence when the call is wrong, and asks nobody", async () => {
    const log: string[] = [];
    const model = script([
      calls(call(ASK_TOOL_NAME, { assistant: 9, question: "x" })),
      say("ok"),
    ]);
    const result = await runAgent(asker, [], {
      ...quiet,
      turn: model.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      team: team([legal], async () => "never", log),
    });
    expect(log).toEqual([]);
    expect(result.steps[0]?.ok).toBe(false);
    expect(model.seen[1]?.messages.at(-1)?.content).toContain(
      "no assistant with that number",
    );
  });

  it("asks at most three times in one answer", async () => {
    const log: string[] = [];
    const turns: TurnEvent[][] = [
      calls(
        call(ASK_TOOL_NAME, { assistant: 1, question: "1" }, "a"),
        call(ASK_TOOL_NAME, { assistant: 1, question: "2" }, "b"),
        call(ASK_TOOL_NAME, { assistant: 1, question: "3" }, "c"),
        call(ASK_TOOL_NAME, { assistant: 1, question: "4" }, "d"),
      ),
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "5" }, "e")),
      say("Done."),
    ];
    const model = script(turns);
    const result = await runAgent(asker, [], {
      ...quiet,
      turn: model.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      team: team([legal], async () => "ok", log),
    });
    expect(log).toEqual(["Legal: 1", "Legal: 2", "Legal: 3"]);
    expect(
      result.steps.filter((s) => s.label === "Asked enough for one answer"),
    ).toHaveLength(2);
    expect(model.seen[1]?.messages.at(-1)?.content).toContain("3 times");
  });

  it("does not offer or run the tool for an assistant that has no team", async () => {
    // This is an asked run: no team is ever given to it.
    const model = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "again" })),
      say("fine"),
    ]);
    const result = await runAgent(asker, [], {
      ...quiet,
      turn: model.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
    });
    expect(model.seen[0]?.tools).not.toContain(ASK_TOOL_NAME);
    expect(model.seen[1]?.messages.at(-1)?.content).toContain(
      "not available here",
    );
    expect(result.steps[0]?.ok).toBe(false);
  });

  it("turns a failed ask into a sentence for the model, and keeps going", async () => {
    const model = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      say("It could not."),
    ]);
    const result = await runAgent(asker, [], {
      ...quiet,
      turn: model.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      team: team([legal], async () => {
        throw new Error("internal detail");
      }),
    });
    expect(result.text).toBe("It could not.");
    expect(result.steps).toEqual([{ label: "Could not ask Legal", ok: false }]);
    const told = model.seen[1]?.messages.at(-1)?.content ?? "";
    expect(told).toContain("Could not ask Legal");
    expect(told).not.toContain("internal detail");
  });

  it("stops both when the person stops", async () => {
    const controller = new AbortController();
    let linked: AbortSignal | undefined;
    const model = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      say("never reached"),
    ]);
    await expect(
      runAgent(asker, [], {
        ...quiet,
        turn: model.turn,
        signal: controller.signal,
        ask: async () => "reject",
        team: team([legal], async (_p, _q, link) => {
          linked = link.signal;
          controller.abort();
          throw new Error("the asked run ended");
        }),
      }),
    ).rejects.toThrow("Stopped.");
    // The asked run is handed the very same signal.
    expect(linked).toBe(controller.signal);
    expect(model.seen).toHaveLength(1);
  });
});

describe("the asked run", () => {
  /** What the app does: a run of its own, from the question alone. */
  function nested(
    turns: TurnEvent[][],
    assistant: Parameters<typeof runAgent>[0],
    extra: Partial<AgentDeps> = {},
  ) {
    const model = script(turns);
    const run = async (peer: Peer, question: string, link: AskLink) => {
      const result = await runAgent(
        assistant,
        [{ role: "user", content: askedMessage("Notes", question) }],
        {
          ...quiet,
          turn: model.turn,
          signal: link.signal,
          ask: link.ask,
          onActivity: link.onActivity,
          seen: link.seen,
          maxTurns: MAX_ASKED_TURNS,
          ...extra,
        },
      );
      return { text: result.text, steps: result.steps };
    };
    return { model, run };
  }

  it("sees only the question, never the asker's chat, and has no ask tool", async () => {
    const { model, run } = nested([say("Answer.")], {
      folders: [],
      web: false,
      sites: [],
    });
    const gate = buildTeam([legal], run);
    const asking = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "Q?" })),
      say("Thanks."),
    ]);
    await runAgent(
      { folders: [], web: false, sites: [] },
      [
        { role: "user", content: "my private chat" },
        { role: "assistant", content: "earlier answer" },
      ],
      {
        ...quiet,
        turn: asking.turn,
        signal: new AbortController().signal,
        ask: async () => "reject",
        ...(gate ? { team: gate } : {}),
      },
    );
    const sent = model.seen[0]?.messages ?? [];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toContain("Q?");
    expect(sent[0]?.content).toContain("not the person's words");
    expect(JSON.stringify(sent)).not.toContain("my private chat");
    expect(model.seen[0]?.tools).not.toContain(ASK_TOOL_NAME);
  });

  it("raises its cards in the asker's chat, with the asked assistant's name", async () => {
    let fetched = 0;
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => {
        fetched += 1;
        return { status: 200, type: "text/plain", body: "page" };
      },
    };
    const sitesAdded: string[] = [];
    const { run } = nested(
      [
        calls(call("read_web_page", { url: "https://example.org/a" })),
        say("Read it."),
      ],
      { folders: [], web: true, sites: [] },
      { web, allowSite: (s) => sitesAdded.push(s) },
    );
    const gate = buildTeam([legal], run);
    const cards: string[] = [];
    const asking = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "Look it up" })),
      say("Done."),
    ]);
    await runAgent({ folders: [], web: false, sites: [] }, [], {
      ...quiet,
      turn: asking.turn,
      signal: new AbortController().signal,
      // The person presses "Always allow"; it is taken as one Approve.
      ask: async (ask) => {
        cards.push(`${ask.title}|${ask.site ?? "-"}`);
        return "always";
      },
      ...(gate ? { team: gate } : {}),
    });
    expect(cards).toEqual(["Legal wants to read a page on example.org|-"]);
    expect(fetched).toBe(1);
    expect(sitesAdded).toEqual([]);
  });

  it("a rejected card runs nothing in the asked run", async () => {
    let fetched = false;
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => {
        fetched = true;
        return { status: 200, type: "text/plain", body: "page" };
      },
    };
    const { run } = nested(
      [
        calls(call("read_web_page", { url: "https://example.org/a" })),
        say("They said no."),
      ],
      { folders: [], web: true, sites: [] },
      { web },
    );
    const gate = buildTeam([legal], run);
    const asking = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      say("ok"),
    ]);
    const result = await runAgent({ folders: [], web: false, sites: [] }, [], {
      ...quiet,
      turn: asking.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      ...(gate ? { team: gate } : {}),
    });
    expect(fetched).toBe(false);
    expect(result.steps.map((s) => s.label)).toEqual([
      "Asked Legal",
      "Legal: You said no: Read a page on example.org",
    ]);
  });

  it("starts from the asker's flags: an allowed site asks after the asker read files", async () => {
    const notes = join(base, "Notes");
    mkdirSync(notes);
    writeFileSync(join(notes, "a.txt"), "private");
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => ({ status: 200, type: "text/plain", body: "page" }),
    };
    const asks: string[] = [];
    const { run } = nested(
      [
        calls(call("read_web_page", { url: "https://example.org/a" })),
        say("done"),
      ],
      { folders: [], web: true, sites: ["example.org"] },
      { web },
    );
    const gate = buildTeam([legal], run);
    const asking = script([
      calls(call("read_file", { path: "Notes/a.txt" })),
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      say("ok"),
    ]);
    await runAgent({ folders: [notes], web: false, sites: [] }, [], {
      ...quiet,
      turn: asking.turn,
      signal: new AbortController().signal,
      ask: async (ask) => {
        asks.push(ask.title);
        return "reject";
      },
      ...(gate ? { team: gate } : {}),
    });
    // Without the carried flag an allowed site would have run with no card.
    expect(asks).toEqual(["Legal wants to read a page on example.org"]);
  });

  it("carries the flags back out: what it read makes the asker's own web read ask", async () => {
    const notes = join(base, "Notes");
    mkdirSync(notes);
    writeFileSync(join(notes, "a.txt"), "private");
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => ({ status: 200, type: "text/plain", body: "page" }),
    };
    const { run } = nested(
      [calls(call("read_file", { path: "Notes/a.txt" })), say("read it")],
      { folders: [notes], web: false, sites: [] },
    );
    const gate = buildTeam([legal], run);
    const asks: string[] = [];
    const asking = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      calls(call("read_web_page", { url: "https://example.org/a" })),
      say("ok"),
    ]);
    await runAgent({ folders: [], web: true, sites: ["example.org"] }, [], {
      ...quiet,
      web,
      turn: asking.turn,
      signal: new AbortController().signal,
      ask: async (ask) => {
        asks.push(ask.title);
        return "reject";
      },
      ...(gate ? { team: gate } : {}),
    });
    expect(asks).toEqual(["Read a page on example.org"]);
  });

  it("carries any other flag in and out by name, even when the ask fails", async () => {
    const seen: Seen = { files: false, screen: false, mail: true };
    let inside: Seen | undefined;
    const gate = team([legal], async (_p, _q, link) => {
      inside = copyFlags(link.seen);
      link.seen.future = true;
      throw new Error("the asked run failed after reading");
    });
    const asking = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      say("ok"),
    ]);
    await runAgent({ folders: [], web: false, sites: [] }, [], {
      ...quiet,
      turn: asking.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      seen,
      ...(gate ? { team: gate } : {}),
    });
    expect(inside?.mail).toBe(true);
    expect(seen.future).toBe(true);
    expect(seen.mail).toBe(true);
  });

  it("is capped at four model turns", async () => {
    const forever: TurnEvent[][] = Array.from({ length: 10 }, () =>
      calls(call("list_folder", {})),
    );
    const notes = join(base, "Notes");
    mkdirSync(notes);
    const { model, run } = nested(forever, {
      folders: [notes],
      web: false,
      sites: [],
    });
    const gate = buildTeam([legal], run);
    const asking = script([
      calls(call(ASK_TOOL_NAME, { assistant: 1, question: "x" })),
      say("ok"),
    ]);
    const result = await runAgent({ folders: [], web: false, sites: [] }, [], {
      ...quiet,
      turn: asking.turn,
      signal: new AbortController().signal,
      ask: async () => "reject",
      ...(gate ? { team: gate } : {}),
    });
    expect(model.seen).toHaveLength(MAX_ASKED_TURNS);
    expect(result.steps.some((s) => s.label.includes("Stopped after 4"))).toBe(
      true,
    );
  });
});

describe("what is stored about who may ask whom", () => {
  let dir: string;
  let store: Store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stellarfirm-open-ask-"));
    store = new Store(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const base = { group: "", pet: "glim", color: "sky", skills: [] } as const;
  const make = (name: string, canAsk?: string[]) =>
    store.saveAssistant({
      ...base,
      name,
      brief: `${name} brief`,
      skills: [],
      ...(canAsk ? { canAsk } : {}),
    });

  it("is empty by default, and keeps only others that exist, once each", () => {
    const a = make("A");
    const b = make("B");
    expect(a.canAsk).toEqual([]);
    const saved = store.saveAssistant({
      ...base,
      skills: [],
      id: a.id,
      name: "A",
      brief: "",
      canAsk: [b.id, b.id, a.id, "nobody", 7 as never],
    });
    expect(saved.canAsk).toEqual([b.id]);
    expect(new Store(dir).assistant(a.id).canAsk).toEqual([b.id]);
    // A save that says nothing about it keeps it.
    const again = store.saveAssistant({
      ...base,
      skills: [],
      id: a.id,
      name: "A2",
      brief: "",
    });
    expect(again.canAsk).toEqual([b.id]);
    expect(
      store.saveAssistant({
        ...base,
        skills: [],
        id: a.id,
        name: "A2",
        brief: "",
        canAsk: [],
      }).canAsk,
    ).toEqual([]);
  });

  it("is forgotten when an assistant is removed", () => {
    const a = make("A");
    const b = make("B");
    const c = make("C");
    store.saveAssistant({
      ...base,
      skills: [],
      id: a.id,
      name: "A",
      brief: "",
      canAsk: [b.id, c.id],
    });
    store.removeAssistant(b.id);
    expect(store.assistant(a.id).canAsk).toEqual([c.id]);
    // And from the file, not only from what is read.
    expect(readFileSync(join(dir, "state.json"), "utf8")).not.toContain(b.id);
  });

  it("is never in an exported file, a backup or an imported file", () => {
    const a = make("A");
    const b = make("B");
    store.saveAssistant({
      ...base,
      skills: [],
      id: a.id,
      name: "A",
      brief: "",
      canAsk: [b.id],
    });
    expect(JSON.stringify(store.exportFile(a.id))).not.toContain("canAsk");
    expect(JSON.stringify(store.exportFile(a.id))).not.toContain(b.id);
    expect(JSON.stringify(buildBackup(store, true))).not.toContain("canAsk");
    // A crafted file that names one is read without it.
    const imported = store.importFile(
      JSON.stringify({
        ...store.exportFile(a.id),
        name: "Crafted",
        canAsk: [a.id, b.id],
      }),
    );
    expect(imported.canAsk).toEqual([]);
  });
});
