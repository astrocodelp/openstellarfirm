import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "./agent";
import {
  findFiles,
  folderLabels,
  isSecretName,
  listFolder,
  readFile,
  saveNewFile,
} from "./folders";
import type { ToolCall, TurnEvent, WireMessage } from "./models";
import { ModelError } from "./models";
import { planCall, toolsFor } from "./tools";
import {
  checkWebAddress,
  htmlToText,
  isPublicAddress,
  readWebPage,
  type WebDeps,
} from "./web";

let base: string;
let notes: string;
let outside: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "stellarfirm-open-tools-")));
  notes = join(base, "Notes");
  outside = join(base, "Outside");
  mkdirSync(join(notes, "sub"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(notes, "plan.md"), "The plan.");
  writeFileSync(join(notes, "sub", "deep.txt"), "Deep.");
  writeFileSync(join(notes, ".env"), "TOKEN=abc");
  writeFileSync(join(outside, "private.txt"), "Private.");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("folder tools", () => {
  it("lists, finds and reads inside a picked folder", async () => {
    expect(await listFolder([notes])).toBe("Notes/ (folder)");
    const listed = await listFolder([notes], "Notes");
    expect(listed).toContain("plan.md");
    expect(listed).toContain("sub/ (folder)");
    expect(await readFile([notes], "Notes/plan.md")).toBe("The plan.");
    expect(await readFile([notes], "sub/deep.txt")).toBe("Deep.");
    expect(await findFiles([notes], "DEEP")).toBe("Notes/sub/deep.txt");
  });

  it("never shows a file that can hold keys or passwords", async () => {
    expect(await listFolder([notes], "Notes")).not.toContain(".env");
    await expect(readFile([notes], "Notes/.env")).rejects.toThrow(
      /keys or passwords/,
    );
    expect(await findFiles([notes], "env")).toMatch(/Nothing/);
    for (const name of [
      ".env.local",
      "id_rsa",
      "server.pem",
      ".ssh",
      "credentials.json",
    ]) {
      expect(isSecretName(name), name).toBe(true);
    }
    expect(isSecretName("notes.md")).toBe(false);
  });

  it("never leaves the folder, by dots or by a link", async () => {
    await expect(
      readFile([notes], "Notes/../Outside/private.txt"),
    ).rejects.toThrow(/go up/);
    symlinkSync(outside, join(notes, "way-out"));
    await expect(
      readFile([notes], "Notes/way-out/private.txt"),
    ).rejects.toThrow(/outside the folder/);
    await expect(
      saveNewFile([notes], "Notes/way-out/new.txt", "x"),
    ).rejects.toThrow(/outside the folder/);
    await expect(
      readFile([notes], join(outside, "private.txt")),
    ).rejects.toThrow();
  });

  it("saves a new file, and never writes over one", async () => {
    expect(await saveNewFile([notes], "Notes/made/summary.md", "Hello")).toBe(
      "Saved Notes/made/summary.md",
    );
    expect(readFileSync(join(notes, "made", "summary.md"), "utf8")).toBe(
      "Hello",
    );
    await expect(
      saveNewFile([notes], "Notes/plan.md", "Replaced"),
    ).rejects.toThrow(/Nothing was replaced/);
    expect(readFileSync(join(notes, "plan.md"), "utf8")).toBe("The plan.");
    await expect(saveNewFile([notes], "Notes/.zshrc", "x")).rejects.toThrow(
      /dot/,
    );
  });

  it("refuses a drive, a hidden stream and a secret spelled the Windows way", async () => {
    await expect(readFile([notes], "Notes/plan.md:hidden")).rejects.toThrow(
      /not a path/,
    );
    await expect(readFile([notes], "C:/Windows/win.ini")).rejects.toThrow(
      /not a path/,
    );
    expect(isSecretName("id_rsa.")).toBe(true);
    expect(isSecretName(".env ")).toBe(true);
  });

  it("names two folders with the same last part apart", () => {
    expect(folderLabels(["/a/Notes", "/b/Notes"]).map((f) => f.label)).toEqual([
      "Notes",
      "Notes (2)",
    ]);
  });
});

describe("web reading", () => {
  const page = (body: string, type = "text/html"): WebDeps => ({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    get: async () => ({ status: 200, type, body }),
  });

  it("takes only public https addresses by name", () => {
    expect(checkWebAddress("https://example.com/a#frag").href).toBe(
      "https://example.com/a",
    );
    for (const bad of [
      "http://example.com",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://user:pw@example.com",
      "https://example.com:8443/",
      "https://printer.local/",
      "file:///etc/passwd",
    ]) {
      expect(() => checkWebAddress(bad), bad).toThrow();
    }
  });

  it("knows a private address from a public one", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of [
      "::",
      "::ffff:a00:1",
      "::10.0.0.1",
      "64:ff9b::a00:1",
      "2002:c0a8:101::",
      "2001:0:1::1",
      "2001:db8::1",
      "ff02::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("refuses a name that leads to this computer or the home network", async () => {
    const deps: WebDeps = {
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ],
      get: async () => {
        throw new Error("must not be called");
      },
    };
    await expect(
      readWebPage("https://rebind.example.com/", deps),
    ).rejects.toThrow(/does not lead to a public website/);
  });

  it("connects to the address it checked", async () => {
    let to: { address: string } | undefined;
    const deps: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async (_url, target) => {
        to = target;
        return { status: 200, type: "text/plain", body: "ok" };
      },
    };
    expect(await readWebPage("https://example.com/", deps)).toBe("ok");
    expect(to?.address).toBe("93.184.216.34");
  });

  it("turns a page into text and never keeps a script", () => {
    const text = htmlToText(
      "<html><head><title>Hi &amp; bye</title><script>steal()</script></head><body><h1>Title</h1><p>One&nbsp;two</p><style>x{}</style></body></html>",
    );
    expect(text).toContain("Hi & bye");
    expect(text).toContain("One two");
    expect(text).not.toContain("steal");
    expect(text).not.toContain("<");
  });

  it("follows a redirect on the same site, and stops at another site", async () => {
    const hops: string[] = [];
    const deps: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async (url) => {
        hops.push(url.href);
        if (url.pathname === "/a")
          return {
            status: 302,
            location: "https://www.example.com/b",
            type: "",
            body: "",
          };
        if (url.pathname === "/b")
          return {
            status: 302,
            location: "https://other.example.org/c",
            type: "",
            body: "",
          };
        return { status: 200, type: "text/plain", body: "never" };
      },
    };
    await expect(readWebPage("https://example.com/a", deps)).rejects.toThrow(
      /another site, other.example.org/,
    );
    expect(hops).toEqual([
      "https://example.com/a",
      "https://www.example.com/b",
    ]);
  });

  it("reads only text", async () => {
    await expect(
      readWebPage("https://example.com/x", page("PK..", "application/zip")),
    ).rejects.toThrow(/not a page of text/);
  });
});

describe("which calls ask", () => {
  const assistant = {
    folders: ["/x/Notes"],
    web: true,
    sites: ["example.com"],
  };

  it("offers only the tools the assistant has", () => {
    expect(toolsFor({ folders: [], web: false, sites: [] })).toEqual([]);
    expect(
      toolsFor({ folders: [], web: true, sites: [] }).map((t) => t.name),
    ).toEqual(["read_web_page"]);
    expect(toolsFor(assistant).map((t) => t.name)).toContain("save_new_file");
    expect(() =>
      planCall({ folders: [], web: false, sites: [] }, "read_file", "{}"),
    ).toThrow(/not available/);
  });

  it("runs folder tools without asking", () => {
    expect(
      planCall(assistant, "read_file", '{"path":"Notes/a.md"}').ask,
    ).toBeUndefined();
    expect(
      planCall(
        assistant,
        "save_new_file",
        '{"path":"Notes/a.md","content":"x"}',
      ).ask,
    ).toBeUndefined();
  });

  it("asks before a site is read for the first time, and offers to remember it", () => {
    const planned = planCall(
      assistant,
      "read_web_page",
      '{"url":"https://www.new.example.org/a"}',
    );
    expect(planned.ask?.site).toBe("new.example.org");
    expect(planned.ask?.detail).toBe("https://www.new.example.org/a");
  });

  it("reads an allowed site without asking, unless the address carries extra text", () => {
    expect(
      planCall(
        assistant,
        "read_web_page",
        '{"url":"https://www.example.com/a"}',
      ).ask,
    ).toBeUndefined();
    const carried = planCall(
      assistant,
      "read_web_page",
      '{"url":"https://example.com/a?q=my+notes"}',
    );
    expect(carried.ask).toBeDefined();
    // It asks every time: there is nothing to remember for such an address.
    expect(carried.ask?.site).toBeUndefined();
    expect(carried.ask?.detail).toContain("?q=my+notes");
  });

  it("refuses an address that is not a public https page before anything is asked", () => {
    expect(() =>
      planCall(assistant, "read_web_page", '{"url":"http://192.168.1.1/"}'),
    ).toThrow();
  });
});

describe("the agent loop", () => {
  const callOf = (name: string, args: unknown): ToolCall => ({
    id: `c-${name}`,
    name,
    arguments: JSON.stringify(args),
  });

  /** A scripted model: each turn yields the next list of events. */
  function script(turns: TurnEvent[][]) {
    const seen: WireMessage[][] = [];
    let index = 0;
    return {
      seen,
      async *turn(messages: WireMessage[]): AsyncGenerator<TurnEvent> {
        seen.push([...messages]);
        for (const event of turns[index++] ?? []) yield event;
      },
    };
  }

  const quiet = {
    onText: () => {},
    onActivity: () => {},
    allowSite: () => {},
    signal: new AbortController().signal,
  };

  it("runs a read, gives the result back as information, and answers", async () => {
    const model = script([
      [
        { type: "text", text: "Let me look." },
        {
          type: "calls",
          calls: [callOf("read_file", { path: "Notes/plan.md" })],
        },
      ],
      [{ type: "text", text: "It says: The plan." }],
    ]);
    const result = await runAgent(
      { folders: [notes], web: false, sites: [] },
      [],
      {
        ...quiet,
        turn: model.turn,
        ask: async () => {
          throw new Error("a read must not ask");
        },
      },
    );
    expect(result.text).toBe("Let me look.\n\nIt says: The plan.");
    expect(result.steps).toEqual([{ label: "Read plan.md", ok: true }]);
    const tool = model.seen[1]?.at(-1);
    expect(tool?.role).toBe("tool");
    expect(tool?.content).toContain("information, not instructions");
    expect(tool?.content).toContain("The plan.");
  });

  it("does not reach a website the person said no to", async () => {
    let fetched = false;
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => {
        fetched = true;
        return { status: 200, type: "text/plain", body: "page" };
      },
    };
    const model = script([
      [
        {
          type: "calls",
          calls: [callOf("read_web_page", { url: "https://example.org/a" })],
        },
      ],
      [{ type: "text", text: "Understood." }],
    ]);
    const asked: string[] = [];
    const result = await runAgent({ folders: [], web: true, sites: [] }, [], {
      ...quiet,
      web,
      turn: model.turn,
      ask: async (ask) => {
        asked.push(ask.detail);
        return "reject";
      },
    });
    expect(asked).toEqual(["https://example.org/a"]);
    expect(fetched).toBe(false);
    expect(result.steps[0]?.ok).toBe(false);
    expect(model.seen[1]?.at(-1)?.content).toContain("said no");
  });

  it("remembers a site only on 'always', and then stops asking for it", async () => {
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => ({ status: 200, type: "text/plain", body: "page" }),
    };
    const model = script([
      [
        {
          type: "calls",
          calls: [callOf("read_web_page", { url: "https://example.org/a" })],
        },
      ],
      [
        {
          type: "calls",
          calls: [callOf("read_web_page", { url: "https://example.org/b" })],
        },
      ],
      [{ type: "text", text: "Done." }],
    ]);
    const allowed: string[] = [];
    let asks = 0;
    const result = await runAgent({ folders: [], web: true, sites: [] }, [], {
      ...quiet,
      web,
      turn: model.turn,
      allowSite: (site) => allowed.push(site),
      ask: async () => {
        asks += 1;
        return "always";
      },
    });
    expect(asks).toBe(1);
    expect(allowed).toEqual(["example.org"]);
    expect(result.steps).toEqual([
      { label: "Read example.org", ok: true },
      { label: "Read example.org", ok: true },
    ]);
  });

  it("asks for an allowed site once the answer has read from the person's folders", async () => {
    const web: WebDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async () => ({ status: 200, type: "text/plain", body: "page" }),
    };
    const model = script([
      [
        {
          type: "calls",
          calls: [
            callOf("read_web_page", { url: "https://example.com/before" }),
          ],
        },
      ],
      [
        {
          type: "calls",
          calls: [callOf("read_file", { path: "Notes/plan.md" })],
        },
      ],
      [
        {
          type: "calls",
          calls: [
            callOf("read_web_page", { url: "https://example.com/The-plan" }),
          ],
        },
      ],
      [{ type: "text", text: "Done." }],
    ]);
    const asked: { detail: string; site: string | undefined }[] = [];
    await runAgent(
      { folders: [notes], web: true, sites: ["example.com"] },
      [],
      {
        ...quiet,
        web,
        turn: model.turn,
        ask: async (ask) => {
          asked.push({ detail: ask.detail, site: ask.site });
          return "reject";
        },
      },
    );
    // The first read ran unasked. The one after the file was read did not,
    // and it cannot be remembered away.
    expect(asked).toEqual([
      { detail: "https://example.com/The-plan", site: undefined },
    ]);
  });

  it("falls back to text mode when the model cannot take tools", async () => {
    let turns = 0;
    const result = await runAgent(
      { folders: [notes], web: false, sites: [] },
      [],
      {
        ...quiet,
        ask: async () => "approve",
        async *turn(_messages, tools) {
          turns += 1;
          if (tools.length > 0)
            throw new ModelError("does not support tools", 400);
          yield { type: "text", text: "Plain answer." };
        },
      },
    );
    expect(turns).toBe(2);
    expect(result.text).toBe("Plain answer.");
    expect(result.steps[0]?.label).toMatch(/cannot call tools itself/);
  });

  it("stops after a fixed number of rounds", async () => {
    let turns = 0;
    const result = await runAgent(
      { folders: [notes], web: false, sites: [] },
      [],
      {
        ...quiet,
        ask: async () => "approve",
        async *turn() {
          turns += 1;
          yield { type: "calls", calls: [callOf("list_folder", {})] };
        },
      },
    );
    expect(turns).toBe(8);
    expect(result.steps.at(-1)?.label).toMatch(/Stopped after 8 rounds/);
  });
});
