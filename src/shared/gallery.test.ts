import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAssistantFile } from "./assistant-file";
import { SKILLS } from "./catalog";
import { findPersonas, findSkills, type GalleryEntry } from "./gallery";
import { REPO } from "./links";
import { systemPrompt } from "./prompt";
import {
  LIBRARY_SKILLS,
  MAX_DESCRIPTION,
  MAX_GUIDANCE,
  MAX_SKILLS,
  SKILL_GROUPS,
} from "./skill-library";

const DIR = join(import.meta.dirname, "../../personas");
const personas = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({
    name,
    raw: JSON.parse(readFileSync(join(DIR, name), "utf8")) as Record<
      string,
      unknown
    >,
  }));

/** The size one ready-made assistant's instructions may reach, with no tools. */
const PROMPT_BUDGET = 3_500;
/** The worst case: a full brief and the twenty longest skills. */
const WORST_CASE_BUDGET = 12_000;

/** What persona and skill texts must never mention. */
const FORBIDDEN =
  /stellarfirm|\bcloud\b|\bcredits?\b|posthog|sandbox|approval card|\bproxy\b|\broutines?\b|\bhosting\b/i;
const ALLOWED_LINK = `https://github.com/${REPO}`;

/** Every text a person or a model reads from personas and skills. */
function texts(): { where: string; text: string }[] {
  return [
    ...personas.flatMap(({ name, raw }) =>
      ["name", "group", "summary", "brief"].map((field) => ({
        where: `${name} ${field}`,
        text: String(raw[field]),
      })),
    ),
    ...SKILLS.flatMap((s) =>
      [s.name, s.description, s.guidance].map((text) => ({
        where: s.id,
        text,
      })),
    ),
  ];
}

describe("the skill library", () => {
  it("gives every skill a unique id, a known group and short texts", () => {
    const ids = SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set<string>(SKILL_GROUPS.map((g) => g.id));
    for (const skill of SKILLS) {
      // An imported file cuts a skill id at 40 characters.
      expect(skill.id, skill.id).toMatch(/^[a-z][a-z0-9-]{1,39}$/);
      expect(groups.has(skill.group), skill.id).toBe(true);
      expect(skill.name.length, skill.id).toBeLessThanOrEqual(40);
      expect(skill.description.length, skill.id).toBeGreaterThan(10);
      expect(skill.description.length, skill.id).toBeLessThanOrEqual(
        MAX_DESCRIPTION,
      );
      expect(skill.guidance.length, skill.id).toBeLessThanOrEqual(MAX_GUIDANCE);
      expect(skill.guidance, skill.id).not.toContain("\n");
    }
    for (const group of SKILL_GROUPS) {
      expect(
        SKILLS.some((s) => s.group === group.id),
        group.id,
      ).toBe(true);
    }
  });

  it("keeps the six general skills and their ids", () => {
    expect(SKILLS.slice(0, 6).map((s) => s.id)).toEqual([
      "research",
      "write",
      "summarise",
      "translate",
      "plan",
      "code",
    ]);
    expect(SKILLS.length).toBe(6 + LIBRARY_SKILLS.length);
  });

  it("is used: every library skill belongs to at least one persona", () => {
    const used = new Set(personas.flatMap((p) => p.raw.skills as string[]));
    for (const skill of LIBRARY_SKILLS) {
      expect(used.has(skill.id), skill.id).toBe(true);
    }
  });

  it("only names skills that exist, in every persona", () => {
    const known = new Set(SKILLS.map((s) => s.id));
    for (const { name, raw } of personas) {
      for (const id of raw.skills as string[]) {
        expect(known.has(id), `${name}: ${id}`).toBe(true);
      }
      expect((raw.skills as string[]).length, name).toBeLessThanOrEqual(
        MAX_SKILLS,
      );
    }
  });

  it("claims no tool the app does not have", () => {
    for (const skill of SKILLS) {
      expect(skill.guidance, skill.id).not.toMatch(
        /\b(browse the internet|send (an )?email|run (the )?(code|program|script)|execute commands|licensed|certified|publish it|post it)\b/i,
      );
    }
  });
});

describe("persona and skill texts", () => {
  it("never say bot or robot", () => {
    for (const { where, text } of texts()) {
      expect(text, where).not.toMatch(/\b(ro)?bots?\b/i);
    }
  });

  it("never mention the cloud service, its credits or its internals", () => {
    for (const { where, text } of texts()) {
      expect(text, where).not.toMatch(FORBIDDEN);
    }
  });

  it("carry no web address other than the project's own", () => {
    for (const { where, text } of texts()) {
      for (const url of text.match(/https?:\/\/\S+/gi) ?? []) {
        expect(url.startsWith(ALLOWED_LINK), `${where}: ${url}`).toBe(true);
      }
      expect(text, where).not.toMatch(/\bwww\./i);
    }
  });
});

describe("the size of the instructions", () => {
  const base = { folderLabels: [], web: false };

  it(`keeps each ready-made assistant under ${PROMPT_BUDGET} characters`, () => {
    for (const { name, raw } of personas) {
      // A persona never brings a computer, so the prompt is read without one.
      const { computer: _computer, ...assistant } =
        readAssistantFile(raw).assistant;
      const prompt = systemPrompt({ ...base, ...assistant });
      expect(prompt.length, name).toBeLessThanOrEqual(PROMPT_BUDGET);
      // Every skill it ticks is in it.
      for (const skill of SKILLS.filter((s) =>
        assistant.skills.includes(s.id),
      )) {
        expect(prompt, `${name}: ${skill.id}`).toContain(skill.guidance);
      }
    }
  });

  it(`keeps the worst case under ${WORST_CASE_BUDGET} characters`, () => {
    const longest = [...SKILLS]
      .sort((a, b) => b.guidance.length - a.guidance.length)
      .slice(0, MAX_SKILLS)
      .map((s) => s.id);
    const prompt = systemPrompt({
      ...base,
      name: "x".repeat(60),
      brief: "y".repeat(4000),
      skills: longest,
    });
    expect(prompt.length).toBeLessThanOrEqual(WORST_CASE_BUDGET);
  });
});

describe("finding a persona", () => {
  const entries: GalleryEntry[] = [
    {
      name: "Sales",
      summary: "Prepares calls.",
      category: "business",
      skills: ["call-prep"],
    },
    {
      name: "Accountant",
      summary: "Money records.",
      category: "money-law",
      skills: ["read-invoice"],
    },
    {
      name: "Support",
      summary: "Answers customers, and helps sales.",
      category: "business",
      skills: ["customer-reply"],
    },
  ];
  const names = (list: GalleryEntry[]) => list.map((e) => e.name);

  it("shows everything, in order, with no query", () => {
    expect(names(findPersonas(entries, "  "))).toEqual([
      "Sales",
      "Accountant",
      "Support",
    ]);
  });

  it("finds by name first, then by role and summary", () => {
    expect(names(findPersonas(entries, "sales"))).toEqual(["Sales", "Support"]);
  });

  it("finds by a skill's name and by the category's name", () => {
    expect(names(findPersonas(entries, "invoice"))).toEqual(["Accountant"]);
    expect(names(findPersonas(entries, "law"))).toEqual(["Accountant"]);
  });

  it("matches the start of a word, not the middle of one", () => {
    expect(names(findPersonas(entries, "rec"))).toEqual(["Accountant"]);
    expect(names(findPersonas(entries, "ecords"))).toEqual([]);
  });

  it("needs every word, ignores case and accents, and keeps to a category", () => {
    expect(names(findPersonas(entries, "CUSTOMÉR reply"))).toEqual(["Support"]);
    expect(names(findPersonas(entries, "customer nothing"))).toEqual([]);
    expect(names(findPersonas(entries, "", "money-law"))).toEqual([
      "Accountant",
    ]);
    expect(names(findPersonas(entries, "sales", "money-law"))).toEqual([]);
  });
});

describe("finding a skill", () => {
  it("returns every skill for an empty query, and matches every word", () => {
    expect(findSkills("")).toHaveLength(SKILLS.length);
    expect(findSkills("contract").map((s) => s.id)).toContain(
      "contract-checklist",
    );
    expect(findSkills("money law").every((s) => s.group === "money-law")).toBe(
      true,
    );
    expect(findSkills("no such skill here")).toEqual([]);
  });
});
