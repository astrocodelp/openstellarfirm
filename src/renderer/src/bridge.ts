import type {
  AppState,
  Assistant,
  ChatDone,
  ChatMessage,
  ModelSource,
  OpenApi,
} from "../../shared/types";

/**
 * The page talks to the app through `window.stellarOpen`. In a plain browser
 * (`pnpm dev:ui`) there is no app behind it, so this stand-in keeps a little
 * data in memory. It calls no model and saves nothing: it is for working on
 * the screens only.
 */
function preview(): OpenApi {
  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  const source: ModelSource = {
    id: id(),
    preset: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "example-model",
    hasKey: false,
  };
  const state: AppState = {
    assistants: [
      {
        id: id(),
        name: "Research and writing",
        group: "Work",
        pet: "glim",
        color: "sky",
        brief: "You help me research and write. Give a source for every claim.",
        skills: ["research", "write"],
        lastLine: "This is the browser preview.",
        createdAt: now(),
      },
      {
        id: id(),
        name: "Trip planner",
        group: "Home",
        pet: "blip",
        color: "rose",
        brief: "You help me plan trips.",
        skills: ["plan"],
        createdAt: now(),
      },
    ],
    sources: [source],
    settings: { onboarded: true, defaultSourceId: source.id },
    keychain: true,
    platform: "browser",
  };
  const chats = new Map<string, ChatMessage[]>();
  const doneListeners = new Set<(done: ChatDone) => void>();
  const say = (
    assistantId: string,
    role: ChatMessage["role"],
    text: string,
  ): ChatMessage => {
    const message: ChatMessage = { id: id(), role, text, at: now() };
    chats.set(assistantId, [...(chats.get(assistantId) ?? []), message]);
    return message;
  };
  return {
    getState: async () => structuredClone(state),
    saveAssistant: async (input) => {
      const existing = state.assistants.find((a) => a.id === input.id);
      const next: Assistant = {
        ...existing,
        ...input,
        id: existing?.id ?? id(),
        createdAt: existing?.createdAt ?? now(),
      };
      state.assistants = existing
        ? state.assistants.map((a) => (a.id === next.id ? next : a))
        : [...state.assistants, next];
      return next;
    },
    removeAssistant: async (assistantId) => {
      state.assistants = state.assistants.filter((a) => a.id !== assistantId);
    },
    exportAssistant: async () => false,
    importAssistant: async () => null,
    messages: async (assistantId) => chats.get(assistantId) ?? [],
    send: async (assistantId, text) => {
      const message = say(assistantId, "user", text);
      setTimeout(() => {
        const reply = say(
          assistantId,
          "assistant",
          "This is the browser preview. Open the desktop app to talk to a model.",
        );
        for (const listener of doneListeners)
          listener({ assistantId, message: reply });
      }, 400);
      return message;
    },
    stop: async () => {},
    saveSource: async (input) => {
      const next: ModelSource = {
        id: input.id ?? id(),
        preset: input.preset,
        name: input.name ?? input.preset,
        baseUrl: input.baseUrl ?? "",
        model: input.model,
        hasKey: Boolean(input.apiKey),
      };
      state.sources = [...state.sources.filter((s) => s.id !== next.id), next];
      state.settings.defaultSourceId ??= next.id;
      return next;
    },
    removeSource: async (sourceId) => {
      state.sources = state.sources.filter((s) => s.id !== sourceId);
    },
    probeModels: async () => ["example-model"],
    checkSource: async () => ["example-model"],
    detectLocal: async () => ({ ollama: null, lmstudio: null }),
    setSettings: async (patch) => {
      state.settings = { ...state.settings, ...patch };
      return state.settings;
    },
    onDelta: () => () => {},
    onDone: (listener) => {
      doneListeners.add(listener);
      return () => doneListeners.delete(listener);
    },
  };
}

export const api: OpenApi = window.stellarOpen ?? preview();
