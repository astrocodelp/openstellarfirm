import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloudCopyUrl } from "../shared/cloud";
import { buildBackup, restoreBackup } from "./backup";
import { MemoryStore } from "./memory";
import { Store } from "./store";

let dirs: string[] = [];
function fresh(): { store: Store; memory: MemoryStore } {
  const dir = mkdtempSync(join(tmpdir(), "openstellarfirm-"));
  dirs.push(dir);
  return { store: new Store(dir), memory: new MemoryStore(dir) };
}
beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const base = {
  pet: "glim" as const,
  color: "sky" as const,
  group: "Home",
  skills: [] as string[],
};

function withNotes() {
  const { store, memory } = fresh();
  const scout = store.saveAssistant({
    ...base,
    name: "Scout",
    brief: "Plan trips.",
  });
  memory.add(scout.id, "Prefers night trains.");
  store.appendMessage(scout.id, "user", "Hello");
  const quiet = store.saveAssistant({ ...base, name: "Quiet", brief: "" });
  memory.setOn(quiet.id, false);
  store.saveAssistant({ ...base, name: "Plain", brief: "" });
  return { store, memory, scout };
}

describe("notes in a backup", () => {
  it("travel only when chats are in the file too", () => {
    const { store, memory } = withNotes();
    const without = JSON.stringify(
      buildBackup(store, false, new Date(), memory),
    );
    expect(without).not.toContain("Prefers night trains.");
    expect(without).not.toContain('"memory"');
    const file = buildBackup(store, true, new Date(), memory);
    expect(file.memory).toEqual({
      "0": { on: true, notes: ["Prefers night trains."] },
      "1": { on: false, notes: [] },
    });
  });

  it("are never in the file one assistant is shared as, nor its cloud link", () => {
    const { store, scout } = withNotes();
    const file = store.exportFile(scout.id);
    expect(JSON.stringify(file)).not.toContain("night trains");
    expect(decodeURIComponent(cloudCopyUrl(file))).not.toContain(
      "night trains",
    );
  });

  it("come back with the assistants they belong to", () => {
    const { store, memory } = withNotes();
    const raw = JSON.stringify(buildBackup(store, true, new Date(), memory));
    const target = fresh();
    const result = restoreBackup(target.store, raw, target.memory);
    expect(result.added).toBe(3);
    const [scout, quiet, plain] = target.store.assistants();
    expect(
      target.memory.read(scout?.id ?? "").notes.map((n) => n.text),
    ).toEqual(["Prefers night trains."]);
    expect(target.memory.read(quiet?.id ?? "").on).toBe(false);
    expect(target.memory.read(plain?.id ?? "")).toEqual({
      on: true,
      notes: [],
    });
  });

  it("are checked one by one: a note that reads like a secret stays out", () => {
    const { store } = fresh();
    store.saveAssistant({ ...base, name: "Scout", brief: "" });
    const file = buildBackup(store, true);
    file.memory = {
      "0": {
        on: true,
        notes: ["Likes tea.", "my password is hunter22", "x".repeat(900)],
      },
    };
    const target = fresh();
    restoreBackup(target.store, JSON.stringify(file), target.memory);
    const scout = target.store.assistants()[0];
    expect(
      target.memory.read(scout?.id ?? "").notes.map((n) => n.text),
    ).toEqual(["Likes tea."]);
  });

  it("are not needed: a backup made before memory still loads", () => {
    const { store } = fresh();
    store.saveAssistant({ ...base, name: "Scout", brief: "" });
    const old = buildBackup(store, true);
    expect(old.memory).toBeUndefined();
    const target = fresh();
    expect(
      restoreBackup(target.store, JSON.stringify(old), target.memory).added,
    ).toBe(1);
    // And odd memory values are ignored, never fatal.
    const odd = { ...old, memory: ["not", "a", "map"] };
    expect(
      restoreBackup(target.store, JSON.stringify(odd), target.memory).added,
    ).toBe(1);
  });
});
