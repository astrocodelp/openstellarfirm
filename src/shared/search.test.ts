import { describe, expect, it } from "vitest";
import {
  matchRank,
  normalise,
  SEARCH_LIMIT_MAX,
  searchChats,
  searchTerms,
  snippet,
} from "./search";
import type { ChatMessage, SearchPart } from "./types";

function msg(
  id: string,
  text: string,
  at: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id, role: "assistant", text, at, ...extra };
}

/** The marked words of a snippet, in order. */
function marked(parts: SearchPart[]): string[] {
  return parts.filter((p) => p.match).map((p) => p.text);
}

function whole(parts: SearchPart[]): string {
  return parts.map((p) => p.text).join("");
}

describe("normalise", () => {
  it("folds case and accents", () => {
    expect(normalise("Café CRÈME")).toBe("cafe creme");
    expect(normalise("Ελληνικά")).toBe("ελληνικα");
    expect(normalise("Straße")).toBe("strasse");
    expect(normalise("ΟΔΟΣ")).toBe(normalise("οδοσ"));
    expect(normalise("İstanbul")).toBe("istanbul");
  });

  it("splits a search into folded words without repeats", () => {
    expect(searchTerms("  Café  cafe   NOTES.md ")).toEqual([
      "cafe",
      "notes.md",
    ]);
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
  });
});

describe("ranking", () => {
  it("puts whole words above parts of words", () => {
    expect(matchRank("the cat sat", ["cat"])?.rank).toBe(0);
    expect(matchRank("concatenate this", ["cat"])?.rank).toBe(2);
    expect(matchRank("a dog", ["cat"])).toBeNull();
  });

  it("puts words that stand together above words that are apart", () => {
    expect(matchRank("book the flight today", ["the", "flight"])?.rank).toBe(0);
    expect(matchRank("the late flight", ["the", "flight"])?.rank).toBe(1);
    expect(matchRank("the late flights", ["the", "flight"])?.rank).toBe(2);
  });

  it("needs every word", () => {
    expect(matchRank("tax return", ["tax", "invoice"])).toBeNull();
  });

  it("treats punctuation next to a word as a boundary", () => {
    expect(matchRank("Read (notes.md), please", ["notes.md"])?.rank).toBe(0);
    expect(matchRank("Is it «Café»?", ["cafe"])?.rank).toBe(0);
  });
});

describe("searchChats", () => {
  const chats = [
    {
      assistantId: "a",
      messages: [
        msg("1", "The invoice is due Friday.", "2026-11-01T10:00:00Z"),
        msg("2", "Reinvoiced the client.", "2026-11-18T10:00:00Z"),
        msg("3", "Send the invoice again.", "2026-11-10T10:00:00Z", {
          role: "user",
        }),
      ],
    },
    {
      assistantId: "b",
      messages: [
        msg("4", "An INVOICE from the café.", "2026-11-05T10:00:00Z"),
        msg("5", "Check: invoice", "2026-11-19T10:00:00Z", {
          check: "request",
        }),
      ],
    },
  ];

  it("ranks whole words first, newest first within a rank", () => {
    const hits = searchChats(chats, "Invoice");
    expect(hits.map((h) => h.messageId)).toEqual(["3", "4", "1", "2"]);
    expect(hits[0]).toMatchObject({ assistantId: "a", role: "user" });
  });

  it("is accent and case insensitive in the text too", () => {
    expect(searchChats(chats, "CAFE").map((h) => h.messageId)).toEqual(["4"]);
  });

  it("leaves out the app's own request to start a check", () => {
    expect(searchChats(chats, "check").map((h) => h.messageId)).toEqual([]);
  });

  it("finds nothing for an empty search", () => {
    expect(searchChats(chats, "   ")).toEqual([]);
  });

  it("keeps to the limit", () => {
    const many = [
      {
        assistantId: "a",
        messages: Array.from({ length: 120 }, (_, i) =>
          msg(String(i), `note ${i}`, new Date(2026, 0, 1, 0, i).toISOString()),
        ),
      },
    ];
    expect(searchChats(many, "note", 5)).toHaveLength(5);
    expect(searchChats(many, "note", 500)).toHaveLength(SEARCH_LIMIT_MAX);
    // Newest first, since every one ranks the same.
    expect(searchChats(many, "note", 1)[0]?.messageId).toBe("119");
  });
});

describe("snippet", () => {
  it("marks the words found, in the person's own spelling", () => {
    const parts = snippet("We met at the Café Noir on Tuesday.", ["cafe"]);
    expect(marked(parts)).toEqual(["Café"]);
    expect(whole(parts)).toBe("We met at the Café Noir on Tuesday.");
  });

  it("marks every word, and merges marks that touch", () => {
    const parts = snippet("Tax return, tax due", ["tax", "return"]);
    expect(marked(parts)).toEqual(["Tax", "return", "tax"]);
  });

  it("cuts a long message around the match, at spaces", () => {
    const before = "word ".repeat(40);
    const after = " more".repeat(60);
    const parts = snippet(`${before}needle${after}`, ["needle"]);
    const text = whole(parts);
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(200);
    expect(text).toMatch(/^…word word/);
    expect(marked(parts)).toEqual(["needle"]);
  });

  it("folds line breaks to spaces and never returns markup", () => {
    const parts = snippet("first line\n\n<b>second</b> line", ["second"]);
    expect(whole(parts)).toBe("first line <b>second</b> line");
    expect(marked(parts)).toEqual(["second"]);
  });

  it("keeps letters that fold to two whole", () => {
    expect(marked(snippet("Die Straße ist lang", ["strasse"]))).toEqual([
      "Straße",
    ]);
  });
});
