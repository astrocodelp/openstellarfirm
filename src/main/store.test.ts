import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("refuses to save a key when there is no keychain", async () => {
    const secrets = new Secrets(join(dir, "keys.json"), box(false));
    await expect(secrets.set("a", "sk-test-123")).rejects.toThrow(
      /no keychain/,
    );
    expect(secrets.has("a")).toBe(false);
  });
});
