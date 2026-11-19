import { describe, expect, it } from "vitest";
import {
  accessibilityPatch,
  cleanAccessibility,
  DEFAULT_ACCESSIBILITY,
  htmlAttributes,
  shortcuts,
} from "./accessibility";

const calm = { reducedMotion: false, moreContrast: false };

describe("reading the accessibility choices", () => {
  it("starts at the defaults, following the computer", () => {
    expect(cleanAccessibility(undefined)).toEqual(DEFAULT_ACCESSIBILITY);
    expect(DEFAULT_ACCESSIBILITY).toMatchObject({
      contrast: "system",
      motion: "system",
      readRate: 1,
    });
  });

  it("keeps known values from a file", () => {
    expect(
      cleanAccessibility({
        contrast: "more",
        motion: "reduce",
        underlineLinks: true,
        strongFocus: true,
        readingSpace: true,
        largeTargets: true,
        readRate: 1.5,
      }),
    ).toEqual({
      contrast: "more",
      motion: "reduce",
      underlineLinks: true,
      strongFocus: true,
      readingSpace: true,
      largeTargets: true,
      readRate: 1.5,
    });
  });

  it("reads an old or hand-edited file as the defaults, value by value", () => {
    expect(
      cleanAccessibility({
        contrast: "max",
        motion: 3,
        underlineLinks: "yes",
        readRate: 9,
        extra: "dropped",
      }),
    ).toEqual(DEFAULT_ACCESSIBILITY);
    expect(cleanAccessibility(null)).toEqual(DEFAULT_ACCESSIBILITY);
    expect(cleanAccessibility([1, 2])).toEqual(DEFAULT_ACCESSIBILITY);
    expect(cleanAccessibility("more")).toEqual(DEFAULT_ACCESSIBILITY);
  });
});

describe("a change the page asks for", () => {
  it("passes known keys with valid values", () => {
    expect(
      accessibilityPatch({ contrast: "standard", strongFocus: true }),
    ).toEqual({ contrast: "standard", strongFocus: true });
    expect(accessibilityPatch({ readRate: 0.8 })).toEqual({ readRate: 0.8 });
    expect(accessibilityPatch({})).toEqual({});
  });

  it("refuses an unknown key or value instead of dropping it", () => {
    expect(() => accessibilityPatch({ contrast: "max" })).toThrow();
    expect(() => accessibilityPatch({ motion: "none" })).toThrow();
    expect(() => accessibilityPatch({ readRate: 3 })).toThrow();
    expect(() => accessibilityPatch({ readRate: "1" })).toThrow();
    expect(() => accessibilityPatch({ largeTargets: "on" })).toThrow();
    expect(() => accessibilityPatch({ zoom: 2 })).toThrow();
    expect(() => accessibilityPatch(null)).toThrow();
    expect(() => accessibilityPatch([])).toThrow();
  });
});

describe("the attributes on <html>", () => {
  it("are plain and standard by default on a computer that asks for nothing", () => {
    expect(htmlAttributes(DEFAULT_ACCESSIBILITY, calm)).toEqual({
      contrast: "standard",
      motion: "full",
      links: undefined,
      focus: undefined,
      reading: undefined,
      targets: undefined,
    });
  });

  it("follow the computer when the choice is to follow it", () => {
    const attrs = htmlAttributes(DEFAULT_ACCESSIBILITY, {
      reducedMotion: true,
      moreContrast: true,
    });
    expect(attrs.motion).toBe("reduce");
    expect(attrs.contrast).toBe("more");
  });

  it("let the person's choice win over the computer, both ways", () => {
    const asks = { reducedMotion: true, moreContrast: true };
    const prefs = {
      ...DEFAULT_ACCESSIBILITY,
      motion: "full" as const,
      contrast: "standard" as const,
    };
    expect(htmlAttributes(prefs, asks)).toMatchObject({
      motion: "full",
      contrast: "standard",
    });
    expect(
      htmlAttributes(
        { ...DEFAULT_ACCESSIBILITY, motion: "reduce", contrast: "more" },
        calm,
      ),
    ).toMatchObject({ motion: "reduce", contrast: "more" });
  });

  it("turn each switch into its own attribute", () => {
    expect(
      htmlAttributes(
        {
          ...DEFAULT_ACCESSIBILITY,
          underlineLinks: true,
          strongFocus: true,
          readingSpace: true,
          largeTargets: true,
        },
        calm,
      ),
    ).toMatchObject({
      links: "underline",
      focus: "strong",
      reading: "spaced",
      targets: "large",
    });
  });
});

describe("the shortcuts list", () => {
  const keys = (mac: boolean, send: "enter" | "mod-enter") =>
    shortcuts(mac, send).flatMap((group) =>
      group.items.map((item) => `${item.keys.join("+")}: ${item.does}`),
    );

  it("says Cmd on a Mac and Ctrl elsewhere", () => {
    expect(keys(true, "enter")).toContain("Cmd+/: Show these shortcuts");
    expect(keys(false, "enter")).toContain("Ctrl+/: Show these shortcuts");
  });

  it("follows the choice of what sends a message", () => {
    expect(keys(false, "enter")).toContain("Enter: Send the message");
    expect(keys(false, "mod-enter")).toContain("Ctrl+Enter: Send the message");
    expect(keys(false, "mod-enter")).toContain("Enter: Start a new line");
  });
});
