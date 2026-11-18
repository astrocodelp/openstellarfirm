/** Types shared by the main process, the preload and the page. No Node or DOM imports. */

import type { LinkName } from "./links";
import type { SendKey, TextSize } from "./preferences";
import type { Theme } from "./theme";
import type { UpdateCheck } from "./update";

export type { LinkName, SendKey, TextSize, UpdateCheck };

export const PET_IDS = [
  "blip",
  "glim",
  "pop",
  "puff",
  "tally",
  "drift",
] as const;
export type PetId = (typeof PET_IDS)[number];

export const PET_COLORS = ["lime", "sky", "nebula", "rose", "moon"] as const;
export type PetColor = (typeof PET_COLORS)[number];

export const PRESET_IDS = [
  "ollama",
  "lmstudio",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "mistral",
  "together",
  "custom",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/**
 * The way a model service is spoken to. The preset decides it in the main
 * process; the page never sends one. A source saved before this existed
 * has none, and reads as "openai".
 */
export type Wire = "openai" | "anthropic" | "gemini";

export interface Assistant {
  id: string;
  name: string;
  /** The sidebar heading it sits under, such as "Work". */
  group: string;
  pet: PetId;
  color: PetColor;
  /** What it does, in the person's own words. */
  brief: string;
  skills: string[];
  /** A model source of its own; none means the default source. */
  sourceId?: string;
  /** A model of its own; none means the source's model. */
  model?: string;
  /**
   * Folders on this computer it may read and add files to. Only the system's
   * own folder picker, opened by the main process, ever adds one.
   */
  folders: string[];
  /** Whether it may read web pages (it asks before a site's first read). */
  web: boolean;
  /**
   * Whether it may ask to look at the screen. Off unless the person turns it
   * on here; never in a shared file, a backup or a persona. Every look still
   * asks first.
   */
  screen?: boolean;
  /** Sites the person chose to always allow for this assistant. */
  sites: string[];
  /** Ids of the connections it may use. Only the assistant form sets them. */
  connections: string[];
  /**
   * Reads the person chose to always allow, as "<connection id>:<tool>".
   * Only a tool marked as a read can ever be listed here.
   */
  connectionTools: string[];
  /** The start of its newest message, for the sidebar. */
  lastLine?: string;
  createdAt: string;
}

/** What the page may set. Folders and sites are never set from here. */
export type AssistantInput = Pick<
  Assistant,
  "name" | "group" | "pet" | "color" | "brief" | "skills" | "sourceId" | "model"
> & { id?: string; web?: boolean; screen?: boolean; connections?: string[] };

/** One thing the assistant did while answering, as a short plain line. */
export interface ChatStep {
  label: string;
  ok: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  /** True when the model call failed and the text says why. */
  failed?: boolean;
  steps?: ChatStep[];
}

/** A step that waits for the person. Built by the main process, in plain words. */
export interface ApprovalCard {
  id: string;
  assistantId: string;
  title: string;
  /** Exactly what would happen, such as the full address. */
  detail: string;
  why: string;
  /** The site an "always allow" would remember; none when it cannot be remembered. */
  site?: string;
  /** True when "Always allow" would remember this one read for this assistant. */
  canAlways?: boolean;
}

export type Decision = "approve" | "always" | "reject";

/** Where a model runs. The key itself never leaves the main process. */
export interface ModelSource {
  id: string;
  preset: PresetId;
  name: string;
  baseUrl: string;
  /** Set from the preset when saved. */
  wire: Wire;
  model: string;
  hasKey: boolean;
}

export interface ModelSourceInput {
  id?: string;
  preset: PresetId;
  name?: string;
  baseUrl?: string;
  model: string;
  /** Sent once, on save. Never returned. Empty keeps the saved key. */
  apiKey?: string;
}

/** One tool a connection offers. Only the main process ever sets these. */
export interface ConnectionTool {
  name: string;
  /** Cut and cleaned. It is the server's own text, so it is only shown. */
  description: string;
  /** True only when the server says it reads and the name does not read like a change. */
  readOnly: boolean;
}

/** A remote server the assistants may use tools from. The key never leaves the main process. */
export interface Connection {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  tools: ConnectionTool[];
  checkedAt: string;
}

export interface ConnectionInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** Sent once, on check or save. Never returned. Empty keeps the saved key. */
  apiKey?: string;
}

export interface Settings {
  onboarded: boolean;
  /** How the app looks: follow the computer, or always dark or light. */
  theme: Theme;
  defaultSourceId?: string;
  /** True once the person closed the StellarFirm cloud card in the sidebar. */
  hideCloudCard?: boolean;
  /** How big the text is: the root size the whole page scales from. */
  textSize: TextSize;
  /** What sends a message in the chat box. */
  sendWith: SendKey;
  /** Off until the person turns it on: a once-a-day look at the newest version. */
  checkUpdates: boolean;
  /** When the update check last ran, and the newest version it found. */
  lastUpdateCheck?: string;
  newestVersion?: string;
  /** The version whose notice the person closed. */
  dismissedVersion?: string;
}

export interface AppState {
  assistants: Assistant[];
  sources: ModelSource[];
  connections: Connection[];
  settings: Settings;
  /** False when this computer has no keychain to keep a key in. */
  keychain: boolean;
  platform: string;
  /** This app's own version, such as "0.1.0". */
  version: string;
  /** The folder the app keeps everything in, shown as plain text. */
  dataDir: string;
}

export interface LocalModels {
  ollama: string[] | null;
  lmstudio: string[] | null;
}

export interface ChatDelta {
  assistantId: string;
  text: string;
}

export interface ChatDone {
  assistantId: string;
  message: ChatMessage;
}

/** What the assistant is doing right now, such as "Reading notes.md". */
export interface ChatActivity {
  assistantId: string;
  label: string;
}

export interface ApprovalChange {
  assistantId: string;
  /** The step that waits now; null when nothing waits any more. */
  card: ApprovalCard | null;
}

/** What a backup import did, so the screen can say it in numbers. */
export interface BackupResult {
  added: number;
  skipped: number;
  /** How many of the added assistants came with their chat. */
  chats: number;
  /** True when the app's limit on assistants stopped the rest. */
  full: boolean;
}

/** What the page can ask the main process to do. */
export interface OpenApi {
  getState(): Promise<AppState>;
  saveAssistant(input: AssistantInput): Promise<Assistant>;
  removeAssistant(id: string): Promise<void>;
  exportAssistant(id: string): Promise<boolean>;
  importAssistant(): Promise<Assistant | null>;
  /**
   * Saves every assistant to one file, through the system's save dialog.
   * False when the person closed the dialog. The page never names a path.
   */
  exportBackup(includeChats: boolean): Promise<boolean>;
  /** Adds the assistants of a backup as new ones; null when no file was picked. */
  importBackup(): Promise<BackupResult | null>;
  /** Opens the system's folder picker. Null when the person closed it. */
  addFolder(assistantId: string): Promise<Assistant | null>;
  removeFolder(assistantId: string, folder: string): Promise<Assistant>;
  removeSite(assistantId: string, site: string): Promise<Assistant>;
  messages(assistantId: string): Promise<ChatMessage[]>;
  send(assistantId: string, text: string): Promise<ChatMessage>;
  stop(assistantId: string): Promise<void>;
  /** The step that waits for the person in this chat, if any. */
  pending(assistantId: string): Promise<ApprovalCard | null>;
  decide(
    assistantId: string,
    approvalId: string,
    decision: Decision,
  ): Promise<void>;
  /** Connects to the address and lists its tools. Saves nothing. */
  checkConnection(input: ConnectionInput): Promise<ConnectionTool[]>;
  /** Connects, lists the tools the server offers, and saves the connection. */
  saveConnection(input: ConnectionInput): Promise<Connection>;
  removeConnection(id: string): Promise<void>;
  /** Takes back an "Always allow" for one read of one connection. */
  removeConnectionTool(
    assistantId: string,
    connectionId: string,
    tool: string,
  ): Promise<Assistant>;
  saveSource(input: ModelSourceInput): Promise<ModelSource>;
  removeSource(id: string): Promise<void>;
  /** Lists the models of a source that is not saved yet. */
  probeModels(input: {
    preset: PresetId;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<string[]>;
  /** Lists the models of a saved source, which also proves it works. */
  checkSource(id: string): Promise<string[]>;
  detectLocal(): Promise<LocalModels>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /**
   * Opens stellarfirm.ai in the person's browser. "copy" carries one
   * assistant's name, look and brief there. The address is built in the main
   * process from fixed parts; the page never supplies one.
   */
  openCloud(target: "home" | "copy", assistantId?: string): Promise<void>;
  /**
   * Opens one of the app's fixed links in the browser, by name. The address
   * is built in the main process; the page never supplies one.
   */
  openLink(name: LinkName): Promise<void>;
  /** Opens the app's own data folder. The page names no path. */
  openDataFolder(): Promise<void>;
  /**
   * Forgets every site "Always allow" remembered, for every assistant, so each
   * asks again. Returns how many were forgotten.
   */
  clearApprovals(): Promise<number>;
  /** Deletes every chat and keeps the assistants. Returns how many chats. */
  deleteAllChats(): Promise<number>;
  /** One check for a newer version, on the person's click. */
  checkForUpdate(): Promise<UpdateCheck>;
  /** Closes the notice for the version that is shown now. */
  dismissUpdate(): Promise<Settings>;
  onDelta(listener: (delta: ChatDelta) => void): () => void;
  onDone(listener: (done: ChatDone) => void): () => void;
  onActivity(listener: (activity: ChatActivity) => void): () => void;
  onApproval(listener: (change: ApprovalChange) => void): () => void;
}

export const IPC = {
  getState: "state:get",
  saveAssistant: "assistant:save",
  removeAssistant: "assistant:remove",
  exportAssistant: "assistant:export",
  importAssistant: "assistant:import",
  exportBackup: "backup:export",
  importBackup: "backup:import",
  addFolder: "assistant:folder:add",
  removeFolder: "assistant:folder:remove",
  removeSite: "assistant:site:remove",
  messages: "chat:messages",
  send: "chat:send",
  stop: "chat:stop",
  pending: "chat:pending",
  decide: "chat:decide",
  checkConnection: "connection:check",
  saveConnection: "connection:save",
  removeConnection: "connection:remove",
  removeConnectionTool: "assistant:connection-tool:remove",
  saveSource: "source:save",
  removeSource: "source:remove",
  probeModels: "source:probe",
  checkSource: "source:check",
  detectLocal: "source:detect",
  setSettings: "settings:set",
  openCloud: "cloud:open",
  openLink: "link:open",
  openDataFolder: "data:open",
  clearApprovals: "approvals:clear",
  deleteAllChats: "chats:deleteAll",
  checkForUpdate: "update:check",
  dismissUpdate: "update:dismiss",
  delta: "chat:delta",
  done: "chat:done",
  activity: "chat:activity",
  approval: "chat:approval",
} as const;

/** Every answer over IPC, so an error arrives as a plain sentence. */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
