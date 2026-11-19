import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  type AssistantFile,
  cleanAssistant,
  ID,
  readAssistantFile,
  text,
} from "../shared/assistant-file";
import { presetOf } from "../shared/catalog";
import { cleanLookFor, isCheckEvery, LOOK_FOR_MAX } from "../shared/checks";
import { checkEndpoint } from "../shared/endpoint";
import {
  cleanSendKey,
  cleanTextSize,
  DEFAULT_SEND_KEY,
  DEFAULT_TEXT_SIZE,
  isSendKey,
  isTextSize,
} from "../shared/preferences";
import { cleanTheme, DEFAULT_THEME, isTheme } from "../shared/theme";
import {
  type Assistant,
  type AssistantInput,
  type ChatMessage,
  type ChatStep,
  type Connection,
  type ConnectionPreset,
  type ConnectionTool,
  type ModelSource,
  type ModelSourceInput,
  PRESET_IDS,
  type Settings,
  type Wire,
} from "../shared/types";
import { cleanVersion } from "../shared/update";

/** Everything the app keeps, in plain JSON files in its own data folder. */

type StoredSource = Omit<ModelSource, "hasKey">;

/** A tool as the server described it. The schema stays here, never in the page. */
export interface StoredTool extends ConnectionTool {
  inputSchema: Record<string, unknown>;
}

export interface StoredConnection
  extends Omit<Connection, "hasKey" | "tools" | "preset"> {
  /** Missing in a file saved before presets: that reads as "custom". */
  preset?: ConnectionPreset;
  tools: StoredTool[];
}

/** What the checks keep between runs, so a restart never gives extra ones. */
export interface CheckCounters {
  /** The local day the count is for, such as "2026-11-19". */
  day: string;
  /** Checks that started that day. */
  count: number;
  /** Checks in a row that failed. */
  failures: number;
  /** When the last check started, or when checks were switched on. */
  lastAt?: string;
}

interface StoredState {
  v: 1;
  assistants: Assistant[];
  sources: StoredSource[];
  /** Missing in a file saved before connections existed. */
  connections?: StoredConnection[];
  settings: Settings;
  /** Missing in a file saved before checks existed. */
  checks?: CheckCounters;
}

const MAX_ASSISTANTS = 50;
const MAX_SOURCES = 20;
const MAX_MESSAGES = 500;
const MAX_FOLDERS = 10;
const MAX_SITES = 100;
const MAX_CONNECTIONS = 10;
const MAX_ALLOWED_TOOLS = 200;
const MAX_CAN_ASK = 10;

/** Seconds-precise ISO times only, so a bad value never reaches a date. */
function cleanTime(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}

/**
 * Reads settings from a file that may be older than this version or edited by
 * hand: every value is checked, and anything unknown reads as its default.
 */
function cleanSettings(raw: Partial<Settings> | undefined): Settings {
  const base = raw ?? ({} as Partial<Settings>);
  const settings: Settings = {
    ...base,
    onboarded: base.onboarded === true,
    theme: cleanTheme(base.theme),
    textSize: cleanTextSize(base.textSize),
    sendWith: cleanSendKey(base.sendWith),
    checkUpdates: base.checkUpdates === true,
  };
  // The main assistant's checks: a value that is not valid is dropped, and a
  // missing one reads as its default (see `checkSettings`).
  delete settings.mainAssistantId;
  delete settings.checkOnItsOwn;
  delete settings.checkEvery;
  delete settings.checkLookFor;
  delete settings.checkNotify;
  delete settings.checkUnread;
  if (typeof base.mainAssistantId === "string" && ID.test(base.mainAssistantId))
    settings.mainAssistantId = base.mainAssistantId;
  if (base.checkOnItsOwn === true) settings.checkOnItsOwn = true;
  if (isCheckEvery(base.checkEvery)) settings.checkEvery = base.checkEvery;
  const lookFor = cleanLookFor(base.checkLookFor);
  if (lookFor) settings.checkLookFor = lookFor;
  if (base.checkNotify === true) settings.checkNotify = true;
  if (base.checkUnread === true) settings.checkUnread = true;
  const checked = cleanTime(base.lastUpdateCheck);
  const newest = cleanVersion(base.newestVersion);
  const dismissed = cleanVersion(base.dismissedVersion);
  delete settings.lastUpdateCheck;
  delete settings.newestVersion;
  delete settings.dismissedVersion;
  if (checked) settings.lastUpdateCheck = checked;
  if (newest) settings.newestVersion = newest;
  if (dismissed) settings.dismissedVersion = dismissed;
  return settings;
}

export class Store {
  constructor(private readonly dir: string) {
    mkdirSync(join(dir, "chats"), { recursive: true });
  }

  /** The folder everything is kept in, shown to the person as plain text. */
  get folder(): string {
    return this.dir;
  }

  private read(): StoredState {
    const file = join(this.dir, "state.json");
    if (!existsSync(file)) {
      return {
        v: 1,
        assistants: [],
        sources: [],
        settings: {
          onboarded: false,
          theme: DEFAULT_THEME,
          textSize: DEFAULT_TEXT_SIZE,
          sendWith: DEFAULT_SEND_KEY,
          checkUpdates: false,
        },
      };
    }
    const parsed = JSON.parse(readFileSync(file, "utf8")) as StoredState;
    // A file this version did not write is left alone rather than overwritten.
    if (parsed.v !== 1)
      throw new Error("This data was saved by a newer version of the app.");
    // A source saved before wires existed has none: it speaks "openai".
    for (const source of parsed.sources as { wire?: Wire }[])
      source.wire ??= "openai";
    // Settings saved before the theme existed follow the computer.
    parsed.settings = cleanSettings(parsed.settings);
    // Assistants saved before tools existed have no folders, sites or web.
    parsed.assistants = parsed.assistants.map((a) => ({
      ...a,
      folders: a.folders ?? [],
      web: a.web ?? false,
      screen: a.screen ?? false,
      sites: a.sites ?? [],
      connections: a.connections ?? [],
      connectionTools: a.connectionTools ?? [],
      canAsk: cleanCanAsk(a.canAsk, parsed.assistants, a.id),
    }));
    parsed.connections ??= [];
    // A main assistant that is no longer here is none, and nothing checks.
    if (
      parsed.settings.mainAssistantId &&
      !parsed.assistants.some((a) => a.id === parsed.settings.mainAssistantId)
    )
      noMain(parsed.settings);
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
      const connections =
        input.connections === undefined
          ? existing.connections
          : cleanConnectionIds(input.connections, state.connections ?? []);
      const next: Assistant = {
        ...clean,
        web: input.web === undefined ? existing.web : clean.web,
        screen: input.screen === undefined ? existing.screen : clean.screen,
        folders: existing.folders,
        sites: existing.sites,
        canAsk:
          input.canAsk === undefined
            ? (existing.canAsk ?? [])
            : cleanCanAsk(input.canAsk, state.assistants, id),
        connections,
        connectionTools: keptTools(
          existing.connectionTools,
          connections,
          state.connections ?? [],
        ),
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
      connections: cleanConnectionIds(
        input.connections ?? [],
        state.connections ?? [],
      ),
      connectionTools: [],
      id: randomUUID(),
      canAsk: [],
      createdAt: new Date().toISOString(),
    };
    created.canAsk = cleanCanAsk(input.canAsk, state.assistants, created.id);
    state.assistants.push(created);
    this.write(state);
    return created;
  }

  removeAssistant(id: string): void {
    const state = this.read();
    if (!state.assistants.some((a) => a.id === id)) return;
    state.assistants = state.assistants
      .filter((a) => a.id !== id)
      // Nobody may ask it any more.
      .map((a) =>
        (a.canAsk ?? []).includes(id)
          ? { ...a, canAsk: (a.canAsk ?? []).filter((x) => x !== id) }
          : a,
      );
    if (state.settings.mainAssistantId === id) noMain(state.settings);
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
    check?: ChatMessage["check"],
    at: Date = new Date(),
  ): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      role,
      text: body,
      at: at.toISOString(),
      ...(failed ? { failed: true } : {}),
      ...(steps.length > 0 ? { steps } : {}),
      ...(check ? { check } : {}),
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

  connections(): StoredConnection[] {
    return this.read().connections ?? [];
  }

  /**
   * Saves a connection with the tools the server just listed. The tools come
   * from the main process after it connected, never from the page. A read the
   * person allowed for good is dropped here when the tool is no longer a read.
   */
  saveConnection(input: {
    id?: string;
    name: string;
    baseUrl: string;
    preset?: ConnectionPreset;
    tools: StoredTool[];
  }): StoredConnection {
    const state = this.read();
    const list = state.connections ?? [];
    const existing = list.find((c) => c.id === input.id);
    const next: StoredConnection = {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl,
      ...(input.preset === "composio" ? { preset: "composio" as const } : {}),
      tools: input.tools,
      checkedAt: new Date().toISOString(),
    };
    if (existing) {
      state.connections = list.map((c) => (c.id === existing.id ? next : c));
    } else {
      if (list.length >= MAX_CONNECTIONS)
        throw new Error(`You can have up to ${MAX_CONNECTIONS} connections.`);
      state.connections = [...list, next];
    }
    state.assistants = state.assistants.map((a) => ({
      ...a,
      connectionTools: keptTools(
        a.connectionTools,
        a.connections,
        state.connections ?? [],
      ),
    }));
    this.write(state);
    return next;
  }

  /** Takes a connection away from every assistant that had it. */
  removeConnection(id: string): void {
    const state = this.read();
    state.connections = (state.connections ?? []).filter((c) => c.id !== id);
    state.assistants = state.assistants.map((a) => ({
      ...a,
      connections: a.connections.filter((c) => c !== id),
      connectionTools: a.connectionTools.filter((t) => !t.startsWith(`${id}:`)),
    }));
    this.write(state);
  }

  /**
   * Remembers one read of one connection for one assistant. Only a tool that
   * is marked as a read can be remembered, whatever was asked for.
   */
  allowTool(id: string, connectionId: string, tool: string): Assistant {
    const connection = this.connections().find((c) => c.id === connectionId);
    const found = connection?.tools.find((t) => t.name === tool);
    return this.change(id, (a) => {
      if (!found?.readOnly || !a.connections.includes(connectionId)) return a;
      const key = `${connectionId}:${tool}`;
      return a.connectionTools.includes(key)
        ? a
        : {
            ...a,
            connectionTools: [...a.connectionTools, key].slice(
              -MAX_ALLOWED_TOOLS,
            ),
          };
    });
  }

  removeAllowedTool(id: string, connectionId: string, tool: string): Assistant {
    const key = `${connectionId}:${tool}`;
    return this.change(id, (a) => ({
      ...a,
      connectionTools: a.connectionTools.filter((t) => t !== key),
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
        wire: preset.wire,
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
      wire: preset.wire,
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
    if (patch.theme !== undefined && !isTheme(patch.theme))
      throw new Error("That theme is not known.");
    if (patch.textSize !== undefined && !isTextSize(patch.textSize))
      throw new Error("That text size is not known.");
    if (patch.sendWith !== undefined && !isSendKey(patch.sendWith))
      throw new Error("That way of sending is not known.");
    if (
      patch.checkUpdates !== undefined &&
      typeof patch.checkUpdates !== "boolean"
    )
      throw new Error("That is not allowed.");
    if (patch.checkEvery !== undefined && !isCheckEvery(patch.checkEvery))
      throw new Error("That is not a time between checks.");
    for (const key of ["checkOnItsOwn", "checkNotify"] as const) {
      if (patch[key] !== undefined && typeof patch[key] !== "boolean")
        throw new Error("That is not allowed.");
    }
    if (patch.checkLookFor !== undefined) {
      if (
        typeof patch.checkLookFor !== "string" ||
        patch.checkLookFor.length > LOOK_FOR_MAX
      )
        throw new Error(
          `Say it in ${LOOK_FOR_MAX.toLocaleString("en-US")} characters or fewer.`,
        );
    }
    // The page may only mark an update as seen; the app is what sets it.
    if (patch.checkUnread !== undefined && patch.checkUnread !== false)
      throw new Error("That is not allowed.");
    if (
      patch.mainAssistantId !== undefined &&
      typeof patch.mainAssistantId !== "string"
    )
      throw new Error("That is not allowed.");
    const state = this.read();
    if (patch.mainAssistantId !== undefined) {
      if (patch.mainAssistantId === "") noMain(state.settings);
      else if (!state.assistants.some((a) => a.id === patch.mainAssistantId))
        throw new Error("That assistant is no longer here.");
      else if (state.settings.mainAssistantId !== patch.mainAssistantId) {
        state.settings.mainAssistantId = patch.mainAssistantId;
        // Another assistant is main now: checks start again from nothing.
        delete state.settings.checkOnItsOwn;
        delete state.settings.checkUnread;
      }
    }
    if (patch.checkOnItsOwn !== undefined) {
      if (patch.checkOnItsOwn && !state.settings.mainAssistantId)
        throw new Error("Pick the main assistant first.");
      if (patch.checkOnItsOwn && !state.settings.checkOnItsOwn) {
        // Switched on now: the first check is one wait away, never at once.
        state.checks = {
          day: state.checks?.day ?? "",
          count: state.checks?.count ?? 0,
          failures: 0,
          lastAt: new Date().toISOString(),
        };
      }
      state.settings.checkOnItsOwn = patch.checkOnItsOwn;
    }
    if (patch.checkEvery !== undefined)
      state.settings.checkEvery = patch.checkEvery;
    if (patch.checkLookFor !== undefined)
      state.settings.checkLookFor = cleanLookFor(patch.checkLookFor);
    if (patch.checkNotify !== undefined)
      state.settings.checkNotify = patch.checkNotify;
    if (patch.checkUnread === false) delete state.settings.checkUnread;
    if (patch.theme !== undefined) state.settings.theme = patch.theme;
    if (patch.textSize !== undefined) state.settings.textSize = patch.textSize;
    if (patch.sendWith !== undefined) state.settings.sendWith = patch.sendWith;
    if (patch.checkUpdates !== undefined)
      state.settings.checkUpdates = patch.checkUpdates;
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

  /**
   * What an update check leaves behind: when it ran, and the newest version it
   * saw (null forgets one, undefined keeps what is there). Only the update
   * check calls this, so the page cannot set either.
   */
  recordUpdateCheck(at: Date, newest?: string | null): Settings {
    const state = this.read();
    state.settings.lastUpdateCheck = at.toISOString();
    if (newest === null) delete state.settings.newestVersion;
    else if (newest !== undefined) {
      const clean = cleanVersion(newest);
      if (!clean) throw new Error("That is not a version.");
      state.settings.newestVersion = clean;
    }
    this.write(state);
    return state.settings;
  }

  /** Closes the notice for the newest version, so it is not shown again. */
  dismissUpdate(): Settings {
    const state = this.read();
    if (state.settings.newestVersion)
      state.settings.dismissedVersion = state.settings.newestVersion;
    this.write(state);
    return state.settings;
  }

  /**
   * Forgets what the person approved "always", so everything asks again. Today
   * that is the sites an assistant may read. Any other kind of remembered
   * permission added later is cleared here too, and counted in the result.
   */
  clearApprovals(): number {
    const state = this.read();
    let count = 0;
    state.assistants = state.assistants.map((a) => {
      // Every kind of remembered approval: sites, and reads on connections.
      const held = a.sites.length + a.connectionTools.length;
      count += held;
      return held > 0 ? { ...a, sites: [], connectionTools: [] } : a;
    });
    if (count > 0) this.write(state);
    return count;
  }

  /** Deletes every chat and keeps the assistants. Returns how many chats there were. */
  deleteAllChats(): number {
    const folder = join(this.dir, "chats");
    let count = 0;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith(".json")) continue;
      rmSync(join(folder, name), { force: true });
      count += 1;
    }
    const state = this.read();
    state.assistants = state.assistants.map((a) => {
      const { lastLine: _gone, ...rest } = a;
      return rest;
    });
    this.write(state);
    return count;
  }

  /** What the checks have done so far today, kept so a restart cannot reset it. */
  checkCounters(): CheckCounters {
    return this.read().checks ?? { day: "", count: 0, failures: 0 };
  }

  saveCheckCounters(counters: CheckCounters): void {
    const state = this.read();
    state.checks = counters;
    this.write(state);
  }

  /** Marks that a check left an update the person has not seen. */
  markCheckUpdate(assistantId: string): void {
    const state = this.read();
    if (state.settings.mainAssistantId !== assistantId) return;
    state.settings.checkUnread = true;
    this.write(state);
  }

  /** Switches checks off, as the app does after three failures in a row. */
  stopChecks(): void {
    const state = this.read();
    delete state.settings.checkOnItsOwn;
    this.write(state);
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
    return this.saveAssistant(readAssistantFile(parsed).assistant);
  }

  /** Adds an assistant as a new one, with an earlier chat if it has one. */
  addImported(assistant: AssistantInput, chat: ChatMessage[]): Assistant {
    // No id: this is always a new assistant, never a change to one that is here.
    const { id: _id, ...fresh } = assistant;
    const saved = this.saveAssistant(fresh);
    if (chat.length > 0) {
      this.writeFile(this.chatFile(saved.id), chat);
      const last = chat[chat.length - 1];
      this.change(saved.id, (a) => ({
        ...a,
        ...(last
          ? { lastLine: last.text.replace(/\s+/g, " ").slice(0, 90) }
          : {}),
      }));
    }
    return this.assistant(saved.id);
  }
}

/** The ids the page sent, kept only when they name a saved connection. */
function cleanConnectionIds(ids: unknown, saved: StoredConnection[]): string[] {
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(
      ids.filter(
        (id): id is string =>
          typeof id === "string" && saved.some((c) => c.id === id),
      ),
    ),
  ].slice(0, MAX_CONNECTIONS);
}

/**
 * The reads an assistant may always use: only for a connection it still has,
 * and only for a tool that is still there and still marked as a read.
 */
function keptTools(
  allowed: string[],
  connections: string[],
  saved: StoredConnection[],
): string[] {
  return allowed.filter((key) => {
    const at = key.indexOf(":");
    const id = key.slice(0, at);
    const tool = key.slice(at + 1);
    if (!connections.includes(id)) return false;
    return (
      saved
        .find((c) => c.id === id)
        ?.tools.some((t) => t.name === tool && t.readOnly) ?? false
    );
  });
}

/** No main assistant: nothing checks, and nothing is unread. */
function noMain(settings: Settings): void {
  delete settings.mainAssistantId;
  delete settings.checkOnItsOwn;
  delete settings.checkUnread;
}

/** The assistants it may ask: others that exist, once each, never itself. */
function cleanCanAsk(
  ids: unknown,
  assistants: { id: string }[],
  self: string,
): string[] {
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(
      ids.filter(
        (id): id is string =>
          typeof id === "string" &&
          id !== self &&
          assistants.some((a) => a.id === id),
      ),
    ),
  ].slice(0, MAX_CAN_ASK);
}
