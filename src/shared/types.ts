/** Types shared by the main process, the preload and the page. No Node or DOM imports. */

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
  "openrouter",
  "mistral",
  "together",
  "custom",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

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
  /** The start of its newest message, for the sidebar. */
  lastLine?: string;
  createdAt: string;
}

export type AssistantInput = Pick<
  Assistant,
  "name" | "group" | "pet" | "color" | "brief" | "skills" | "sourceId" | "model"
> & { id?: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  /** True when the model call failed and the text says why. */
  failed?: boolean;
}

/** Where a model runs. The key itself never leaves the main process. */
export interface ModelSource {
  id: string;
  preset: PresetId;
  name: string;
  baseUrl: string;
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

export interface Settings {
  onboarded: boolean;
  defaultSourceId?: string;
}

export interface AppState {
  assistants: Assistant[];
  sources: ModelSource[];
  settings: Settings;
  /** False when this computer has no keychain to keep a key in. */
  keychain: boolean;
  platform: string;
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

/** What the page can ask the main process to do. */
export interface OpenApi {
  getState(): Promise<AppState>;
  saveAssistant(input: AssistantInput): Promise<Assistant>;
  removeAssistant(id: string): Promise<void>;
  exportAssistant(id: string): Promise<boolean>;
  importAssistant(): Promise<Assistant | null>;
  messages(assistantId: string): Promise<ChatMessage[]>;
  send(assistantId: string, text: string): Promise<ChatMessage>;
  stop(assistantId: string): Promise<void>;
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
  onDelta(listener: (delta: ChatDelta) => void): () => void;
  onDone(listener: (done: ChatDone) => void): () => void;
}

export const IPC = {
  getState: "state:get",
  saveAssistant: "assistant:save",
  removeAssistant: "assistant:remove",
  exportAssistant: "assistant:export",
  importAssistant: "assistant:import",
  messages: "chat:messages",
  send: "chat:send",
  stop: "chat:stop",
  saveSource: "source:save",
  removeSource: "source:remove",
  probeModels: "source:probe",
  checkSource: "source:check",
  detectLocal: "source:detect",
  setSettings: "settings:set",
  delta: "chat:delta",
  done: "chat:done",
} as const;

/** Every answer over IPC, so an error arrives as a plain sentence. */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
