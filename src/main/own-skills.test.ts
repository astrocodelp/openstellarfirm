import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkOwnSkillInput,
  isOwnSkillId,
  MAX_OWN_SKILLS,
  newOwnSkillId,
  readOwnSkills,
} from "../shared/own-skills";
import { systemPrompt } from "../shared/prompt";
import { buildBackup, restoreBackup } from "./backup";
import { Store } from "./store";

let dirs: string[] = [];
function fresh(): Store {
  const dir = mkdtempSync(join(tmpdir(), "openstellarfirm-"));
  dirs.push(dir);
  return new Store(dir);
}
beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const skill = {
  name: "File weekly expenses",
  description: "Fill the expense sheet from receipts, then file it.",
  lines: ["Open this week's sheet.", "Add one row per receipt."],
};

const assistant = {
  name: "Books",
  group: "Work",
  pet: "glim",
  color: "sky",
  brief: "Keep my books.",
} as const;

describe("checking an own skill before it is saved", () => {
  it("keeps a good one and cleans its lines", () => {
    expect(
      checkOwnSkillInput({
        ...skill,
        lines: ["- One.", "", "2. Two.", "One."],
      }),
    ).toEqual({ ...skill, lines: ["One.", "Two."] });
  });

  it.each([
    [{ ...skill, name: "" }, /name/],
    [{ ...skill, name: "x".repeat(61) }, /60/],
    [{ ...skill, description: " " }, /one line/],
    [{ ...skill, description: "x".repeat(91) }, /90/],
    [{ ...skill, lines: [] }, /at least one/],
    [{ ...skill, lines: "a line" }, /at least one/],
    [{ ...skill, lines: Array.from({ length: 9 }, (_, i) => `L${i}`) }, /8/],
    [{ ...skill, lines: ["x".repeat(201)] }, /200/],
    [
      {
        ...skill,
        lines: Array.from({ length: 7 }, () => "y".repeat(190)).map(
          (l, i) => `${i}${l}`,
        ),
      },
      /1,200/,
    ],
  ])("refuses a bad one with a plain sentence", (input, why) => {
    expect(() => checkOwnSkillInput(input)).toThrow(why);
  });

  it("makes ids that never clash with the library's and fit an assistant's list", () => {
    const id = newOwnSkillId("Filé the Weekly Expenses, now!", "AB12-cd34");
    expect(id).toBe("own-ab12cd34-file-the-weekly-expenses");
    expect(isOwnSkillId(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(40);
    expect(isOwnSkillId("research")).toBe(false);
    expect(isOwnSkillId(newOwnSkillId("!!!", "abcdef12"))).toBe(true);
  });
});

describe("own skills in the store", () => {
  it("saves one, lists it and edits it in place", () => {
    const store = fresh();
    const saved = store.saveOwnSkill(skill);
    expect(isOwnSkillId(saved.id)).toBe(true);
    expect(saved.source).toBe("recording");
    expect(store.ownSkills()).toEqual([saved]);
    const edited = store.saveOwnSkill({
      ...skill,
      id: saved.id,
      name: "File expenses",
    });
    expect(edited.id).toBe(saved.id);
    expect(edited.updatedAt).toBeDefined();
    expect(store.ownSkills()).toHaveLength(1);
    expect(store.settings().ownSkills?.[0]?.name).toBe("File expenses");
  });

  it("will not edit one that is not there", () => {
    const store = fresh();
    expect(() => store.saveOwnSkill({ ...skill, id: "own-gone1234" })).toThrow(
      /no longer here/,
    );
  });

  it("keeps up to the limit", () => {
    const store = fresh();
    for (let i = 0; i < MAX_OWN_SKILLS; i += 1)
      store.saveOwnSkill({ ...skill, name: `Skill ${i}` });
    expect(() => store.saveOwnSkill(skill)).toThrow(/up to 50/);
  });

  it("deletes one and takes it off every assistant that had it ticked", () => {
    const store = fresh();
    const saved = store.saveOwnSkill(skill);
    const a = store.saveAssistant({
      ...assistant,
      skills: ["research", saved.id],
    });
    store.removeOwnSkill(saved.id);
    expect(store.ownSkills()).toEqual([]);
    expect(store.assistant(a.id).skills).toEqual(["research"]);
    expect(() => store.removeOwnSkill(saved.id)).toThrow();
  });

  it("can never be set through the page's settings", () => {
    const store = fresh();
    store.setSettings({
      theme: "dark",
      ownSkills: [
        { ...skill, id: "own-sneaky12", source: "typed", createdAt: "" },
      ],
    } as never);
    expect(store.ownSkills()).toEqual([]);
  });

  it("drops a bad one from a settings file edited by hand", () => {
    const store = fresh();
    const good = store.saveOwnSkill(skill);
    const file = join(store.folder, "state.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.settings.ownSkills.push(
      { id: "not-own", ...skill },
      { id: "own-badlines1", name: "x", description: "y", lines: [42] },
    );
    writeFileSync(file, JSON.stringify(state));
    expect(store.ownSkills().map((s) => s.id)).toEqual([good.id]);
  });

  it("reads nothing from a value that is not a list", () => {
    expect(readOwnSkills("nope")).toEqual([]);
    expect(readOwnSkills(undefined)).toEqual([]);
  });
});

describe("own skills in an assistant's instructions", () => {
  it("adds the lines of the ticked ones only, and says they give no access", () => {
    const store = fresh();
    const ticked = store.saveOwnSkill(skill);
    const other = store.saveOwnSkill({
      ...skill,
      name: "Other",
      lines: ["Never seen."],
    });
    const prompt = systemPrompt({
      ...assistant,
      skills: [ticked.id],
      folderLabels: [],
      web: false,
      ownSkills: [ticked, other],
    });
    expect(prompt).toContain("- Open this week's sheet.");
    expect(prompt).toContain("- Add one row per receipt.");
    expect(prompt).not.toContain("Never seen.");
    expect(prompt).toMatch(/never give you access/);
  });

  it("says nothing about own skills when none is ticked", () => {
    const prompt = systemPrompt({
      ...assistant,
      skills: [],
      folderLabels: [],
      web: false,
      ownSkills: [],
    });
    expect(prompt).not.toMatch(/recording/);
  });
});

describe("own skills in a backup", () => {
  it("travel as text, and come back with the assistants that tick them", () => {
    const from = fresh();
    const saved = from.saveOwnSkill(skill);
    from.saveAssistant({ ...assistant, skills: [saved.id, "plan"] });
    const file = buildBackup(from, false);
    expect(file.ownSkills?.[0]).toMatchObject({
      id: saved.id,
      name: skill.name,
      lines: skill.lines,
    });

    const to = fresh();
    const result = restoreBackup(to, JSON.stringify(file));
    expect(result.ownSkills).toBe(1);
    expect(to.ownSkills()[0]?.lines).toEqual(skill.lines);
    expect(to.assistants()[0]?.skills).toEqual([saved.id, "plan"]);
  });

  it("keeps one already here and does not add it twice", () => {
    const store = fresh();
    store.saveOwnSkill(skill);
    const file = buildBackup(store, false);
    const again = restoreBackup(store, JSON.stringify(file));
    expect(again.ownSkills).toBeUndefined();
    expect(store.ownSkills()).toHaveLength(1);
  });

  it("drops a bad own skill in a backup and keeps the rest", () => {
    const store = fresh();
    const result = restoreBackup(
      store,
      JSON.stringify({
        format: "stellarfirm-open.backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        assistants: [],
        ownSkills: [
          { id: "own-good1234", ...skill, createdAt: "2026-11-19T00:00:00Z" },
          { id: "own-bad12345", name: "", description: "x", lines: ["y"] },
          "not a skill",
        ],
      }),
    );
    expect(result.ownSkills).toBe(1);
    expect(store.ownSkills().map((s) => s.id)).toEqual(["own-good1234"]);
  });

  it("is left out of a backup when there are none", () => {
    expect(buildBackup(fresh(), false).ownSkills).toBeUndefined();
  });
});
