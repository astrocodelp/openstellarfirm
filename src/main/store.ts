import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { presetOf } from "../shared/catalog";
import { checkEndpoint } from "../shared/endpoint";
import {
  type Assistant,
  type AssistantInput,
  type ChatMessage,
  type ChatStep,
  type ModelSource,
  type ModelSourceInput,
  PET_COLORS,
  PET_IDS,
  PRESET_IDS,
  type Settings,
} from "../shared/types";

/** Everything the app keeps, in plain JSON files in its own data folder. */

type StoredSource = Omit<ModelSource, "hasKey">;

interface StoredState {
  v: 1;
  assistants: Assistant[];
  sources: StoredSource[];
  settings: Settings;
}

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
}

const MAX_ASSISTANTS = 50;
const MAX_SOURCES = 20;
const MAX_MESSAGES = 500;
const MAX_FOLDERS = 10;
const MAX_SITES = 100;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function text(value: unknown, max: number): string {
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
    ...(ID.test(sourceId) ? { sourceId } : {}),
    ...(model ? { model } : {}),
  };
}

export class Store {
  constructor(private readonly dir: string) {
    mkdirSync(join(dir, "chats"), { recursive: true });
  }

  private read(): StoredState {
    const file = join(this.dir, "state.json");
    if (!existsSync(file)) {
      return {
        v: 1,
        assistants: [],
        sources: [],
        settings: { onboarded: false },
      };
    }
    const parsed = JSON.parse(readFileSync(file, "utf8")) as StoredState;
    // A file this version did not write is left alone rather than overwritten.
    if (parsed.v !== 1)
      throw new Error("This data was saved by a newer version of the app.");
    // Assistants saved before tools existed have no folders, sites or web.
    parsed.assistants = parsed.assistants.map((a) => ({
      ...a,
      folders: a.folders ?? [],
      web: a.web ?? false,
      sites: a.sites ?? [],
    }));
    return parsed;
  }

  private write(state: StoredState): void {
    this.writeFile(join(this.dir, "state.json"), state);
  }

  /** Writes beside the file and renames, so a crash never leaves half a file. */
  private writeFile(file: string, value: unknown): void {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, file);
  }

  assistants(): Assistant[] {
    return this.read().assistants;
  }

  assistant(id: string): Assistant {
    const found = this.read().assistants.find((a) => a.id === id);
    if (!found) throw new Error("That assistant is no longer here.");
    return found;
  }

  saveAssistant(input: AssistantInput): Assistant {
    const state = this.read();
    const clean = cleanAssistant(input);
    if (clean.sourceId && !state.sources.some((s) => s.id === clean.sourceId)) {
      delete clean.sourceId;
    }
    const existing = state.assistants.find((a) => a.id === input.id);
    if (existing) {
      const { lastLine, id, createdAt } = existing;
      // Folders and sites are never set from the page: they are kept as they are.
      const next: Assistant = {
        ...clean,
        web: input.web === undefined ? existing.web : clean.web,
        folders: existing.folders,
        sites: existing.sites,
        id,
        createdAt,
        ...(lastLine ? { lastLine } : {}),
      };
      state.assistants = state.assistants.map((a) => (a.id === id ? next : a));
      this.write(state);
      return next;
    }
    if (state.assistants.length >= MAX_ASSISTANTS) {
      throw new Error(`You can have up to ${MAX_ASSISTANTS} assistants.`);
    }
    const created: Assistant = {
      ...clean,
      folders: [],
      sites: [],
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    state.assistants.push(created);
    this.write(state);
    return created;
  }

  removeAssistant(id: string): void {
    const state = this.read();
    if (!state.assistants.some((a) => a.id === id)) return;
    state.assistants = state.assistants.filter((a) => a.id !== id);
    this.write(state);
    rmSync(this.chatFile(id), { force: true });
  }

  /** The id comes from the page, so it is checked before it names a file. */
  private chatFile(id: string): string {
    if (!ID.test(id)) throw new Error("That assistant is no longer here.");
    return join(this.dir, "chats", `${id}.json`);
  }

  messages(assistantId: string): ChatMessage[] {
    this.assistant(assistantId);
    const file = this.chatFile(assistantId);
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, "utf8")) as ChatMessage[];
  }

  appendMessage(
    assistantId: string,
    role: ChatMessage["role"],
    body: string,
    failed = false,
    steps: ChatStep[] = [],
  ): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      role,
      text: body,
      at: new Date().toISOString(),
      ...(failed ? { failed: true } : {}),
      ...(steps.length > 0 ? { steps } : {}),
    };
    const all = [...this.messages(assistantId), message].slice(-MAX_MESSAGES);
    this.writeFile(this.chatFile(assistantId), all);
    const state = this.read();
    state.assistants = state.assistants.map((a) =>
      a.id === assistantId
        ? { ...a, lastLine: body.replace(/\s+/g, " ").slice(0, 90) }
        : a,
    );
    this.write(state);
    return message;
  }

  private change(id: string, edit: (a: Assistant) => Assistant): Assistant {
    const state = this.read();
    const found = state.assistants.find((a) => a.id === id);
    if (!found) throw new Error("That assistant is no longer here.");
    const next = edit(found);
    state.assistants = state.assistants.map((a) => (a.id === id ? next : a));
    this.write(state);
    return next;
  }

  /** `folder` comes only from the system's folder picker, never from the page. */
  addFolder(id: string, folder: string): Assistant {
    return this.change(id, (a) => {
      if (a.folders.includes(folder)) return a;
      if (a.folders.length >= MAX_FOLDERS) {
        throw new Error(`An assistant can use up to ${MAX_FOLDERS} folders.`);
      }
      return { ...a, folders: [...a.folders, folder] };
    });
  }

  removeFolder(id: string, folder: string): Assistant {
    return this.change(id, (a) => ({
      ...a,
      folders: a.folders.filter((f) => f !== folder),
    }));
  }

  /** Remembers a site the person chose to always allow for this assistant. */
  addSite(id: string, site: string): Assistant {
    return this.change(id, (a) =>
      a.sites.includes(site)
        ? a
        : { ...a, sites: [...a.sites, site].slice(-MAX_SITES) },
    );
  }

  removeSite(id: string, site: string): Assistant {
    return this.change(id, (a) => ({
      ...a,
      sites: a.sites.filter((s) => s !== site),
    }));
  }

  sources(): StoredSource[] {
    return this.read().sources;
  }

  source(id: string): StoredSource {
    const found = this.read().sources.find((s) => s.id === id);
    if (!found) throw new Error("That model source is no longer here.");
    return found;
  }

  saveSource(input: ModelSourceInput): StoredSource {
    const state = this.read();
    if (!PRESET_IDS.includes(input.preset))
      throw new Error("That model source is not known.");
    const preset = presetOf(input.preset);
    const model = text(input.model, 200);
    if (!model) throw new Error("Name the model to use.");
    // A preset's address is fixed in code. Only "custom" takes one from the person.
    const baseUrl = checkEndpoint(
      preset.id === "custom" ? (input.baseUrl ?? "") : preset.baseUrl,
    );
    const name = text(input.name, 40) || preset.name;
    const existing = state.sources.find((s) => s.id === input.id);
    if (existing) {
      const next: StoredSource = {
        ...existing,
        preset: preset.id,
        name,
        baseUrl,
        model,
      };
      state.sources = state.sources.map((s) =>
        s.id === existing.id ? next : s,
      );
      this.write(state);
      return next;
    }
    if (state.sources.length >= MAX_SOURCES) {
      throw new Error(`You can have up to ${MAX_SOURCES} model sources.`);
    }
    const created: StoredSource = {
      id: randomUUID(),
      preset: preset.id,
      name,
      baseUrl,
      model,
    };
    state.sources.push(created);
    if (!state.settings.defaultSourceId)
      state.settings.defaultSourceId = created.id;
    this.write(state);
    return created;
  }

  removeSource(id: string): void {
    const state = this.read();
    state.sources = state.sources.filter((s) => s.id !== id);
    if (state.settings.defaultSourceId === id) {
      const next = state.sources[0]?.id;
      if (next) state.settings.defaultSourceId = next;
      else delete state.settings.defaultSourceId;
    }
    state.assistants = state.assistants.map((a) => {
      if (a.sourceId !== id) return a;
      const { sourceId: _gone, model: _model, ...rest } = a;
      return rest;
    });
    this.write(state);
  }

  settings(): Settings {
    return this.read().settings;
  }

  setSettings(patch: Partial<Settings>): Settings {
    const state = this.read();
    if (typeof patch.onboarded === "boolean")
      state.settings.onboarded = patch.onboarded;
    if (typeof patch.hideCloudCard === "boolean")
      state.settings.hideCloudCard = patch.hideCloudCard;
    if (
      typeof patch.defaultSourceId === "string" &&
      state.sources.some((s) => s.id === patch.defaultSourceId)
    ) {
      state.settings.defaultSourceId = patch.defaultSourceId;
    }
    this.write(state);
    return state.settings;
  }

  exportFile(id: string): AssistantFile {
    // Cleaned again on the way out, so a file made by an older version of the
    // app is the same shape as one made today.
    const a = cleanAssistant(this.assistant(id));
    return {
      format: "stellarfirm-open.assistant",
      version: 1,
      name: a.name,
      group: a.group,
      pet: a.pet,
      color: a.color,
      brief: a.brief,
      skills: a.skills,
    };
  }

  importFile(raw: string): Assistant {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("That file is not an assistant file.");
    }
    const file = parsed as Partial<AssistantFile>;
    if (file.format !== "stellarfirm-open.assistant" || file.version !== 1) {
      throw new Error("That file is not an assistant file.");
    }
    // A shared file never brings a model source or any access with it: the
    // person turns web pages on, and picks folders, for themselves.
    const {
      sourceId: _source,
      model: _model,
      web: _web,
      ...clean
    } = cleanAssistant(file);
    return this.saveAssistant(clean);
  }
}
