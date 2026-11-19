import { MAX_DESCRIPTION, type Skill } from "./skill-library";

/**
 * The person's own skills: written by them, or drafted from a recording of
 * their work and then read, edited and saved by them. Like every skill, one is
 * guidance, never access: it changes what an assistant is told, not what it
 * may do. Only the person's Save keeps one.
 *
 * Pure, so the main process, the page and the tests share one set of rules.
 */

export interface OwnSkill {
  /** "own-" and a short random part, so it never clashes with a library id. */
  id: string;
  name: string;
  /** One line for the picker. */
  description: string;
  /** Short lines of guidance, each one sentence or two. */
  lines: string[];
  /** Where it came from: a recording, or typed by the person. */
  source: "recording" | "typed";
  createdAt: string;
  updatedAt?: string;
}

/** What the page sends to save one: no id makes a new one. */
export interface OwnSkillInput {
  id?: string;
  name: string;
  description: string;
  lines: string[];
  source?: OwnSkill["source"];
}

/** A draft from a recording, before the person saves it. */
export type OwnSkillDraft = Pick<OwnSkill, "name" | "description" | "lines">;

export const MAX_OWN_SKILLS = 50;
export const MAX_OWN_NAME = 60;
export const MAX_OWN_DESCRIPTION = MAX_DESCRIPTION;
export const MAX_OWN_LINES = 8;
export const MAX_OWN_LINE = 200;
/** All the lines together, so an assistant's instructions stay small. */
export const MAX_OWN_TOTAL = 1200;

const OWN_ID = /^own-[a-z0-9-]{4,36}$/;

export function isOwnSkillId(id: unknown): id is string {
  return typeof id === "string" && OWN_ID.test(id);
}

/** One line of text: control characters out, spaces made single. */
export function oneLine(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A guidance line, without a leading bullet or number. */
export function cleanLine(value: string): string {
  return oneLine(value).replace(/^(?:[-*•]|\d+[.)])\s+/u, "");
}

/** A new id: a short random part, then a few letters of the name. */
export function newOwnSkillId(name: string, random: string): string {
  const slug = oneLine(name)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  const part = random
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return slug ? `own-${part}-${slug}` : `own-${part}`;
}

/**
 * Checks what the person is saving. Every limit is said in a sentence, so the
 * screen can show it; nothing is cut without them knowing.
 */
export function checkOwnSkillInput(input: unknown): OwnSkillDraft {
  const raw = (input ?? {}) as Record<string, unknown>;
  const name = typeof raw.name === "string" ? oneLine(raw.name) : "";
  const description =
    typeof raw.description === "string" ? oneLine(raw.description) : "";
  if (!name) throw new Error("Give the skill a name.");
  if (name.length > MAX_OWN_NAME)
    throw new Error(`Keep the name to ${MAX_OWN_NAME} characters.`);
  if (!description) throw new Error("Say in one line what the skill is for.");
  if (description.length > MAX_OWN_DESCRIPTION)
    throw new Error(
      `Keep the one-line description to ${MAX_OWN_DESCRIPTION} characters.`,
    );
  if (!Array.isArray(raw.lines)) throw new Error("Add at least one line.");
  const lines = [
    ...new Set(
      raw.lines
        .filter((line): line is string => typeof line === "string")
        .map(cleanLine)
        .filter(Boolean),
    ),
  ];
  if (lines.length === 0) throw new Error("Add at least one line.");
  if (lines.length > MAX_OWN_LINES)
    throw new Error(`Keep it to ${MAX_OWN_LINES} lines.`);
  if (lines.some((line) => line.length > MAX_OWN_LINE))
    throw new Error(`Keep each line to ${MAX_OWN_LINE} characters.`);
  if (lines.join(" ").length > MAX_OWN_TOTAL)
    throw new Error(
      `Keep all the lines together to ${MAX_OWN_TOTAL.toLocaleString("en-US")} characters.`,
    );
  return { name, description, lines };
}

/**
 * Reads own skills from a settings file or a backup that may be old or edited
 * by hand: a bad entry is dropped, never fatal, and the list is capped.
 */
export function readOwnSkills(raw: unknown): OwnSkill[] {
  if (!Array.isArray(raw)) return [];
  const out: OwnSkill[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_OWN_SKILLS) break;
    const item = (entry ?? {}) as Record<string, unknown>;
    if (!isOwnSkillId(item.id) || out.some((s) => s.id === item.id)) continue;
    let checked: OwnSkillDraft;
    try {
      checked = checkOwnSkillInput(item);
    } catch {
      continue;
    }
    const createdAt = timeOf(item.createdAt) ?? new Date(0).toISOString();
    const updatedAt = timeOf(item.updatedAt);
    out.push({
      id: item.id,
      ...checked,
      source: item.source === "typed" ? "typed" : "recording",
      createdAt,
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  return out;
}

function timeOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}

/** An own skill in the shape the picker and the search read. */
export function ownAsSkill(own: OwnSkill): Skill {
  return {
    id: own.id,
    name: own.name,
    description: own.description,
    group: "general",
    guidance: own.lines.join(" "),
  };
}
