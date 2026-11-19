import { describe, expect, it } from "vitest";
import type { Assistant, Connection, MailAccount } from "../shared/types";
import {
  arrangePaletteRows,
  filterPalette,
  GROUP_LIMIT,
  type PaletteItem,
  paletteItems,
  paletteScore,
  resultCount,
} from "./src/palette-items";

/** The palette's own filtering, from the list it is built from. */

function assistant(id: string, name: string, group = "Work"): Assistant {
  return {
    id,
    name,
    group,
    pet: "glim",
    color: "lime",
    brief: "",
    skills: [],
    folders: [],
    web: false,
    sites: [],
    connections: [],
    connectionTools: [],
    createdAt: "2026-11-19T00:00:00Z",
  };
}

const assistants = [
  assistant("a1", "Research and writing"),
  assistant("a2", "Trip planner", "Home"),
  assistant("a3", "Café helper", "Home"),
];
const connections = [
  { id: "c1", name: "GitHub work", preset: "custom" } as Connection,
];
const mailAccounts = [{ id: "m1", name: "Personal mail" } as MailAccount];

const items = paletteItems({ assistants, connections, mailAccounts });
const labels = (list: PaletteItem[]) => list.map((i) => i.label);

describe("the palette's list", () => {
  it("shows assistants, actions and screens before anything is typed", () => {
    const shown = filterPalette(items, "");
    expect(new Set(shown.map((i) => i.group))).toEqual(
      new Set(["assistants", "actions", "screens"]),
    );
    expect(labels(shown)).toContain("New assistant");
    expect(labels(shown)).toContain("Move or back up");
    expect(labels(shown)).toContain("Settings");
    expect(labels(shown)).not.toContain("Appearance");
  });

  it("offers Save this chat only when a chat can be saved", () => {
    expect(labels(items)).not.toContain("Save this chat");
    const withChat = paletteItems({
      assistants,
      connections,
      mailAccounts,
      savable: assistants[1],
    });
    const save = withChat.find((i) => i.label === "Save this chat");
    expect(save?.target).toEqual({ kind: "save-chat", assistantId: "a2" });
  });

  it("finds settings sections and connections by name", () => {
    expect(labels(filterPalette(items, "appear"))).toEqual(["Appearance"]);
    // The Connections screen answers to "github" too, and screens come first.
    const github = filterPalette(items, "github");
    expect(labels(github)).toEqual(["Connections", "GitHub work"]);
    expect(github[1]?.target).toEqual({
      kind: "screen",
      screen: "connections",
    });
    expect(filterPalette(items, "personal")[0]?.target).toEqual({
      kind: "screen",
      screen: "mail",
    });
  });

  it("finds by the words an item answers to", () => {
    expect(labels(filterPalette(items, "theme"))).toEqual(["Appearance"]);
    expect(labels(filterPalette(items, "ollama"))).toEqual(["Models"]);
  });

  it("ignores case and accents", () => {
    expect(labels(filterPalette(items, "CAFE"))).toEqual(["Café helper"]);
    expect(labels(filterPalette(items, "trip PLAN"))).toEqual(["Trip planner"]);
  });

  it("keeps groups in order and the best match first in a group", () => {
    const list: PaletteItem[] = [
      {
        id: "1",
        group: "screens",
        label: "Something with mail",
        target: { kind: "new" },
      },
      { id: "2", group: "screens", label: "Mail", target: { kind: "new" } },
      {
        id: "3",
        group: "assistants",
        label: "Mailroom",
        target: { kind: "new" },
      },
      {
        id: "4",
        group: "screens",
        label: "Mailbox rules",
        target: { kind: "new" },
      },
    ];
    expect(labels(filterPalette(list, "mail"))).toEqual([
      "Mailroom",
      "Mail",
      "Mailbox rules",
      "Something with mail",
    ]);
  });

  it("scores the name above the hidden words", () => {
    const item: PaletteItem = {
      id: "x",
      group: "screens",
      label: "Models",
      keywords: "ollama",
      target: { kind: "new" },
    };
    expect(paletteScore(item, ["models"])).toBe(0);
    expect(paletteScore(item, ["mod"])).toBe(1);
    expect(paletteScore(item, ["ollama"])).toBe(4);
    expect(paletteScore(item, ["zebra"])).toBeNull();
  });

  it("shows at most a few from one group", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      assistant(`x${i}`, `Helper ${i}`),
    );
    const list = paletteItems({
      assistants: many,
      connections: [],
      mailAccounts: [],
    });
    expect(filterPalette(list, "helper")).toHaveLength(GROUP_LIMIT);
  });

  it("finds nothing for words that are nowhere", () => {
    expect(filterPalette(items, "zzzz")).toEqual([]);
  });

  it("says the count in plain words", () => {
    expect(resultCount(0)).toBe("No results");
    expect(resultCount(1)).toBe("1 result");
    expect(resultCount(12)).toBe("12 results");
  });
});

describe("chat results while a new search runs", () => {
  const listed = ["assistant", "setting"];
  const chats = ["chat 1", "chat 2"];

  it("joins the list once they answer the words typed now", () => {
    expect(arrangePaletteRows(listed, chats, "plan", "plan")).toEqual({
      choosable: ["assistant", "setting", "chat 1", "chat 2"],
      stale: [],
    });
    // Spaces around the words do not make an answer stale.
    expect(arrangePaletteRows(listed, chats, " plan ", "plan")).toEqual({
      choosable: ["assistant", "setting", "chat 1", "chat 2"],
      stale: [],
    });
  });

  it("stay on screen but cannot be chosen while the next search runs", () => {
    const rows = arrangePaletteRows(listed, chats, "plans", "plan");
    // The arrows and Enter only ever reach the live groups.
    expect(rows.choosable).toEqual(["assistant", "setting"]);
    expect(rows.stale).toEqual(["chat 1", "chat 2"]);
  });

  it("go when the box is emptied", () => {
    expect(arrangePaletteRows(listed, chats, "  ", "plan")).toEqual({
      choosable: ["assistant", "setting"],
      stale: [],
    });
  });

  it("an answer with nothing found replaces the old results", () => {
    expect(arrangePaletteRows(listed, [], "plans", "plans")).toEqual({
      choosable: ["assistant", "setting"],
      stale: [],
    });
  });
});
