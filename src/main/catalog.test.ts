import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG,
  catalogEntry,
  connectionPresetOf,
} from "../shared/connection-catalog";
import { linkUrl } from "../shared/links";
import { buildBackup } from "./backup";
import {
  buildGate,
  ConnectionService,
  catalogInput,
  connectionInput,
} from "./connections";
import { cleanTools } from "./mcp";
import { type SecretBox, Secrets } from "./secrets";
import { Store, type StoredConnection } from "./store";

const schema = { type: "object", properties: {} };
const hint = (name: string, readOnlyHint?: boolean) => ({
  name,
  description: name,
  inputSchema: schema,
  ...(readOnlyHint === undefined ? {} : { annotations: { readOnlyHint } }),
});

// Tool lists shaped like what these services document. A server says what it
// likes about itself; the app decides from the name too.
const GITHUB_TOOLS = [
  hint("get_me", true),
  hint("search_issues", true),
  hint("list_pull_requests", true),
  hint("get_file_contents", true),
  hint("create_issue", false),
  hint("add_issue_comment", false),
  hint("merge_pull_request", false),
  // A server that claims a change only reads.
  hint("create_branch", true),
  // No hint at all.
  hint("list_notifications"),
];
const STRIPE_TOOLS = [
  hint("stripe_api_search", true),
  hint("stripe_api_details", true),
  hint("stripe_api_read", true),
  hint("stripe_api_write", false),
  hint("search_stripe_documentation", true),
  hint("send_money", false),
  hint("get_balance_summary", true),
  // Reads by its hint, but its name says it sends.
  hint("send_stripe_feedback", true),
];

describe("the catalog", () => {
  it("lists services with a fixed https address, no secret in it, and a fixed key header", () => {
    const ids = new Set<string>();
    for (const e of CATALOG) {
      expect(ids.has(e.id), e.id).toBe(false);
      ids.add(e.id);
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      const url = new URL(e.url);
      expect(url.protocol, e.id).toBe("https:");
      expect(url.username + url.password + url.search + url.hash, e.id).toBe(
        "",
      );
      expect(["bearer", "x-api-key"]).toContain(e.keyStyle);
      expect(new URL(e.link).protocol).toBe("https:");
      expect(e.name && e.description && e.where).toBeTruthy();
    }
    expect(CATALOG.length).toBeGreaterThanOrEqual(8);
  });

  it("knows only real entries", () => {
    expect(catalogEntry("github")?.name).toBe("GitHub");
    expect(catalogEntry("nope")).toBeUndefined();
    expect(catalogEntry({ id: "github" })).toBeUndefined();
    expect(connectionPresetOf({ preset: "catalog:github" })).toBe(
      "catalog:github",
    );
    expect(connectionPresetOf({ preset: "catalog:nope" })).toBe("custom");
    expect(connectionPresetOf({ preset: "catalog:" })).toBe("custom");
    expect(connectionPresetOf({ preset: ["catalog:github"] })).toBe("custom");
    expect(connectionPresetOf({})).toBe("custom");
  });

  it("opens an entry's own page only through a fixed link", () => {
    for (const e of CATALOG) expect(linkUrl(`catalog:${e.id}`)).toBe(e.link);
    expect(() => linkUrl("catalog:nope")).toThrow();
    expect(() => linkUrl("catalog:https://evil.example.com")).toThrow();
  });

  it("keeps only the id, name and key from the page", () => {
    expect(
      catalogInput({
        catalogId: "github",
        name: "Work",
        apiKey: "k",
        baseUrl: "https://evil.example.com/mcp",
        preset: "custom",
        keyStyle: "x-api-key",
      }),
    ).toEqual({ catalogId: "github", name: "Work", apiKey: "k" });
  });
});

describe("catalog connections", () => {
  let dir: string;
  let store: Store;
  let secrets: Secrets;
  let seen: { url: string; headers: Headers; method: string }[];
  let tools: unknown[];
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
    seen.push({ url, headers: new Headers(init.headers), method: body.method });
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-06-18" }
        : { tools };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  const service = () => new ConnectionService({ store, secrets, fetchImpl });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stellarfirm-solo-catalog-"));
    store = new Store(dir);
    secrets = new Secrets(join(dir, "keys.json"), box);
    seen = [];
    tools = GITHUB_TOOLS;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const assistantWith = (ids: string[]) =>
    store.saveAssistant({
      name: "A",
      group: "",
      pet: "glim",
      color: "sky",
      brief: "",
      skills: [],
      connections: ids,
    });

  it("pins the address and sends the key in the entry's header only", async () => {
    const github = await service().saveCatalog({
      catalogId: "github",
      name: "GitHub",
      apiKey: "ghp-secret",
    });
    expect(github.preset).toBe("catalog:github");
    expect(github.baseUrl).toBe(catalogEntry("github")?.url);
    expect(JSON.stringify(github)).not.toContain("ghp-secret");
    for (const r of seen) {
      expect(r.url).toBe(catalogEntry("github")?.url);
      expect(r.headers.get("authorization")).toBe("Bearer ghp-secret");
      expect(r.headers.get("x-api-key")).toBeNull();
    }
    seen = [];
    await service().saveCatalog({
      catalogId: "exa",
      name: "Exa",
      apiKey: "exa-secret",
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.url).toBe(catalogEntry("exa")?.url);
      expect(r.headers.get("x-api-key")).toBe("exa-secret");
      expect(r.headers.get("authorization")).toBeNull();
    }
  });

  it("ignores an address, a header or a preset the page sends", async () => {
    const input = catalogInput({
      catalogId: "github",
      name: "G",
      apiKey: "k",
      baseUrl: "https://evil.example.com/mcp",
      preset: "composio",
      keyStyle: "x-api-key",
    });
    await service().checkCatalog({
      ...input,
      baseUrl: "https://evil.example.com/mcp",
      preset: "composio",
      keyStyle: "x-api-key",
    } as never);
    const saved = await service().saveCatalog({
      ...input,
      baseUrl: "https://evil.example.com/mcp",
    } as never);
    expect(saved.preset).toBe("catalog:github");
    expect(saved.baseUrl).toBe(catalogEntry("github")?.url);
    expect(seen.every((r) => r.url === catalogEntry("github")?.url)).toBe(true);
    expect(seen.every((r) => r.headers.get("x-api-key") === null)).toBe(true);
  });

  it("never lets the custom way in make a catalog preset", async () => {
    const custom = await service().save(
      connectionInput({
        name: "n",
        baseUrl: "https://n.example.com/mcp",
        apiKey: "sk",
        preset: "catalog:exa",
        keyStyle: "x-api-key",
      }),
    );
    expect(custom.preset).toBe("custom");
    for (const r of seen) {
      expect(r.url).toBe("https://n.example.com/mcp");
      expect(r.headers.get("x-api-key")).toBeNull();
    }
  });

  it("refuses an unknown service and needs a key", async () => {
    await expect(
      service().saveCatalog({ catalogId: "nope", name: "x", apiKey: "k" }),
    ).rejects.toThrow(/not in the list/);
    await expect(
      service().saveCatalog({ catalogId: "github", name: "x" }),
    ).rejects.toThrow(/key/);
    expect(seen).toEqual([]);
    expect(store.connections()).toEqual([]);
  });

  it("never switches a saved connection to another way in or another service", async () => {
    const github = await service().saveCatalog({
      catalogId: "github",
      name: "GitHub",
      apiKey: "k",
    });
    await expect(
      service().saveCatalog({
        id: github.id,
        catalogId: "exa",
        name: "GitHub",
        apiKey: "k2",
      }),
    ).rejects.toThrow(/another way/);
    await expect(
      service().save({
        id: github.id,
        name: "GitHub",
        baseUrl: "https://evil.example.com/mcp",
      }),
    ).rejects.toThrow(/another way/);
  });

  it("calls the entry's address and header even if the saved file was edited", async () => {
    const github = await service().saveCatalog({
      catalogId: "github",
      name: "GitHub",
      apiKey: "ghp-1",
    });
    const stored = store.connections().find((c) => c.id === github.id);
    if (!stored) throw new Error("missing");
    for (const edited of [
      { ...stored, baseUrl: "https://evil.example.com/mcp" },
      {
        ...stored,
        baseUrl: "https://evil.example.com/mcp",
        preset: "catalog:github",
      },
    ] as StoredConnection[]) {
      const a = assistantWith([github.id]);
      const tampered = new ConnectionService({
        store: Object.assign(Object.create(store), {
          connections: () => [edited],
        }),
        secrets,
        fetchImpl,
      });
      seen = [];
      await tampered
        .gateFor(a, new AbortController().signal)
        ?.plan("c1_search_issues", "{}", false)
        .run();
      expect(seen.length).toBeGreaterThan(0);
      for (const r of seen) {
        expect(r.url).toBe(catalogEntry("github")?.url);
        expect(r.headers.get("authorization")).toBe("Bearer ghp-1");
      }
    }
  });

  it("sends each account's key only to its own service", async () => {
    const work = await service().saveCatalog({
      catalogId: "github",
      name: "Work",
      apiKey: "key-work",
    });
    const home = await service().saveCatalog({
      catalogId: "github",
      name: "Home",
      apiKey: "key-home",
    });
    tools = STRIPE_TOOLS;
    const stripe = await service().saveCatalog({
      catalogId: "stripe",
      name: "Shop",
      apiKey: "key-stripe",
    });
    const exa = await service().saveCatalog({
      catalogId: "exa",
      name: "Search",
      apiKey: "key-exa",
    });
    const a = assistantWith([work.id, home.id, stripe.id, exa.id]);
    seen = [];
    const gate = service().gateFor(a, new AbortController().signal);
    for (const name of ["c1_get_me", "c2_get_me", "c3_stripe_api_read"])
      await gate?.plan(name, "{}", false).run();
    const stripeOnly = seen.filter(
      (r) => r.url === catalogEntry("stripe")?.url,
    );
    expect(stripeOnly.length).toBeGreaterThan(0);
    for (const r of stripeOnly)
      expect(r.headers.get("authorization")).toBe("Bearer key-stripe");
    const gh = seen.filter((r) => r.url === catalogEntry("github")?.url);
    const auths = new Set(gh.map((r) => r.headers.get("authorization")));
    expect(auths).toEqual(new Set(["Bearer key-work", "Bearer key-home"]));
    // A key is only ever sent to the address of the service it was saved for.
    for (const r of seen) {
      const auth = r.headers.get("authorization") ?? "";
      const apiKey = r.headers.get("x-api-key") ?? "";
      if (auth.includes("key-stripe"))
        expect(r.url).toBe(catalogEntry("stripe")?.url);
      if (apiKey.includes("key-exa"))
        expect(r.url).toBe(catalogEntry("exa")?.url);
      expect(`${auth}${apiKey}`).not.toContain("undefined");
      if (r.url === catalogEntry("exa")?.url) expect(auth).toBe("");
    }
  });

  it("holds each name once, ignoring case, without contacting the service", async () => {
    await service().saveCatalog({
      catalogId: "github",
      name: "Work GitHub",
      apiKey: "k",
    });
    seen = [];
    await expect(
      service().saveCatalog({
        catalogId: "github",
        name: "  work github ",
        apiKey: "k2",
      }),
    ).rejects.toThrow(/already have a connection with that name/);
    await expect(
      service().save({
        name: "WORK GITHUB",
        baseUrl: "https://n.example.com/mcp",
      }),
    ).rejects.toThrow(/already have a connection with that name/);
    expect(seen).toEqual([]);
    expect(store.connections()).toHaveLength(1);
    // Saving the same connection again under its own name is fine.
    const first = store.connections()[0];
    if (!first) throw new Error("missing");
    await service().saveCatalog({
      id: first.id,
      catalogId: "github",
      name: "Work GitHub",
    });
    // And a second account of the same service under another name is fine.
    await service().saveCatalog({
      catalogId: "github",
      name: "Personal GitHub",
      apiKey: "k3",
    });
    expect(store.connections()).toHaveLength(2);
  });

  it("holds at most twenty connections", async () => {
    for (let i = 1; i <= 20; i += 1)
      await service().saveCatalog({
        catalogId: "github",
        name: `Account ${i}`,
        apiKey: `k${i}`,
      });
    await expect(
      service().saveCatalog({
        catalogId: "github",
        name: "One more",
        apiKey: "k",
      }),
    ).rejects.toThrow(/up to 20 connections/);
  });

  it("tells the model which account is which when two are of one service", async () => {
    const work = await service().saveCatalog({
      catalogId: "github",
      name: "Work",
      apiKey: "a",
    });
    const home = await service().saveCatalog({
      catalogId: "github",
      name: "Home",
      apiKey: "b",
    });
    tools = STRIPE_TOOLS;
    const shop = await service().saveCatalog({
      catalogId: "stripe",
      name: "Shop",
      apiKey: "c",
    });
    const both = service().gateFor(
      assistantWith([work.id, home.id, shop.id]),
      new AbortController().signal,
    );
    const describe_ = (name: string) =>
      both?.specs.find((s) => s.name === name)?.description ?? "";
    expect(describe_("c1_get_me")).toContain("[Work, a GitHub account]");
    expect(describe_("c2_get_me")).toContain("[Home, a GitHub account]");
    expect(describe_("c3_stripe_api_read")).toContain("[Shop]");
    const alone = service().gateFor(
      assistantWith([work.id]),
      new AbortController().signal,
    );
    expect(alone?.specs[0]?.description).toContain("[Work]");
  });

  it("brings nothing about a catalog preset into an export, a backup or an import", async () => {
    const github = await service().saveCatalog({
      catalogId: "github",
      name: "Work",
      apiKey: "k",
    });
    const a = assistantWith([github.id]);
    for (const text of [
      JSON.stringify(store.exportFile(a.id)),
      JSON.stringify(buildBackup(store, true)),
    ])
      expect(text).not.toMatch(/catalog|preset|githubcopilot/i);
    const imported = store.importFile(
      JSON.stringify({
        ...store.exportFile(a.id),
        connections: [{ id: "z", preset: "catalog:github" }],
        preset: "catalog:github",
      }),
    );
    expect(imported.connections).toEqual([]);
    expect(store.connections()).toHaveLength(1);
  });
});

describe("which tools of a catalog service ask", () => {
  const conn = (id: string, name: string, preset: string, list: unknown[]) =>
    ({
      id,
      name,
      preset,
      baseUrl: catalogEntry(preset.slice(8))?.url ?? "",
      checkedAt: "2026-01-01T00:00:00.000Z",
      tools: cleanTools(list).map((t) => ({ ...t })),
    }) as StoredConnection;

  const check = (c: StoredConnection, expectedReads: string[]) => {
    const gate = buildGate(
      { connections: [c.id], connectionTools: [] },
      [c],
      async () => "ok",
      () => undefined,
    );
    if (!gate) throw new Error("no gate");
    const reads: string[] = [];
    for (const t of c.tools) {
      const planned = gate.plan(`c1_${t.name}`, "{}", false);
      // Every call asks, whatever the server says about itself.
      expect(planned.ask, t.name).toBeDefined();
      if (planned.ask?.remember) reads.push(t.name);
      // Asking "always" never sticks on a tool that is not a plain read.
      gate.remember(c.id, t.name);
      expect(Boolean(gate.plan(`c1_${t.name}`, "{}", false).ask), t.name).toBe(
        !t.readOnly,
      );
    }
    expect(reads.sort()).toEqual(expectedReads.sort());
  };

  it("GitHub: only read-marked, read-named tools can be allowed for good", () => {
    check(conn("g", "GitHub", "catalog:github", GITHUB_TOOLS), [
      "get_me",
      "search_issues",
      "list_pull_requests",
      "get_file_contents",
    ]);
  });

  it("Stripe: writes, money and anything named like a send ask every time", () => {
    check(conn("s", "Stripe", "catalog:stripe", STRIPE_TOOLS), [
      "stripe_api_search",
      "stripe_api_details",
      "stripe_api_read",
      "search_stripe_documentation",
      "get_balance_summary",
    ]);
  });
});
