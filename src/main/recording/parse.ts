import {
  cleanLine,
  MAX_OWN_DESCRIPTION,
  MAX_OWN_LINE,
  MAX_OWN_LINES,
  MAX_OWN_NAME,
  MAX_OWN_TOTAL,
  type OwnSkillDraft,
  oneLine,
} from "../../shared/own-skills";

/**
 * Reads the model's draft of a skill. It is the model's text, written from
 * pictures of the screen, so it is outside text: read strictly, cut to the
 * limits, and only ever shown to the person, who edits it and decides whether
 * to save it. Nothing here runs it or treats it as an instruction.
 */

export class DraftError extends Error {}

/** The words the product never uses for an assistant, put together at run time. */
const NOT_OUR_WORDS = new RegExp(
  ["\\b(chat)?(ro)?b", "ots?\\b"].join(""),
  "gi",
);

/** Says "assistant" where a model wrote the words we never use. */
export function ourWords(text: string): string {
  return text.replace(NOT_OUR_WORDS, (word) =>
    word.toLowerCase().endsWith("s") ? "assistants" : "assistant",
  );
}

/** Cuts at a word, so a long line never ends in half a word. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(" ");
  return (space > max * 0.6 ? head.slice(0, space) : head).replace(
    /[\s,;:-]+$/u,
    "",
  );
}

/** The JSON object in a model's answer, without a code fence around it. */
function objectIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start)
    throw new DraftError("The model did not write a skill.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new DraftError("The model's skill could not be read.");
  }
}

/**
 * Turns the model's answer into a draft. It must be one JSON object with a
 * text `name`, a text `description` and a list of text `lines`; anything else
 * is an error. Long values are cut, and extra lines are left out.
 */
export function parseSkillDraft(answer: string): OwnSkillDraft {
  if (answer.length > 20_000)
    throw new DraftError("The model's skill was too long to read.");
  const raw = objectIn(answer);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new DraftError("The model's skill could not be read.");
  const value = raw as Record<string, unknown>;
  if (
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    !Array.isArray(value.lines) ||
    !value.lines.every((line) => typeof line === "string")
  )
    throw new DraftError("The model's skill was missing a part.");
  const name = cut(ourWords(oneLine(value.name)), MAX_OWN_NAME);
  const description = cut(
    ourWords(oneLine(value.description)),
    MAX_OWN_DESCRIPTION,
  );
  const lines: string[] = [];
  let total = 0;
  for (const raw of value.lines as string[]) {
    const line = cut(ourWords(cleanLine(raw)), MAX_OWN_LINE);
    if (!line || lines.includes(line)) continue;
    if (lines.length >= MAX_OWN_LINES) break;
    if (total + line.length + (lines.length > 0 ? 1 : 0) > MAX_OWN_TOTAL) break;
    total += line.length + (lines.length > 0 ? 1 : 0);
    lines.push(line);
  }
  if (!name || !description || lines.length === 0)
    throw new DraftError("The model's skill was missing a part.");
  return { name, description, lines };
}
