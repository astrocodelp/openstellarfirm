import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkUrl } from "../shared/links";
import { buildBackup } from "./backup";
import {
  buildGate,
  ConnectionService,
  composioInput,
  connectionInput,
  presetOf,
} from "./connections";
import { COMPOSIO_MCP_URL, cleanTools, readsLikeChange } from "./mcp";
import { type SecretBox, Secrets } from "./secrets";
import { Store, type StoredConnection } from "./store";

const schema = { type: "object", properties: {} };
// A tool list shaped like the one Composio documents, with a server that
// claims every tool only reads.
const COMPOSIO_TOOLS = [
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
  "COMPOSIO_MANAGE_CONNECTIONS",
  "COMPOSIO_WAIT_FOR_CONNECTIONS",
  "COMPOSIO_REMOTE_WORKBENCH",
  "COMPOSIO_REMOTE_BASH_TOOL",
].map((name) => ({
  name,
  description: name,
  inputSchema: schema,
  annotations: { readOnlyHint: true },
}));

describe("how Composio's tools are classified", () => {
  it("splits ALL-CAPS names with underscores and flags the words that change things", () => {
    for (const name of [
      "COMPOSIO_MULTI_EXECUTE_TOOL",
      "COMPOSIO_MANAGE_CONNECTIONS",
      "COMPOSIO_REMOTE_WORKBENCH",
      "COMPOSIO_REMOTE_BASH_TOOL",
      "run-shell",
      "connectApp",
    ])
      expect(readsLikeChange(name), name).toBe(true);
    for (const name of ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS"])
      expect(readsLikeChange(name), name).toBe(false);
  });

  it("lets only a read-marked, read-named tool be allowed for good", () => {
    const tools = cleanTools(COMPOSIO_TOOLS);
    const reads = tools.filter((t) => t.readOnly).map((t) => t.name);
    expect(reads).toEqual([
      "COMPOSIO_SEARCH_TOOLS",
      "COMPOSIO_GET_TOOL_SCHEMAS",
      "COMPOSIO_WAIT_FOR_CONNECTIONS",
    ]);
    const conn: StoredConnection = {
      id: "k",
      name: "Composio",
      preset: "composio",
      baseUrl: COMPOSIO_MCP_URL,
      checkedAt: "2026-01-01T00:00:00.000Z",
      tools: tools.map((t) => ({ ...t })),
    };
    const gate = buildGate(
      { connections: ["k"], connectionTools: [] },
      [conn],
      async () => "ok",
      () => undefined,
    );
    if (!gate) throw new Error("no gate");
    for (const t of tools) {
      const planned = gate.plan(`c1_${t.name}`, "{}", false);
      expect(planned.ask, t.name).toBeDefined();
      expect(Boolean(planned.ask?.remember), t.name).toBe(t.readOnly);
    }
    // Asking "always" on a change never sticks.
    gate.remember("k", "COMPOSIO_MULTI_EXECUTE_TOOL");
    expect(
      gate.plan("c1_COMPOSIO_MULTI_EXECUTE_TOOL", "{}", false).ask,
    ).toBeDefined();
  });

  it("shows nested arguments as compact JSON cut to 300 characters", () => {
    const conn: StoredConnection = {
      id: "k",
      name: "Composio",
      preset: "composio",
      baseUrl: COMPOSIO_MCP_URL,
      checkedAt: "2026-01-01T00:00:00.000Z",
      tools: [
        {
          name: "COMPOSIO_MULTI_EXECUTE_TOOL",
          description: "",
          readOnly: false,
          inputSchema: schema,
        },
      ],
    };
    const gate = buildGate(
      { connections: ["k"], connectionTools: [] },
      [conn],
      async () => "ok",
      () => undefined,
    );
    const args = {
      tools: [
        { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.c" } },
        { tool_slug: "X", arguments: { text: "t".repeat(900) } },
      ],
      thought: "short",
    };
    const lines =
      gate
        ?.plan("c1_COMPOSIO_MULTI_EXECUTE_TOOL", JSON.stringify(args), false)
        .ask?.detail.split("\n") ?? [];
    expect(lines).toContain("thought: short");
    const tools = lines.find((l) => l.startsWith("tools: ")) ?? "";
    expect(tools).toContain('{"tool_slug":"GMAIL_SEND_EMAIL"');
    expect(tools.length).toBeLessThanOrEqual(307);
    expect(tools.endsWith("…")).toBe(true);
  });
});

describe("the Composio preset", () => {
  let dir: string;
  let store: Store;
  let secrets: Secrets;
  let seen: { url: string; headers: Headers; method: string }[];
  const box: SecretBox = {
    available: async () => true,
    seal: async (plain) => Buffer.from(plain.split("").reverse().join("")),
    open: async (sealed) => ({
      plain: sealed.toString().split("").reverse().join(""),
      stale: false,
    }),
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      id?: number;
      method: string;
    };
    seen.push({
      url,
      headers: new Headers(init.headers),
      method: body.method,
    });
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-06-18" }
        : { tools: COMPOSIO_TOOLS };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  const service = () => new ConnectionService({ store, secrets, fetchImpl });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openstellarfirm-composio-"));
    store = new Store(dir);
    secrets = new Secrets(join(dir, "keys.json"), box);
    seen = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("pins the address and sends the key in Composio's header only", async () => {
    const saved = await service().saveComposio(
      composioInput({ name: "Composio", apiKey: "ck-secret" }),
    );
    expect(saved.preset).toBe("composio");
    expect(saved.baseUrl).toBe(COMPOSIO_MCP_URL);
    expect(saved.hasKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("ck-secret");
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.url).toBe(COMPOSIO_MCP_URL);
      expect(r.headers.get("x-consumer-api-key")).toBe("ck-secret");
      expect(r.headers.get("authorization")).toBeNull();
    }
  });

  it("ignores an address or an auth field from the page", async () => {
    const input = composioInput({
      name: "C",
      apiKey: "ck",
      baseUrl: "https://evil.example.com/mcp",
      auth: "bearer",
      preset: "custom",
    });
    expect(input).toEqual({ name: "C", apiKey: "ck" });
    // Even if the page's extra fields reached the service, the address is fixed.
    await service().checkComposio({
      name: "C",
      apiKey: "ck",
      baseUrl: "https://evil.example.com/mcp",
      auth: "bearer",
    } as never);
    expect(seen.every((r) => r.url === COMPOSIO_MCP_URL)).toBe(true);
  });

  it("needs a key", async () => {
    await expect(service().saveComposio({ name: "C" })).rejects.toThrow(/key/);
    expect(store.connections()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("never sends the Composio header on a custom connection, or Authorization on Composio", async () => {
    const custom = await service().save(
      connectionInput({
        name: "n",
        baseUrl: "https://n.example.com/mcp",
        apiKey: "sk-custom",
        preset: "composio",
        auth: "x-consumer-api-key",
      }),
    );
    expect(custom.preset).toBe("custom");
    for (const r of seen) {
      expect(r.headers.get("authorization")).toBe("Bearer sk-custom");
      expect(r.headers.get("x-consumer-api-key")).toBeNull();
    }
  });

  it("reads a connection saved before presets as custom, and never switches one", async () => {
    const old = store.saveConnection({
      name: "Old",
      baseUrl: "https://old.example.com/mcp",
      tools: [],
    });
    expect(old.preset).toBeUndefined();
    expect(presetOf(old)).toBe("custom");
    expect(presetOf({ preset: "Composio" })).toBe("custom");
    expect(presetOf({ preset: { x: 1 } })).toBe("custom");
    expect(service().list()[0]?.preset).toBe("custom");
    await expect(
      service().saveComposio({ id: old.id, name: "x", apiKey: "k" }),
    ).rejects.toThrow(/another way/);
    const composio = await service().saveComposio({ name: "C", apiKey: "k" });
    await expect(
      service().save({
        id: composio.id,
        name: "x",
        baseUrl: "https://evil.example.com/mcp",
      }),
    ).rejects.toThrow(/another way/);
  });

  it("keeps the saved key when a Composio connection is edited with none typed", async () => {
    const first = await service().saveComposio({ name: "C", apiKey: "ck-1" });
    seen = [];
    await service().saveComposio({ id: first.id, name: "Renamed" });
    expect(seen.length).toBeGreaterThan(0);
    expect(
      seen.every((r) => r.headers.get("x-consumer-api-key") === "ck-1"),
    ).toBe(true);
  });

  it("calls Composio at its own address even if the saved address was changed", async () => {
    const saved = await service().saveComposio({ name: "C", apiKey: "ck-2" });
    // A hand-edited data file points the connection somewhere else.
    const state = store.connections().find((c) => c.id === saved.id);
    if (!state) throw new Error("missing");
    state.baseUrl = "https://evil.example.com/mcp";
    const a = store.saveAssistant({
      name: "A",
      group: "",
      pet: "glim",
      color: "sky",
      brief: "",
      skills: [],
      connections: [saved.id],
    });
    seen = [];
    const svc = service();
    const gate = svc.gateFor(a, new AbortController().signal);
    // The gate reads the store; make it read the changed address.
    const tampered = new ConnectionService({
      store: Object.assign(Object.create(store), {
        connections: () => [state],
      }),
      secrets,
      fetchImpl,
    });
    const g2 = tampered.gateFor(a, new AbortController().signal);
    expect(gate).toBeDefined();
    await g2
      ?.plan("c1_COMPOSIO_SEARCH_TOOLS", "{}", false)
      .run()
      .catch(() => undefined);
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.url).toBe(COMPOSIO_MCP_URL);
      expect(r.headers.get("x-consumer-api-key")).toBe("ck-2");
      expect(r.headers.get("authorization")).toBeNull();
    }
  });

  it("brings nothing about a preset into an export, a backup or an import", async () => {
    const saved = await service().saveComposio({ name: "C", apiKey: "ck-3" });
    const a = store.saveAssistant({
      name: "A",
      group: "",
      pet: "glim",
      color: "sky",
      brief: "",
      skills: [],
      connections: [saved.id],
    });
    const exported = JSON.stringify(store.exportFile(a.id));
    const backup = JSON.stringify(buildBackup(store, true));
    for (const text of [exported, backup]) {
      expect(text).not.toMatch(/composio|preset/i);
    }
    const imported = store.importFile(
      JSON.stringify({
        ...store.exportFile(a.id),
        connections: [{ id: "z", preset: "composio" }],
        preset: "composio",
      }),
    );
    expect(imported.connections).toEqual([]);
    expect(store.connections()).toHaveLength(1);
  });

  it("opens Composio's site only through a fixed link", () => {
    expect(linkUrl("composio")).toBe("https://composio.dev");
    expect(() => linkUrl("https://composio.dev")).toThrow();
  });
});
