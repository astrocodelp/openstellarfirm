import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./store";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stellarfirm-solo-"));
  store = new Store(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const assistant = (name: string) => ({
  name,
  group: "Work",
  pet: "glim" as const,
  color: "sky" as const,
  brief: "Help.",
  skills: [],
});

describe("text size, sending and updates", () => {
  it("start at the defaults, with updates off", () => {
    expect(store.settings()).toMatchObject({
      textSize: "default",
      sendWith: "enter",
      checkUpdates: false,
    });
  });

  it("keep a choice and refuse one that is unknown", () => {
    expect(store.setSettings({ textSize: "large" }).textSize).toBe("large");
    expect(store.setSettings({ sendWith: "mod-enter" }).sendWith).toBe(
      "mod-enter",
    );
    expect(store.setSettings({ checkUpdates: true }).checkUpdates).toBe(true);
    expect(() => store.setSettings({ textSize: "huge" as never })).toThrow();
    expect(() => store.setSettings({ sendWith: "tab" as never })).toThrow();
    expect(() => store.setSettings({ checkUpdates: "yes" as never })).toThrow();
    expect(store.settings()).toMatchObject({
      textSize: "large",
      sendWith: "mod-enter",
      checkUpdates: true,
    });
  });

  it("read an old or hand-edited file with defaults, and drop bad update fields", () => {
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        v: 1,
        assistants: [],
        sources: [],
        settings: {
          onboarded: true,
          textSize: "gigantic",
          sendWith: 3,
          checkUpdates: "true",
          lastUpdateCheck: "yesterday",
          newestVersion: "v1.0.0/../../x",
          dismissedVersion: { a: 1 },
        },
      }),
    );
    expect(store.settings()).toEqual({
      onboarded: true,
      theme: "system",
      textSize: "default",
      sendWith: "enter",
      checkUpdates: false,
    });
  });

  it("cannot have the update fields set through setSettings", () => {
    store.setSettings({
      newestVersion: "9.9.9",
      dismissedVersion: "9.9.9",
      lastUpdateCheck: "2026-01-01T00:00:00Z",
    });
    expect(store.settings().newestVersion).toBeUndefined();
    expect(store.settings().dismissedVersion).toBeUndefined();
    expect(store.settings().lastUpdateCheck).toBeUndefined();
  });

  it("remember a check, forget a version, and dismiss only what is shown", () => {
    const at = new Date("2026-11-19T10:00:00Z");
    store.recordUpdateCheck(at, "0.2.0");
    expect(store.settings()).toMatchObject({
      lastUpdateCheck: at.toISOString(),
      newestVersion: "0.2.0",
    });
    store.recordUpdateCheck(at);
    expect(store.settings().newestVersion).toBe("0.2.0");
    expect(() => store.recordUpdateCheck(at, "0.2.0/../x")).toThrow();
    store.dismissUpdate();
    expect(store.settings().dismissedVersion).toBe("0.2.0");
    store.recordUpdateCheck(at, null);
    expect(store.settings().newestVersion).toBeUndefined();
    expect(store.settings().dismissedVersion).toBe("0.2.0");
  });
});

describe("clearing approvals", () => {
  it("forgets every remembered site for every assistant and counts them", () => {
    const a = store.saveAssistant(assistant("A"));
    const b = store.saveAssistant(assistant("B"));
    store.addSite(a.id, "example.com");
    store.addSite(a.id, "docs.example.com");
    store.addSite(b.id, "example.com");
    store.addFolder(b.id, "/Users/you/Notes");
    expect(store.clearApprovals()).toBe(3);
    expect(store.assistant(a.id).sites).toEqual([]);
    expect(store.assistant(b.id).sites).toEqual([]);
    // Nothing else about an assistant changes.
    expect(store.assistant(b.id).folders).toEqual(["/Users/you/Notes"]);
    expect(store.clearApprovals()).toBe(0);
  });
});

describe("deleting all chats", () => {
  it("removes every chat, keeps the assistants and clears their last line", () => {
    const a = store.saveAssistant(assistant("A"));
    const b = store.saveAssistant(assistant("B"));
    store.appendMessage(a.id, "user", "hello");
    store.appendMessage(a.id, "assistant", "hi");
    store.appendMessage(b.id, "user", "hey");
    expect(store.assistant(a.id).lastLine).toBe("hi");
    expect(store.deleteAllChats()).toBe(2);
    expect(store.messages(a.id)).toEqual([]);
    expect(store.messages(b.id)).toEqual([]);
    expect(store.assistants().map((x) => x.name)).toEqual(["A", "B"]);
    expect(store.assistant(a.id).lastLine).toBeUndefined();
    expect(existsSync(join(dir, "chats", `${a.id}.json`))).toBe(false);
    expect(readFileSync(join(dir, "state.json"), "utf8")).not.toContain(
      "hello",
    );
    expect(store.deleteAllChats()).toBe(0);
  });

  it("tells the page where it keeps things", () => {
    expect(store.folder).toBe(dir);
  });
});
