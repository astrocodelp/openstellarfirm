import { SKILLS } from "./catalog";
import {
  CATEGORIES,
  type CategoryId,
  SKILL_GROUPS,
  type Skill,
} from "./skill-library";

/** What the gallery needs from a persona to show and find it. */
export interface GalleryEntry {
  name: string;
  summary: string;
  category: CategoryId;
  skills: string[];
}

export function isCategory(value: unknown): value is CategoryId {
  return CATEGORIES.some((c) => c.id === value);
}

export function categoryName(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.name ?? "";
}

export function skillGroupName(id: Skill["group"]): string {
  return SKILL_GROUPS.find((g) => g.id === id)?.name ?? "";
}

/** The known skills behind a list of ids, in the order given. */
export function skillsOf(ids: string[]): Skill[] {
  return ids.flatMap((id) => SKILLS.filter((s) => s.id === id));
}

/**
 * Lower case, without accents, with every run of other characters made one
 * space and a space in front, so " word" finds a word that starts there, and
 * "resume" finds "résumé" and back.
 */
function fold(text: string): string {
  return ` ${text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()}`;
}

/** The words of a query, each to be found at the start of a word. */
function terms(query: string): string[] {
  return fold(query)
    .split(" ")
    .filter(Boolean)
    .map((word) => ` ${word}`);
}

/**
 * Personas that match every word of the query, in the category picked.
 * A word is looked for at the start of a word in the name, the summary, the
 * category and the names and descriptions of the persona's skills, so "fact"
 * finds "fact check" and not "manufacture". A match in the name ranks first;
 * otherwise the order given is kept.
 */
export function findPersonas<T extends GalleryEntry>(
  entries: T[],
  query: string,
  category: CategoryId | "all" = "all",
): T[] {
  const words = terms(query);
  const scored = entries.flatMap((entry, index) => {
    if (category !== "all" && entry.category !== category) return [];
    const name = fold(entry.name);
    const rest = fold(
      [
        entry.summary,
        categoryName(entry.category),
        ...skillsOf(entry.skills).flatMap((s) => [s.name, s.description]),
      ].join(" "),
    );
    let score = 0;
    for (const word of words) {
      if (name.startsWith(word)) score += 3;
      else if (name.includes(word)) score += 2;
      else if (rest.includes(word)) score += 1;
      else return [];
    }
    return [{ entry, index, score }];
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.entry);
}

/** Skills that match every word of the query, in catalog order. */
export function findSkills(query: string, list: Skill[] = SKILLS): Skill[] {
  const words = terms(query);
  if (words.length === 0) return list;
  return list.filter((s) => {
    const text = fold(`${s.name} ${s.description} ${skillGroupName(s.group)}`);
    return words.every((word) => text.includes(word));
  });
}
