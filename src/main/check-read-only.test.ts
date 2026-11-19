import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentDeps, CHECK_LEFT_FOR_PERSON, runAgent } from "./agent";
import { buildGate } from "./connections";
import type { ToolCall, TurnEvent, WireMessage } from "./models";
import type { ScreenDeps } from "./screen";
import type { StoredConnection, StoredTool } from "./store";
import { ASK_TOOL_NAME, buildTeam } from "./team";
import type { Ask } from "./tools";
import type { WebDeps } from "./web";

/**
 * A check only reads. These tests give an assistant every tool the app offers,
 * ask for each one by name, and prove that nothing which needs the person's
 * Approve runs, and that no card is ever raised.
 */

let base: string;
let notes: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "stellarfirm-open-check-")));
  notes = join(base, "Notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "a.txt"), "hello");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const schema = { type: "object", properties: {} };
const tool = (name: string, readOnly: boolean): StoredTool => ({
  name,
  description: name,
  readOnly,
  inputSchema: schema,
});
const conn: StoredConnection = {
  id: "n",
  name: "Notes app",
  baseUrl: "https://n.example.com/mcp",
  tools: [
    tool("allowed_read", true),
    tool("new_read", true),
    tool("change_it", false),
  ],
  checkedAt: "2026-01-01T00:00:00.000Z",
};

function world() {
  const effects = {
    web: [] as string[],
    mcp: [] as string[],
    screen: 0,
    asked: [] as Ask[],
    team: 0,
  };
  const web: WebDeps = {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    get: async (url) => {
      effects.web.push(String(url));
      return { status: 200, type: "text/plain", body: "page" };
    },
  };
  const screen: ScreenDeps = {
    where: "on this computer",
    platform: "darwin",
    permission: () => "granted",
    screens: () => 1,
    capture: async () => {
      effects.screen += 1;
      return undefined;
    },
  };
  const mcp = buildGate(
    { connections: ["n"], connectionTools: ["n:allowed_read"] },
    [conn],
    async (_c, name) => {
      effects.mcp.push(name);
      return "ok";
    },
    () => {},
  );
  const team = buildTeam(
    [{ id: "x", name: "Legal", brief: "Law" }],
    async () => {
      effects.team += 1;
      return { text: "answer", steps: [] };
    },
  );
  return { effects, web, screen, mcp, team };
}

const callOf = (name: string, args: unknown): ToolCall => ({
  id: `c-${name}`,
  name,
  arguments: JSON.stringify(args),
});

const ARGS: Record<string, unknown> = {
  list_folder: {},
  read_file: { path: "Notes/a.txt" },
  find_files: { name: "a" },
  save_new_file: { path: "Notes/new.txt", content: "written" },
  read_web_page: { url: "https://example.org/x" },
  [ASK_TOOL_NAME]: { assistant: 1, question: "hi" },
};

/** A model that offers its tool list once, then calls every tool, a few a turn. */
function everyTool(toolNames: () => string[], ordered?: string[]) {
  const offered: string[][] = [];
  const results: string[] = [];
  let step = 0;
  let queue: string[] | undefined;
  return {
    offered,
    results,
    async *turn(
      messages: WireMessage[],
      tools: { name: string }[],
    ): AsyncGenerator<TurnEvent> {
      offered.push(tools.map((t) => t.name));
      const last = messages.at(-1);
      if (step > 0 && last?.role === "tool") results.push(last.content);
      queue ??= ordered ?? [...new Set([...toolNames(), ...Object.keys(ARGS)])];
      step += 1;
      const next = queue.splice(0, 1);
      if (next.length === 0) {
        yield { type: "text", text: "Done." };
        return;
      }
      const name = next[0] as string;
      yield {
        type: "calls",
        calls: [callOf(name, ARGS[name] ?? {})],
      };
    },
  };
}

function deps(
  w: ReturnType<typeof world>,
  model: ReturnType<typeof everyTool>,
): AgentDeps {
  return {
    turn: model.turn,
    ask: async (ask) => {
      w.effects.asked.push(ask);
      return "approve";
    },
    allowSite: () => {},
    onText: () => {},
    onActivity: () => {},
    signal: new AbortController().signal,
    web: w.web,
    screen: w.screen,
    ...(w.mcp ? { mcp: w.mcp } : {}),
    ...(w.team ? { team: w.team } : {}),
  };
}

const assistant = (sites: string[] = []) => ({
  folders: [notes],
  web: true,
  sites,
  screen: true,
});

describe("a check", () => {
  it("is not offered the tools that write, look at the screen or ask another assistant", async () => {
    const w = world();
    const model = everyTool(() => []);
    await runAgent(assistant(), [], {
      ...deps(w, model),
      readOnly: true,
      maxTurns: 20,
    });
    const first = model.offered[0] ?? [];
    for (const hidden of ["save_new_file", "look_at_screen", ASK_TOOL_NAME])
      expect(first).not.toContain(hidden);
    expect(first).toEqual(
      expect.arrayContaining([
        "list_folder",
        "read_file",
        "find_files",
        "read_web_page",
        "c1_allowed_read",
        "c1_new_read",
        "c1_change_it",
      ]),
    );
    // Whereas an answer to the person is offered every one of them.
    const normal = everyTool(() => []);
    await runAgent(assistant(), [], { ...deps(world(), normal), maxTurns: 20 });
    expect(normal.offered[0]).toEqual(
      expect.arrayContaining([
        "save_new_file",
        "look_at_screen",
        ASK_TOOL_NAME,
      ]),
    );
  });

  it("walks every tool: nothing with an ask runs, no card is raised, a read with none does", async () => {
    const w = world();
    const model = everyTool(() => [
      ...(w.mcp?.specs.map((s) => s.name) ?? []),
      "look_at_screen",
      "not_a_tool",
    ]);
    const result = await runAgent(assistant(["example.org"]), [], {
      ...deps(w, model),
      readOnly: true,
      maxTurns: 40,
    });
    // No card, ever.
    expect(w.effects.asked).toEqual([]);
    // Effects that need an Approve did not happen.
    expect(existsSync(join(notes, "new.txt"))).toBe(false);
    expect(w.effects.screen).toBe(0);
    expect(w.effects.team).toBe(0);
    // The one read the person allowed for good ran, before any file was read.
    expect(w.effects.mcp).toEqual(["allowed_read"]);
    // The allowed site came after a file was read, so it was left too.
    expect(w.effects.web).toEqual([]);
    const steps = result.steps.map((step) => step.ok);
    expect(steps.filter(Boolean).length).toBeGreaterThan(0);
    expect(result.text).toBe("Done.");
  });

  it("leaves a step that needs an Approve, and says so to the model and in the steps", async () => {
    const w = world();
    const model = everyTool(
      () => [],
      ["c1_change_it", "c1_new_read", "read_web_page"],
    );
    const result = await runAgent(assistant(), [], {
      ...deps(w, model),
      readOnly: true,
    });
    expect(w.effects.asked).toEqual([]);
    expect(w.effects.mcp).toEqual([]);
    expect(w.effects.web).toEqual([]);
    expect(model.results).toHaveLength(3);
    for (const told of model.results)
      expect(told).toContain(CHECK_LEFT_FOR_PERSON);
    expect(CHECK_LEFT_FOR_PERSON).toContain(
      "Say in your update that it is waiting",
    );
    expect(result.steps.map((s) => s.ok)).toEqual([false, false, false]);
    expect(result.steps[0]?.label).toMatch(/^Left for you: /);
  });

  it("runs the reads that need no Approve", async () => {
    const w = world();
    const model = everyTool(
      () => [],
      ["c1_allowed_read", "read_web_page", "list_folder"],
    );
    const result = await runAgent(assistant(["example.org"]), [], {
      ...deps(w, model),
      readOnly: true,
    });
    expect(w.effects.mcp).toEqual(["allowed_read"]);
    expect(w.effects.web).toEqual(["https://example.org/x"]);
    expect(w.effects.asked).toEqual([]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
  });

  it("leaves even an allowed site and an allowed read once it has read files", async () => {
    const w = world();
    const model = everyTool(
      () => [],
      ["read_file", "read_web_page", "c1_allowed_read"],
    );
    const result = await runAgent(assistant(["example.org"]), [], {
      ...deps(w, model),
      readOnly: true,
    });
    expect(w.effects.web).toEqual([]);
    expect(w.effects.mcp).toEqual([]);
    expect(w.effects.asked).toEqual([]);
    expect(result.steps.map((s) => s.ok)).toEqual([true, false, false]);
  });

  it("refuses a tool it was not offered, even by name, before it reaches any gate", async () => {
    const w = world();
    const model = everyTool(
      () => [],
      ["save_new_file", "look_at_screen", ASK_TOOL_NAME],
    );
    const result = await runAgent(assistant(), [], {
      ...deps(w, model),
      readOnly: true,
    });
    expect(existsSync(join(notes, "new.txt"))).toBe(false);
    expect(w.effects.screen).toBe(0);
    expect(w.effects.team).toBe(0);
    expect(w.effects.asked).toEqual([]);
    expect(result.steps.every((s) => !s.ok)).toBe(true);
    for (const told of model.results)
      expect(told).toContain("not available here");
  });

  it("makes the same refusals when the model asks for tools in writing", async () => {
    const w = world();
    const written: string[] = [
      '<tool_call>{"name":"save_new_file","arguments":{"path":"Notes/new.txt","content":"x"}}</tool_call>',
    ];
    let n = 0;
    const model = {
      async *turn(): AsyncGenerator<TurnEvent> {
        yield { type: "text", text: written[n++] ?? "Done." };
      },
    };
    const result = await runAgent(assistant(), [], {
      ...deps(w, { ...everyTool(() => []), turn: model.turn }),
      readOnly: true,
      modeKey: "check-text-mode\nmodel",
    });
    expect(existsSync(join(notes, "new.txt"))).toBe(false);
    expect(w.effects.asked).toEqual([]);
    expect(result.text).toBeDefined();
  });

  it("stops after the turns it is given", async () => {
    const w = world();
    const forever = everyTool(() => [], Array(20).fill("list_folder"));
    const result = await runAgent(assistant(), [], {
      ...deps(w, forever),
      readOnly: true,
      maxTurns: 4,
    });
    expect(forever.offered).toHaveLength(4);
    expect(result.steps.at(-1)?.label).toBe("Stopped after 4 rounds of tools");
  });

  it("a normal answer is not read only: the same calls ask, and run once approved", async () => {
    const w = world();
    const model = everyTool(() => [], ["save_new_file", "c1_change_it"]);
    await runAgent(assistant(), [], { ...deps(w, model) });
    // A change on a connection asks every time; a new file runs on its own.
    expect(w.effects.asked.map((a) => a.title)).toEqual([
      "Use change_it on Notes app",
    ]);
    expect(existsSync(join(notes, "new.txt"))).toBe(true);
    expect(w.effects.mcp).toEqual(["change_it"]);
  });
});
