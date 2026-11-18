import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SecretBox, Secrets } from "./secrets";
import { Store } from "./store";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stellarfirm-open-"));
  store = new Store(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const input = {
  name: " Scout ",
  group: "",
  pet: "glim",
  color: "sky",
  brief: "Plan trips.",
  skills: ["plan", "plan"],
} as const;

describe("assistants", () => {
  it("cleans and keeps an assistant", () => {
    const saved = store.saveAssistant({ ...input, skills: [...input.skills] });
    expect(saved).toMatchObject({
      name: "Scout",
      group: "Personal",
      pet: "glim",
      color: "sky",
      skills: ["plan"],
    });
    expect(new Store(dir).assistants()).toEqual([saved]);
  });

  it("keeps a name on one line", () => {
    const saved = store.saveAssistant({
      ...input,
      name: "Sco\nut\u0007",
      skills: [],
    });
    expect(saved.name).toBe("Sco ut");
  });

  it("keeps line breaks and tabs in a brief, and drops other control characters", () => {
    const saved = store.saveAssistant({
      ...input,
      brief: "One\n\tTwo\u0007\u0000 three\r",
      skills: [],
    });
    expect(saved.brief).toBe("One\n\tTwo three");
  });

  it("refuses a missing name and an unknown look", () => {
    expect(() =>
      store.saveAssistant({ ...input, name: " ", skills: [] }),
    ).toThrow(/name/);
    expect(() =>
      store.saveAssistant({ ...input, pet: "dragon" as never, skills: [] }),
    ).toThrow(/look/);
  });

  it("keeps the chat, the last line, and forgets both on removal", () => {
    const a = store.saveAssistant({ ...input, skills: [] });
    store.appendMessage(a.id, "user", "hello\nthere");
    store.appendMessage(a.id, "assistant", "hi");
    expect(store.messages(a.id).map((m) => m.text)).toEqual([
      "hello\nthere",
      "hi",
    ]);
    expect(store.assistant(a.id).lastLine).toBe("hi");
    store.removeAssistant(a.id);
    expect(store.assistants()).toEqual([]);
    expect(() => store.messages(a.id)).toThrow(/no longer here/);
  });

  it("never lets an id from the page name a file outside the chats folder", () => {
    expect(() => store.messages("../../state")).toThrow(/no longer here/);
  });
});

describe("folders and sites", () => {
  it("never takes a folder or a site from what the page sends", () => {
    const sneaky = {
      ...input,
      skills: [],
      folders: ["/"],
      sites: ["evil.example.com"],
    };
    const made = store.saveAssistant(sneaky);
    expect(made.folders).toEqual([]);
    expect(made.sites).toEqual([]);
    store.addFolder(made.id, "/picked/Notes");
    store.addSite(made.id, "example.com");
    const saved = store.saveAssistant({ ...sneaky, id: made.id, web: true });
    expect(saved.folders).toEqual(["/picked/Notes"]);
    expect(saved.sites).toEqual(["example.com"]);
    expect(saved.web).toBe(true);
    // A save that says nothing about web pages leaves that choice as it was.
    expect(store.saveAssistant({ ...input, skills: [], id: made.id }).web).toBe(
      true,
    );
    expect(store.removeFolder(made.id, "/picked/Notes").folders).toEqual([]);
    expect(store.removeSite(made.id, "example.com").sites).toEqual([]);
  });

  it("never puts folders, sites or a model source in a shared file", () => {
    const made = store.saveAssistant({ ...input, skills: [], web: true });
    store.addFolder(made.id, "/picked/Notes");
    store.addSite(made.id, "example.com");
    const file = JSON.stringify(store.exportFile(made.id));
    expect(file).not.toContain("/picked/Notes");
    expect(file).not.toContain("example.com");
    const imported = store.importFile(
      JSON.stringify({
        ...store.exportFile(made.id),
        folders: ["/"],
        sites: ["evil.example.com"],
        web: true,
      }),
    );
    expect(imported.folders).toEqual([]);
    expect(imported.sites).toEqual([]);
    // An imported assistant starts with no access: the person turns it on.
    expect(imported.web).toBe(false);
  });
});

describe("screen access", () => {
  it("is off by default and is set only by the person's own save", () => {
    const made = store.saveAssistant({ ...input, skills: [] });
    expect(made.screen).toBe(false);
    const on = store.saveAssistant({
      ...input,
      skills: [],
      id: made.id,
      screen: true,
    });
    expect(on.screen).toBe(true);
    // A save that says nothing about the screen leaves that choice as it was.
    expect(
      store.saveAssistant({ ...input, skills: [], id: made.id }).screen,
    ).toBe(true);
    expect(
      store.saveAssistant({ ...input, skills: [], id: made.id, screen: false })
        .screen,
    ).toBe(false);
  });

  it("reads an assistant saved before the switch existed as off", () => {
    const made = store.saveAssistant({ ...input, skills: [] });
    const file = join(dir, "state.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    delete state.assistants[0].screen;
    writeFileSync(file, JSON.stringify(state));
    expect(store.assistant(made.id).screen).toBe(false);
  });

  it("never puts the switch in a shared file, and never takes it from one", () => {
    const made = store.saveAssistant({ ...input, skills: [], screen: true });
    const exported = store.exportFile(made.id);
    expect(JSON.stringify(exported)).not.toMatch(/screen/i);
    const imported = store.importFile(
      JSON.stringify({ ...exported, screen: true }),
    );
    expect(imported.screen).toBe(false);
  });

  it("keeps no picture in a saved chat, whatever the answer's steps say", () => {
    const made = store.saveAssistant({ ...input, skills: [], screen: true });
    store.appendMessage(made.id, "assistant", "I can see a window.", false, [
      { label: "Looked at the screen at 14:05", ok: true },
    ]);
    const saved = readFileSync(join(dir, "chats", `${made.id}.json`), "utf8");
    expect(saved).toContain("Looked at the screen at 14:05");
    expect(saved).not.toContain("base64");
    expect(saved).not.toContain("image");
  });
});

describe("assistant files", () => {
  it("round-trips an assistant without any model source", () => {
    const source = store.saveSource({ preset: "ollama", model: "m" });
    const a = store.saveAssistant({
      ...input,
      skills: ["plan"],
      sourceId: source.id,
      model: "own",
    });
    const file = store.exportFile(a.id);
    expect(JSON.stringify(file)).not.toContain(source.id);
    expect(file).not.toHaveProperty("model");
    const imported = store.importFile(
      JSON.stringify({ ...file, sourceId: source.id, model: "sneaky" }),
    );
    expect(imported).toMatchObject({ name: "Scout", skills: ["plan"] });
    expect(imported.sourceId).toBeUndefined();
    expect(imported.model).toBeUndefined();
  });

  it("refuses a file that is not an assistant file", () => {
    expect(() => store.importFile("{}")).toThrow(/not an assistant file/);
    expect(() => store.importFile("nope")).toThrow(/not an assistant file/);
  });
});

describe("model sources", () => {
  it("pins a preset to its own address, whatever the page sends", () => {
    const saved = store.saveSource({
      preset: "openai",
      baseUrl: "https://evil.example.com/v1",
      model: "m",
    });
    expect(saved.baseUrl).toBe("https://api.openai.com/v1");
    expect(store.settings().defaultSourceId).toBe(saved.id);
  });

  it("decides the wire from the preset, never from the page", () => {
    const sent = (preset: "anthropic" | "gemini" | "openai" | "custom") =>
      store.saveSource({
        preset,
        baseUrl: "https://models.example.com/v1",
        wire: "openai",
        model: "m",
      } as never);
    expect(sent("anthropic")).toMatchObject({
      baseUrl: "https://api.anthropic.com/v1",
      wire: "anthropic",
    });
    expect(sent("gemini")).toMatchObject({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      wire: "gemini",
    });
    expect(sent("openai").wire).toBe("openai");
    expect(sent("custom").wire).toBe("openai");
    const first = store.sources()[0];
    const again = store.saveSource({
      id: first?.id,
      preset: "openai",
      wire: "gemini",
      model: "m",
    } as never);
    expect(again.wire).toBe("openai");
  });

  it("reads a source saved before wires existed as openai", () => {
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        v: 1,
        assistants: [],
        sources: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            preset: "openai",
            name: "OpenAI",
            baseUrl: "https://api.openai.com/v1",
            model: "m",
          },
        ],
        settings: { onboarded: true },
      }),
    );
    expect(store.sources()[0]?.wire).toBe("openai");
  });

  it("checks a custom address", () => {
    expect(() =>
      store.saveSource({
        preset: "custom",
        baseUrl: "http://models.example.com/v1",
        model: "m",
      }),
    ).toThrow(/https/);
    expect(
      store.saveSource({
        preset: "custom",
        baseUrl: "https://models.example.com/v1/",
        model: "m",
      }).baseUrl,
    ).toBe("https://models.example.com/v1");
  });

  it("moves the default and frees its assistants when a source is removed", () => {
    const first = store.saveSource({ preset: "ollama", model: "m" });
    const second = store.saveSource({ preset: "lmstudio", model: "m" });
    const a = store.saveAssistant({
      ...input,
      skills: [],
      sourceId: first.id,
      model: "own",
    });
    store.removeSource(first.id);
    expect(store.settings().defaultSourceId).toBe(second.id);
    expect(store.assistant(a.id).sourceId).toBeUndefined();
    expect(store.assistant(a.id).model).toBeUndefined();
  });
});

describe("secrets", () => {
  const box = (available: boolean, stale = false): SecretBox => ({
    available: async () => available,
    seal: async (plain) => Buffer.from(plain.split("").reverse().join("")),
    open: async (sealed) => ({
      plain: sealed.toString().split("").reverse().join(""),
      stale,
    }),
  });

  it("keeps a key sealed on disk and gives it back", async () => {
    const file = join(dir, "keys.json");
    const secrets = new Secrets(file, box(true));
    await secrets.set("a", "sk-test-123");
    expect(readFileSync(file, "utf8")).not.toContain("sk-test-123");
    expect(secrets.has("a")).toBe(true);
    expect(await secrets.get("a")).toBe("sk-test-123");
    secrets.remove("a");
    expect(secrets.has("a")).toBe(false);
    expect(await secrets.get("a")).toBeUndefined();
  });

  it("seals a key again when the keychain says its own key changed", async () => {
    const file = join(dir, "keys.json");
    await new Secrets(file, box(true)).set("a", "sk-test-123");
    const before = readFileSync(file, "utf8");
    expect(await new Secrets(file, box(true, true)).get("a")).toBe(
      "sk-test-123",
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("finds no key under a name the app did not make", async () => {
    const secrets = new Secrets(join(dir, "keys.json"), box(true));
    await secrets.set("a", "sk-test-123");
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(secrets.has(id), id).toBe(false);
      expect(await secrets.get(id), id).toBeUndefined();
      secrets.remove(id);
    }
    expect(await secrets.get("a")).toBe("sk-test-123");
  });

  it("refuses to save a key when there is no keychain", async () => {
    const secrets = new Secrets(join(dir, "keys.json"), box(false));
    await expect(secrets.set("a", "sk-test-123")).rejects.toThrow(
      /no keychain/,
    );
    expect(secrets.has("a")).toBe(false);
  });
});

describe("the theme", () => {
  it("reads as the system's setting until the person chooses", () => {
    expect(store.settings().theme).toBe("system");
  });

  it("keeps a chosen theme, and refuses one it does not know", () => {
    expect(store.setSettings({ theme: "light" }).theme).toBe("light");
    expect(store.setSettings({ theme: "dark" }).theme).toBe("dark");
    expect(() => store.setSettings({ theme: "sepia" as never })).toThrow(
      /theme/,
    );
    expect(store.settings().theme).toBe("dark");
    // A save about something else leaves it alone.
    expect(store.setSettings({ hideCloudCard: true }).theme).toBe("dark");
  });

  it("reads a settings file from before the theme existed as system", () => {
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        v: 1,
        assistants: [],
        sources: [],
        settings: { onboarded: true },
      }),
    );
    const old = store;
    expect(old.settings()).toEqual({
      onboarded: true,
      theme: "system",
      textSize: "default",
      sendWith: "enter",
      checkUpdates: false,
    });
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        v: 1,
        assistants: [],
        sources: [],
        settings: { onboarded: true, theme: "neon" },
      }),
    );
    expect(old.settings().theme).toBe("system");
  });
});
