import {
  type Assistant,
  type AssistantInput,
  type ChatMessage,
  PET_COLORS,
  PET_IDS,
} from "./types";

/** The file an assistant is shared as. It never holds a key or a model source. */
export interface AssistantFile {
  format: "stellarfirm-open.assistant";
  version: 1;
  name: string;
  group: string;
  pet: string;
  color: string;
  brief: string;
  skills: string[];
  /** A line for the "Start from a persona" picker. An exported file has none. */
  summary?: string;
}

export const MAX_SUMMARY = 120;
export const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Checks what the page or an imported file sent before any of it is kept. */
export function cleanAssistant(
  input: unknown,
): Omit<Assistant, "id" | "createdAt" | "lastLine" | "folders" | "sites"> {
  const raw = (input ?? {}) as Record<string, unknown>;
  // A name is one line: control characters are taken out before it is cut.
  const name = text(
    typeof raw.name === "string" ? raw.name.replace(/\p{Cc}+/gu, " ") : "",
    60,
  );
  if (!name) throw new Error("Give the assistant a name.");
  const pet = PET_IDS.find((id) => id === raw.pet);
  const color = PET_COLORS.find((id) => id === raw.color);
  if (!pet || !color) throw new Error("Pick a look for the assistant.");
  const skills = Array.isArray(raw.skills)
    ? [
        ...new Set(raw.skills.map((skill) => text(skill, 40)).filter(Boolean)),
      ].slice(0, 20)
    : [];
  const sourceId = text(raw.sourceId, 40);
  const model = text(raw.model, 200);
  return {
    name,
    group: text(raw.group, 40) || "Personal",
    pet,
    color,
    // Line breaks and tabs stay; other control characters are taken out, so
    // the brief is the same text wherever it is shown or copied to.
    brief: text(
      typeof raw.brief === "string"
        ? raw.brief.replace(/[^\P{Cc}\n\t]+/gu, "")
        : "",
      4000,
    ),
    skills,
    web: raw.web === true,
    screen: raw.screen === true,
    ...(ID.test(sourceId) ? { sourceId } : {}),
    ...(model ? { model } : {}),
  };
}

/** The format and version of one assistant file, shared with the backup. */
export function isAssistantFile(file: unknown): boolean {
  if (typeof file !== "object" || file === null) return false;
  const { format, version } = file as Partial<AssistantFile>;
  return format === "stellarfirm-open.assistant" && version === 1;
}

/**
 * Reads one assistant file field by field. A shared file never brings a model
 * source, a model, web access or screen access with it, and never a folder or a site (it has
 * no field for them): the person picks those for themselves.
 */
export function readAssistantFile(file: unknown): {
  assistant: AssistantInput;
  summary?: string;
} {
  if (!isAssistantFile(file))
    throw new Error("That file is not an assistant file.");
  const {
    sourceId: _source,
    model: _model,
    web: _web,
    screen: _screen,
    ...assistant
  } = cleanAssistant(file);
  const raw = (file as { summary?: unknown }).summary;
  const summary =
    typeof raw === "string" && raw.trim() && raw.trim().length <= MAX_SUMMARY
      ? raw.trim()
      : undefined;
  return { assistant, ...(summary ? { summary } : {}) };
}

/** Keeps only the messages the app itself could have written. */
export function cleanMessages(input: unknown, max: number): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const kept: ChatMessage[] = [];
  for (const item of input.slice(0, max)) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    if (raw.role !== "user" && raw.role !== "assistant") continue;
    const body = text(
      typeof raw.text === "string"
        ? raw.text.replace(/[^\P{Cc}\n\t]+/gu, "")
        : "",
      100_000,
    );
    if (!body) continue;
    const at =
      typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at))
        ? new Date(raw.at).toISOString()
        : new Date().toISOString();
    kept.push({
      id: crypto.randomUUID(),
      role: raw.role,
      text: body,
      at,
      ...(raw.failed === true ? { failed: true } : {}),
    });
  }
  return kept;
}
