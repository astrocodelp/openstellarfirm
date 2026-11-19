import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAS } from "../renderer/src/personas";
import { MAX_SUMMARY, readAssistantFile } from "./assistant-file";
import { SKILLS } from "./catalog";
import { isCategory } from "./gallery";
import { CATEGORIES } from "./skill-library";
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
    expect(files.length).toBeGreaterThanOrEqual(21);
    for (const title of [
      "Coder",
      "Legal",
      "Writer",
      "Researcher",
      "Planner",
      "Tutor",
      "Accountant",
      "Marketing",
      "Product owner",
      "Sales",
      "Executive assistant",
      "Support",
      "Recruiting",
      "Online shop",
      "DJ",
      "Copywriter",
      "Scientist",
      "Architect",
      "Mechanical engineer",
      "Designer",
      "Journalist",
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
          "category",
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

  it("files every persona under a known category, and fills every category", () => {
    for (const { name, raw } of loaded) {
      expect(isCategory(raw.category), name).toBe(true);
    }
    for (const category of CATEGORIES) {
      expect(
        loaded.some((f) => f.raw.category === category.id),
        category.id,
      ).toBe(true);
    }
  });

  it("gives every persona a few of its own skills, each one once", () => {
    for (const { name, raw } of loaded) {
      const skills = raw.skills as string[];
      expect(skills.length, name).toBeGreaterThanOrEqual(2);
      expect(skills.length, name).toBeLessThanOrEqual(12);
      expect(new Set(skills).size, name).toBe(skills.length);
    }
  });

  it("never brings screen access, whatever a persona file claims", () => {
    for (const { name, raw } of loaded) {
      expect(raw.screen, name).toBeUndefined();
      const { assistant } = readAssistantFile({ ...raw, screen: true });
      expect("screen" in assistant, name).toBe(false);
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

  it("gives the fields with legal, money or safety stakes their safety lines", () => {
    const brief = (title: string) =>
      String(loaded.find((f) => f.raw.name === title)?.raw.brief);
    for (const title of ["Recruiting", "Online shop", "Architect"]) {
      expect(brief(title), title).toMatch(/which country/i);
      expect(brief(title), title).toMatch(/qualified/i);
    }
    expect(brief("Architect")).toMatch(/not an architect/i);
    expect(brief("Mechanical engineer")).toMatch(/not a qualified engineer/i);
    expect(brief("Recruiting")).toMatch(/never weigh age/i);
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
    for (const p of PERSONAS) {
      expect(p.summary.length).toBeGreaterThan(0);
      const raw = loaded.find((f) => f.raw.name === p.assistant.name)?.raw;
      expect(p.category, p.assistant.name).toBe(raw?.category);
      expect(`${p.id}.json`).toBe(
        loaded.find((f) => f.raw.name === p.assistant.name)?.name,
      );
    }
  });
});
