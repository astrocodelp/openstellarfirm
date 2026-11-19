import { describe, expect, it } from "vitest";
import {
  DEFAULT_PET_KIND,
  defaultPetSettings,
  isPetKind,
  PET_KIND_DEFAULTS,
  PET_KINDS,
  PET_VOICE_IDS,
} from "./kinds";
import { parsePetSettings } from "./protocol";

describe("pet kinds", () => {
  it("lists the three figures, the astronaut first and by default", () => {
    expect([...PET_KINDS]).toEqual(["astronaut", "alien", "cat"]);
    expect(DEFAULT_PET_KIND).toBe("astronaut");
  });

  it("gives each figure its name and voice", () => {
    expect(PET_KIND_DEFAULTS).toEqual({
      astronaut: { name: "Nova", voice: "talia" },
      alien: { name: "Zib", voice: "darian" },
      cat: { name: "Comet", voice: "maisie" },
    });
  });

  it("has six voices, and a default voice from them for each figure", () => {
    expect([...PET_VOICE_IDS]).toEqual([
      "talia",
      "alicia",
      "maisie",
      "darian",
      "eldrin",
      "wyatt",
    ]);
    for (const kind of PET_KINDS) {
      expect(PET_VOICE_IDS).toContain(PET_KIND_DEFAULTS[kind].voice);
    }
  });

  it("recognises a kind", () => {
    expect(isPetKind("cat")).toBe(true);
    expect(isPetKind("dog")).toBe(false);
    expect(isPetKind(undefined)).toBe(false);
    expect(isPetKind("constructor")).toBe(false);
  });

  it("starts a pet awake, loud enough, with the kind's voice", () => {
    for (const kind of PET_KINDS) {
      const settings = defaultPetSettings(kind);
      expect(settings).toEqual({
        paused: false,
        quietHours: null,
        speakNotices: true,
        volume: 0.6,
        voice: PET_KIND_DEFAULTS[kind].voice,
        savedNotes: "send",
      });
      expect(parsePetSettings(settings).ok).toBe(true);
    }
  });

  it("gives each pet its own settings object", () => {
    expect(defaultPetSettings("cat")).not.toBe(defaultPetSettings("cat"));
  });
});
