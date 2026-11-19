import { describe, expect, it } from "vitest";
import { plain } from "../main/mcp";
import {
  cardText,
  dropHidden,
  fitsCard,
  MAX_CARD_CHARS,
  showHidden,
} from "./visible-text";

describe("text on an approval card", () => {
  it("writes out every character that draws nothing or turns text around", () => {
    // A right-to-left override can make a program read as a harmless file.
    expect(showHidden("cat a‮txt.exe")).toBe("cat a[U+202E]txt.exe");
    expect(showHidden("pass​word‍﻿")).toBe("pass[U+200B]word[U+200D][U+FEFF]");
    expect(showHidden("a⁦b⁩c؜d")).toBe("a[U+2066]b[U+2069]c[U+061C]d");
    // Tag characters can spell a whole hidden sentence.
    expect(showHidden("ok\u{E0041}\u{E0042}")).toBe("ok[U+E0041][U+E0042]");
    expect(showHidden("x y­z͏️")).toBe("x[U+2028]y[U+00AD]z[U+034F][U+FE0F]");
    expect(showHidden("bell\u0007 escape\u001B")).toBe(
      "bell[U+0007] escape[U+001B]",
    );
    // New lines and tabs are how a command or a body is laid out.
    expect(showHidden("one\n\ttwo")).toBe("one\n\ttwo");
    expect(showHidden("café, 東京, emoji 😀")).toBe("café, 東京, emoji 😀");
  });

  it("takes them out of names and descriptions", () => {
    expect(dropHidden("No​tes‮")).toBe("Notes");
    expect(plain("Send​ mail‮quietly", 100)).toBe("Send mailquietly");
  });

  it("is applied to every part of a card", () => {
    const card = cardText({
      title: "Use x on Te‮am",
      detail: "a​b",
      why: "c⁦",
      site: "ex‍ample.com",
      remember: { connectionId: "n", tool: "x" },
    });
    expect(card.title).toBe("Use x on Te[U+202E]am");
    expect(card.detail).toBe("a[U+200B]b");
    expect(card.why).toBe("c[U+2066]");
    expect(card.site).toBe("ex[U+200D]ample.com");
    expect(card.remember).toEqual({ connectionId: "n", tool: "x" });
    expect(cardText({ title: "t", detail: "d", why: "w" })).not.toHaveProperty(
      "site",
    );
  });

  it("measures what fits with the hidden characters written out", () => {
    expect(fitsCard("a".repeat(MAX_CARD_CHARS))).toBe(true);
    expect(fitsCard("a".repeat(MAX_CARD_CHARS + 1))).toBe(false);
    // Short, but each character grows eightfold on the card.
    expect(fitsCard("​".repeat(MAX_CARD_CHARS / 4))).toBe(false);
  });
});
