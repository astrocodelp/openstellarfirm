import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAS } from "../renderer/src/personas";
import { MAX_SUMMARY, readAssistantFile } from "./assistant-file";
import { SKILLS } from "./catalog";
import { PET_COLORS, PET_IDS } from "./types";

const DIR = join(import.meta.dirname, "../../personas");
const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
const loaded = files.map((name) => ({
  name,
  raw: JSON.parse(readFileSync(join(DIR, name), "utf8")) as Record<
    string,
    unknown
  >,
}));

describe("personas folder", () => {
  it("holds the starter personas", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const title of [
      "Coder",
      "Legal",
      "Writer",
      "Researcher",
      "Planner",
      "Tutor",
      "Accountant",
      "Marketing",
    ]) {
      expect(
        loaded.some((f) => f.raw.name === title),
        title,
      ).toBe(true);
    }
  });

  it("passes the same checks as an import, field by field", () => {
    const names = new Set<string>();
    for (const { name, raw } of loaded) {
      const { assistant, summary } = readAssistantFile(raw);
      // Nothing the check cleaned away: the file is already exactly valid.
      expect(assistant.name, name).toBe(raw.name);
      expect(assistant.brief, name).toBe(raw.brief);
      expect(assistant.group, name).toBe(raw.group);
      expect(assistant.skills, name).toEqual(raw.skills);
      expect(PET_IDS, name).toContain(assistant.pet);
      expect(PET_COLORS, name).toContain(assistant.color);
      expect(summary, name).toBe(raw.summary);
      expect(String(raw.summary).length, name).toBeLessThanOrEqual(MAX_SUMMARY);
      expect(String(raw.name).length, name).toBeLessThanOrEqual(60);
      expect(String(raw.brief).length, name).toBeLessThanOrEqual(4000);
      const lines = String(raw.brief).split("\n").filter(Boolean);
      expect(lines.length, name).toBeGreaterThanOrEqual(4);
      expect(lines.length, name).toBeLessThanOrEqual(10);
      expect(names.has(assistant.name.toLowerCase()), name).toBe(false);
      names.add(assistant.name.toLowerCase());
      const known = SKILLS.map((s) => s.id);
      for (const skill of assistant.skills)
        expect(known, name).toContain(skill);
      // A persona never carries access or a model.
      expect(Object.keys(raw).sort(), name).toEqual(
        [
          "brief",
          "color",
          "format",
          "group",
          "name",
          "pet",
          "skills",
          "summary",
          "version",
        ].sort(),
      );
    }
  });

  it("never says bot or robot", () => {
    for (const { name } of loaded) {
      expect(readFileSync(join(DIR, name), "utf8"), name).not.toMatch(
        /\b(ro)?bots?\b/i,
      );
    }
  });

  it("gives Legal and Accountant their safety lines", () => {
    const brief = (title: string) =>
      String(loaded.find((f) => f.raw.name === title)?.raw.brief);
    const legal = brief("Legal");
    expect(legal).toMatch(/general information/i);
    expect(legal).toMatch(/not a lawyer/i);
    expect(legal).toMatch(/legal advice/i);
    expect(legal).toMatch(/qualified lawyer/i);
    expect(legal).toMatch(/which country/i);
    const accountant = brief("Accountant");
    expect(accountant).toMatch(/general information/i);
    expect(accountant).toMatch(/not tax advice/i);
    expect(accountant).toMatch(/qualified accountant/i);
    expect(accountant).toMatch(/which country/i);
  });

  it("claims no tool the app does not have", () => {
    for (const { name, raw } of loaded) {
      expect(String(raw.brief), name).not.toMatch(
        /\b(browse the internet|send (an )?email|run (the )?code for you|execute commands|licensed|certified)\b/i,
      );
    }
  });

  it("is bundled into the app, in full", () => {
    expect(PERSONAS.map((p) => p.assistant.name).sort()).toEqual(
      loaded.map((f) => String(f.raw.name)).sort(),
    );
    for (const p of PERSONAS) expect(p.summary.length).toBeGreaterThan(0);
  });
});
