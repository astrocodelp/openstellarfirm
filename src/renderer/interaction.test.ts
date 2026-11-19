import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rowEnd } from "../shared/connection-gallery";
import { paletteItems } from "./src/palette-items";
import { pasteIsFiles } from "./src/paste";
import { type SearchKeyEvent, searchKey } from "./src/SearchInput";
import { SETTINGS_SECTIONS } from "./src/settings-sections";

/**
 * The interaction rules a UI review found broken, kept from coming back. Vitest
 * has no page here, so the pure rules are run and the rest is read from the
 * source.
 */

const dir = join(import.meta.dirname, "src");
const source = (name: string) => readFileSync(join(dir, name), "utf8");
const tsx = readdirSync(dir).filter((name) => name.endsWith(".tsx"));

function key(name: string, composing = false) {
  const calls = { prevented: false, stopped: false };
  const event: SearchKeyEvent = {
    key: name,
    nativeEvent: { isComposing: composing },
    preventDefault: () => {
      calls.prevented = true;
    },
    stopPropagation: () => {
      calls.stopped = true;
    },
  };
  return { event, calls };
}

describe("search boxes", () => {
  it("never let Enter submit the form around them", () => {
    const { event, calls } = key("Enter");
    let entered = false;
    searchKey(event, "tax", () => {}, {
      onEnter: () => {
        entered = true;
      },
    });
    expect(calls.prevented).toBe(true);
    expect(entered).toBe(true);
    // Also with nothing to do on Enter.
    const plain = key("Enter");
    searchKey(plain.event, "", () => {});
    expect(plain.calls.prevented).toBe(true);
  });

  it("clear the words on Esc first, and leave an empty Esc to the dialog", () => {
    let cleared = false;
    const typed = key("Escape");
    searchKey(typed.event, "git", () => {
      cleared = true;
    });
    expect(cleared).toBe(true);
    expect(typed.calls.prevented).toBe(true);

    const empty = key("Escape");
    searchKey(empty.event, "", () => {
      throw new Error("nothing to clear");
    });
    expect(empty.calls.prevented).toBe(false);
  });

  it("leave keys alone while an input method is composing", () => {
    const { event, calls } = key("Enter", true);
    searchKey(event, "かな", () => {});
    expect(calls.prevented).toBe(false);
  });

  it("are all the shared SearchInput", () => {
    const raw = tsx.filter(
      (name) =>
        name !== "SearchInput.tsx" && /type="search"/.test(source(name)),
    );
    expect(raw).toEqual([]);
  });
});

describe("pasting into the message box", () => {
  const clip = (files: { type: string; name: string }[], text = "") => ({
    files,
    getData: (format: string) => (format === "text/plain" ? text : ""),
  });

  it("keeps the words when an Office app added a picture of them", () => {
    expect(
      pasteIsFiles(
        clip([{ type: "image/png", name: "image.png" }], "Q3\t1200\n"),
      ),
    ).toBe(false);
  });

  it("attaches a screenshot, a copied picture file and any other file", () => {
    expect(pasteIsFiles(clip([{ type: "image/png", name: "image.png" }]))).toBe(
      true,
    );
    expect(
      pasteIsFiles(clip([{ type: "image/jpeg", name: "cat.jpg" }], "cat.jpg")),
    ).toBe(true);
    expect(
      pasteIsFiles(
        clip([{ type: "application/pdf", name: "a.pdf" }], "Some words"),
      ),
    ).toBe(true);
  });

  it("is text when nothing was copied as a file", () => {
    expect(pasteIsFiles(clip([], "hello"))).toBe(false);
    expect(pasteIsFiles(null)).toBe(false);
  });
});

describe("the connections gallery", () => {
  it("opens a card's form after the last card of its row", () => {
    expect(rowEnd(0, 10, 3)).toBe(2);
    expect(rowEnd(4, 10, 3)).toBe(5);
    expect(rowEnd(9, 10, 3)).toBe(9);
    expect(rowEnd(7, 8, 3)).toBe(7);
    expect(rowEnd(2, 5, 1)).toBe(2);
    expect(rowEnd(0, 1, 0)).toBe(0);
  });

  it("names its cards apart from the ready-made assistants' cards", () => {
    const rules = (css: string) =>
      new Set(
        [...css.matchAll(/^\.([\w-]+)[^{]*\{/gm)].map((match) => match[1]),
      );
    const main = rules(source("styles.css"));
    const both = [...rules(source("gallery.css"))].filter((name) =>
      main.has(name),
    );
    expect(both).toEqual([]);
  });
});

describe("Settings and Find anything", () => {
  it("draw every section heading from the one list", () => {
    const sections = tsx.flatMap((name) => [
      ...source(name).matchAll(/<Section\b([^>]*)>/g),
    ]);
    expect(sections.length).toBe(SETTINGS_SECTIONS.length);
    const used = sections.map(([, attrs = ""]) => {
      expect(attrs).toMatch(/section="/);
      return /section="([^"]+)"/.exec(attrs)?.[1];
    });
    expect(new Set(used)).toEqual(new Set(SETTINGS_SECTIONS.map((s) => s.id)));
  });

  it("find every section and the shortcuts list", () => {
    const labels = paletteItems({
      assistants: [],
      connections: [],
      mailAccounts: [],
    }).map((item) => item.label);
    for (const section of SETTINGS_SECTIONS)
      expect(labels).toContain(section.title);
    expect(labels).toContain("Keyboard shortcuts");
  });
});

describe("the chat", () => {
  it("gives each assistant its own chat view, so a question never carries over", () => {
    expect(source("App.tsx")).toMatch(/<ChatView[^>]*key=\{assistant\.id\}/s);
  });

  it("keeps a hidden Forget button out of reach of a tap", () => {
    const css = source("styles.css");
    const rule = /\.forget-btn \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toMatch(/opacity: 0;/);
    expect(rule).toMatch(/pointer-events: none;/);
  });

  it("never disables a button while its own work runs, so the focus stays", () => {
    expect(source("ChatTools.tsx")).not.toMatch(
      /(?<!aria-)disabled=\{[^}]*saving/,
    );
    expect(source("Attachments.tsx")).not.toMatch(
      /(?<!aria-)disabled=\{[^}]*adding/,
    );
  });
});
