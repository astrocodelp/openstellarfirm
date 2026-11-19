import { describe, expect, it } from "vitest";
import { presetOf } from "../shared/catalog";
import type { ModelInfo } from "../shared/types";
import {
  contextText,
  filterModels,
  modelFacts,
  orderModels,
  type PickerState,
  pickerKey,
} from "./src/model-picker";

const models: ModelInfo[] = [
  { id: "qwen3:8b", created: 1_000 },
  { id: "llama3.2:3b", name: "Llama 3.2", created: 3_000 },
  { id: "gemma3:4b", pictures: true },
  { id: "openai/gpt-4o-mini", name: "GPT-4o mini", created: 2_000 },
];

const closed: PickerState = { open: false, active: -1 };

describe("the model picker's order", () => {
  it("puts the recommended model first, then the newest, then the rest by name", () => {
    expect(orderModels(models, "gemma3:4b").map((m) => m.id)).toEqual([
      "gemma3:4b",
      "llama3.2:3b",
      "openai/gpt-4o-mini",
      "qwen3:8b",
    ]);
    expect(orderModels(models).map((m) => m.id)[0]).toBe("llama3.2:3b");
  });
});

describe("filtering", () => {
  it("keeps models whose id or name has every word, in any case", () => {
    expect(filterModels(models, "LLAMA").map((m) => m.id)).toEqual([
      "llama3.2:3b",
    ]);
    expect(filterModels(models, "gpt mini").map((m) => m.id)).toEqual([
      "openai/gpt-4o-mini",
    ]);
    expect(filterModels(models, "  ")).toBe(models);
  });

  it("puts an exact id, then ids that start with the words, first", () => {
    const list: ModelInfo[] = [
      { id: "my-gemma3" },
      { id: "gemma3:12b" },
      { id: "gemma3" },
    ];
    expect(filterModels(list, "gemma3").map((m) => m.id)).toEqual([
      "gemma3",
      "gemma3:12b",
      "my-gemma3",
    ]);
  });

  it("finds nothing for a name the list does not have", () => {
    expect(filterModels(models, "my-own-model")).toEqual([]);
  });
});

describe("what a row says", () => {
  it("writes the window the way people say it, and what the model can do", () => {
    expect(contextText(8192)).toBe("8K");
    expect(contextText(128_000)).toBe("128K");
    expect(contextText(1_000_000)).toBe("1M");
    expect(contextText(1_500_000)).toBe("1.5M");
    expect(contextText(512)).toBe("512");
    expect(
      modelFacts({ id: "m", context: 131072, pictures: true, tools: true }),
    ).toBe("131K context · reads pictures · uses tools");
    expect(modelFacts({ id: "m" })).toBe("");
  });
});

describe("keys in the model box", () => {
  it("opens on Down at the chosen model, or the first, and moves with the arrows", () => {
    expect(pickerKey(closed, { key: "ArrowDown" }, 4).state).toEqual({
      open: true,
      active: 0,
    });
    expect(
      pickerKey({ open: false, active: 2 }, { key: "ArrowDown" }, 4).state,
    ).toEqual({ open: true, active: 2 });
    const open = { open: true, active: 3 };
    expect(pickerKey(open, { key: "ArrowDown" }, 4).state.active).toBe(0);
    expect(pickerKey(open, { key: "ArrowUp" }, 4).state.active).toBe(2);
    expect(pickerKey(closed, { key: "ArrowUp" }, 4).state).toEqual({
      open: true,
      active: 3,
    });
  });

  it("opens on Alt+Down without moving, and closes on Alt+Up", () => {
    expect(
      pickerKey(closed, { key: "ArrowDown", altKey: true }, 4).state,
    ).toEqual({ open: true, active: -1 });
    expect(
      pickerKey({ open: true, active: 1 }, { key: "ArrowUp", altKey: true }, 4)
        .state.open,
    ).toBe(false);
  });

  it("never lets Enter submit the form: it chooses the highlighted row", () => {
    const result = pickerKey({ open: true, active: 1 }, { key: "Enter" }, 4);
    expect(result.prevent).toBe(true);
    expect(result.choose).toBe(1);
    expect(result.state.open).toBe(false);
  });

  it("keeps a typed name on Enter when nothing in the list matches it", () => {
    const result = pickerKey({ open: true, active: -1 }, { key: "Enter" }, 0);
    expect(result.prevent).toBe(true);
    expect(result.choose).toBeUndefined();
    const shut = pickerKey(closed, { key: "Enter" }, 4);
    expect(shut.prevent).toBe(true);
    expect(shut.choose).toBeUndefined();
  });

  it("closes an open list on Esc and keeps the key from a dialog around it", () => {
    const result = pickerKey({ open: true, active: 0 }, { key: "Escape" }, 4);
    expect(result).toEqual({
      state: { open: false, active: 0 },
      prevent: true,
      stop: true,
    });
    // With the list closed, Esc is left to whatever holds the box.
    const left = pickerKey(closed, { key: "Escape" }, 4);
    expect(left.prevent).toBe(false);
    expect(left.stop).toBe(false);
  });

  it("closes on Tab without choosing, and leaves keys alone while composing", () => {
    const tab = pickerKey({ open: true, active: 2 }, { key: "Tab" }, 4);
    expect(tab.state.open).toBe(false);
    expect(tab.prevent).toBe(false);
    expect(tab.choose).toBeUndefined();
    const ime = pickerKey(
      { open: true, active: 0 },
      { key: "Enter", isComposing: true },
      4,
    );
    expect(ime.prevent).toBe(false);
    expect(ime.choose).toBeUndefined();
  });

  it("does nothing to arrows when there is nothing to show", () => {
    const result = pickerKey(closed, { key: "ArrowDown" }, 0);
    expect(result.state).toEqual(closed);
    expect(result.prevent).toBe(true);
  });
});

describe("a service with no list", () => {
  it("offers suggestions, which a typed id can still pass", () => {
    const suggested = presetOf("bedrock").suggested ?? [];
    expect(suggested.length).toBeGreaterThan(0);
    // A name not among the suggestions filters to nothing, and Enter keeps it.
    expect(filterModels(suggested, "my-provisioned-model")).toEqual([]);
    const enter = pickerKey({ open: true, active: -1 }, { key: "Enter" }, 0);
    expect(enter.choose).toBeUndefined();
    expect(enter.prevent).toBe(true);
  });
});
