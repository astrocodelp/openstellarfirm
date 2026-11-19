import { presetOf } from "../../shared/catalog";
import type {
  ComputerHold,
  ComputerProgress,
  ComputerView,
} from "../../shared/computer";
import { catalogEntry, catalogPreset } from "../../shared/connection-catalog";
import type { OcrDownloadProgress } from "../../shared/download-progress";
import { cleanNoteText } from "../../shared/memory";
import { searchChats } from "../../shared/search";
import type {
  AppState,
  Assistant,
  AssistantMemory,
  ChatDone,
  ChatMessage,
  Connection,
  MailAccount,
  ModelSource,
  OcrLanguage,
  OpenApi,
} from "../../shared/types";
import { recordPreview } from "./record-preview";

type MemoryApi = Pick<
  OpenApi,
  | "memory"
  | "addNote"
  | "editNote"
  | "removeNote"
  | "setMemoryOn"
  | "forgetMessage"
  | "undoForget"
  | "clearChat"
  | "summariseChat"
  | "keepSummary"
  | "undoSummary"
>;

type LanguagesApi = Pick<
  OpenApi,
  | "ocrLanguages"
  | "downloadOcrLanguage"
  | "cancelOcrLanguage"
  | "removeOcrLanguage"
  | "onOcrProgress"
>;

/**
 * Reading languages for the browser preview: nothing is fetched. A download
 * takes about three seconds of made-up progress, so the bar and Stop can be
 * seen; French fails halfway, so the failure line can be seen too.
 */
function previewLanguages(): LanguagesApi {
  const all: OcrLanguage[] = [
    {
      code: "eng",
      name: "English",
      size: 4_113_088,
      builtIn: true,
      installed: true,
    },
    {
      code: "fra",
      name: "French",
      size: 1_130_365,
      builtIn: false,
      installed: false,
    },
    {
      code: "deu",
      name: "German",
      size: 1_525_436,
      builtIn: false,
      installed: false,
    },
  ];
  const listeners = new Set<(progress: OcrDownloadProgress) => void>();
  const stops = new Map<string, () => void>();
  const list = () => all.map((l) => ({ ...l }));
  return {
    ocrLanguages: async () => list(),
    downloadOcrLanguage: async (code) => {
      const language = all.find((l) => l.code === code && !l.builtIn);
      if (!language) throw new Error("That language is not in the list.");
      let stopped = false;
      stops.set(code, () => {
        stopped = true;
      });
      try {
        for (let step = 0; step <= 30; step += 1) {
          if (stopped) throw new Error("Stopped. Nothing was kept.");
          if (code === "fra" && step === 15)
            throw new Error(
              "The language could not be downloaded. Check your connection and try again.",
            );
          const received = Math.round((language.size * step) / 30);
          for (const listener of listeners)
            listener({ code, received, total: language.size });
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        stops.delete(code);
      }
      language.installed = true;
      return list();
    },
    cancelOcrLanguage: async (code) => {
      const stop = stops.get(code);
      stop?.();
      return stop !== undefined;
    },
    removeOcrLanguage: async (code) => {
      const language = all.find((l) => l.code === code && !l.builtIn);
      if (language) language.installed = false;
      return list();
    },
    onOcrProgress: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Memory and chat context for the browser preview: kept in memory, no model. */
function previewMemory(chats: Map<string, ChatMessage[]>): MemoryApi {
  const memories = new Map<string, AssistantMemory>();
  const get = (assistantId: string): AssistantMemory =>
    memories.get(assistantId) ?? { on: true, notes: [] };
  const set = (assistantId: string, next: AssistantMemory) => {
    memories.set(assistantId, next);
    return structuredClone(next);
  };
  return {
    memory: async (assistantId) => structuredClone(get(assistantId)),
    addNote: async (assistantId, text) => {
      const m = get(assistantId);
      return set(assistantId, {
        ...m,
        notes: [
          ...m.notes,
          {
            id: crypto.randomUUID(),
            text: cleanNoteText(text),
            at: new Date().toISOString(),
            by: "person",
          },
        ],
      });
    },
    editNote: async (assistantId, noteId, text) => {
      const m = get(assistantId);
      const clean = cleanNoteText(text);
      return set(assistantId, {
        ...m,
        notes: m.notes.map((n) =>
          n.id === noteId ? { ...n, text: clean } : n,
        ),
      });
    },
    removeNote: async (assistantId, noteId) => {
      const m = get(assistantId);
      return set(assistantId, {
        ...m,
        notes: m.notes.filter((n) => n.id !== noteId),
      });
    },
    setMemoryOn: async (assistantId, on) =>
      set(assistantId, { ...get(assistantId), on }),
    forgetMessage: async (assistantId, messageId) => {
      const next = (chats.get(assistantId) ?? []).filter(
        (m) => m.id !== messageId,
      );
      chats.set(assistantId, next);
      return next;
    },
    undoForget: async (assistantId) => chats.get(assistantId) ?? [],
    clearChat: async (assistantId) => {
      chats.delete(assistantId);
    },
    // No model here: the summary is a fixed line, so the screens can be worked on.
    summariseChat: async (assistantId) => {
      const all = chats.get(assistantId) ?? [];
      const older = all.filter((m) => !m.summarised).slice(0, -6);
      if (older.length < 4)
        throw new Error(
          "This chat is still short. There is nothing to summarise.",
        );
      const summary: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "This is the browser preview. In the app, the assistant's own model writes the summary here.",
        at: new Date().toISOString(),
        summary: "pending",
      };
      const covered = new Set(older.map((m) => m.id));
      const marked = all.map((m) =>
        covered.has(m.id) ? { ...m, summarised: summary.id } : m,
      );
      const first = marked.findIndex((m) => covered.has(m.id));
      const next = [...marked.slice(0, first), summary, ...marked.slice(first)];
      chats.set(assistantId, next);
      return next;
    },
    keepSummary: async (assistantId, summaryId) => {
      const next = (chats.get(assistantId) ?? [])
        .filter((m) => m.summarised !== summaryId)
        .map((m) =>
          m.id === summaryId ? { ...m, summary: "kept" as const } : m,
        );
      chats.set(assistantId, next);
      return next;
    },
    undoSummary: async (assistantId, summaryId) => {
      const next = (chats.get(assistantId) ?? [])
        .filter((m) => m.id !== summaryId)
        .map((m) => {
          if (m.summarised !== summaryId) return m;
          const { summarised: _gone, ...rest } = m;
          return rest;
        });
      chats.set(assistantId, next);
      return next;
    },
  };
}

/**
 * The page talks to the app through `window.stellarOpen`. In a plain browser
 * (`pnpm dev:ui`) there is no app behind it, so this stand-in keeps a little
 * data in memory. It calls no model, opens nothing and saves nothing: it is
 * for working on the screens only.
 */
function preview(): OpenApi {
  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  const source: ModelSource = {
    id: id(),
    preset: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    wire: "openai",
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
        folders: ["/Users/you/Documents/Notes"],
        web: true,
        sites: ["example.com"],
        connections: [],
        connectionTools: [],
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
        folders: [],
        web: false,
        sites: [],
        connections: [],
        connectionTools: [],
        createdAt: now(),
      },
    ],
    sources: [source],
    connections: [],
    mailAccounts: [],
    settings: {
      onboarded: true,
      theme: "system",
      textSize: "default",
      sendWith: "enter",
      checkUpdates: false,
      defaultSourceId: source.id,
    },
    keychain: true,
    platform: "browser",
    version: "0.0.0",
    dataDir: "/Users/you/Library/Application Support/OpenStellarFirm",
  };
  const chats = new Map<string, ChatMessage[]>();
  const doneListeners = new Set<(done: ChatDone) => void>();
  const progressListeners = new Set<(progress: ComputerProgress) => void>();
  let computerImage = false;
  /** Running stand-in computers and who holds each. */
  const computers = new Map<string, ComputerHold>();
  const computerViewOf = (assistantId: string): ComputerView => ({
    container: computers.has(assistantId) ? "on" : "off",
    hold: computers.get(assistantId) ?? "none",
    exchange: `/Users/you/Library/Application Support/OpenStellarFirm/computers/${assistantId}/exchange`,
  });
  const say = (
    assistantId: string,
    role: ChatMessage["role"],
    text: string,
  ): ChatMessage => {
    const message: ChatMessage = { id: id(), role, text, at: now() };
    chats.set(assistantId, [...(chats.get(assistantId) ?? []), message]);
    return message;
  };
  const change = (
    assistantId: string,
    edit: (a: Assistant) => Assistant,
  ): Assistant => {
    const found = state.assistants.find((a) => a.id === assistantId);
    if (!found) throw new Error("That assistant is no longer here.");
    const next = edit(found);
    state.assistants = state.assistants.map((a) =>
      a.id === assistantId ? next : a,
    );
    return next;
  };
  return {
    getState: async () => structuredClone(state),
    saveAssistant: async (input) => {
      const existing = state.assistants.find((a) => a.id === input.id);
      const { computer, ...rest } = input;
      const next: Assistant = {
        ...existing,
        ...rest,
        id: existing?.id ?? id(),
        folders: existing?.folders ?? [],
        sites: existing?.sites ?? [],
        connections: input.connections ?? existing?.connections ?? [],
        connectionTools: existing?.connectionTools ?? [],
        canAsk: input.canAsk ?? existing?.canAsk ?? [],
        web: input.web ?? existing?.web ?? false,
        createdAt: existing?.createdAt ?? now(),
      };
      if (computer === null) delete next.computer;
      else if (computer) next.computer = computer;
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
    exportBackup: async () => false,
    importBackup: async () => null,
    addFolder: async () => null,
    removeFolder: async (assistantId, folder) =>
      change(assistantId, (a) => ({
        ...a,
        folders: a.folders.filter((f) => f !== folder),
      })),
    removeSite: async (assistantId, site) =>
      change(assistantId, (a) => ({
        ...a,
        sites: a.sites.filter((s) => s !== site),
      })),
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
    pickAttachments: async () => ({ added: [], problems: [] }),
    addAttachment: async () => {
      throw new Error("Open the desktop app to attach files.");
    },
    removeAttachment: async () => {},
    pendingAttachments: async () => [],
    openAttachment: async () => {},
    ...previewLanguages(),
    stop: async () => {},
    pending: async () => null,
    decide: async () => {},
    checkConnection: async () => [
      { name: "search_notes", description: "Search notes.", readOnly: true },
      { name: "create_note", description: "Add a note.", readOnly: false },
    ],
    saveConnection: async (input) => {
      const next: Connection = {
        id: input.id ?? id(),
        name: input.name,
        preset: "custom",
        baseUrl: input.baseUrl,
        hasKey: Boolean(input.apiKey),
        tools: [
          {
            name: "search_notes",
            description: "Search notes.",
            readOnly: true,
          },
          { name: "create_note", description: "Add a note.", readOnly: false },
        ],
        checkedAt: now(),
      };
      state.connections = [
        ...state.connections.filter((c) => c.id !== next.id),
        next,
      ];
      return next;
    },
    checkComposio: async () => [
      {
        name: "COMPOSIO_SEARCH_TOOLS",
        description: "Find tools.",
        readOnly: true,
      },
      {
        name: "COMPOSIO_MULTI_EXECUTE_TOOL",
        description: "Run tools.",
        readOnly: false,
      },
    ],
    saveComposio: async (input) => {
      const next: Connection = {
        id: input.id ?? id(),
        name: input.name,
        preset: "composio",
        baseUrl: "https://connect.composio.dev/mcp",
        hasKey: Boolean(input.apiKey),
        tools: [],
        checkedAt: now(),
      };
      state.connections = [
        ...state.connections.filter((c) => c.id !== next.id),
        next,
      ];
      return next;
    },
    checkCatalog: async () => [
      { name: "search_issues", description: "Search issues.", readOnly: true },
      { name: "create_issue", description: "Make an issue.", readOnly: false },
    ],
    saveCatalog: async (input) => {
      const entry = catalogEntry(input.catalogId);
      const next: Connection = {
        id: input.id ?? id(),
        name: input.name,
        preset: catalogPreset(input.catalogId),
        baseUrl: entry?.url ?? "",
        hasKey: Boolean(input.apiKey),
        tools: [
          {
            name: "search_issues",
            description: "Search issues.",
            readOnly: true,
          },
          {
            name: "create_issue",
            description: "Make an issue.",
            readOnly: false,
          },
        ],
        checkedAt: now(),
      };
      state.connections = [
        ...state.connections.filter((c) => c.id !== next.id),
        next,
      ];
      return next;
    },
    lookupCompany: async (domain) => ({
      domain,
      name: "Example company",
      signIn: true,
      apis: [
        {
          type: "mcp",
          url: `https://mcp.${domain}/mcp`,
          description: "Product search",
        },
      ],
    }),
    removeConnection: async (connectionId) => {
      state.connections = state.connections.filter(
        (c) => c.id !== connectionId,
      );
      state.assistants = state.assistants.map((a) => ({
        ...a,
        connections: a.connections.filter((c) => c !== connectionId),
      }));
    },
    removeConnectionTool: async (assistantId, connectionId, tool) =>
      change(assistantId, (a) => ({
        ...a,
        connectionTools: a.connectionTools.filter(
          (t) => t !== `${connectionId}:${tool}`,
        ),
      })),
    checkMail: async () => ({
      folders: ["INBOX", "Sent", "Drafts", "Archive"],
      more: 0,
    }),
    saveMail: async (input) => {
      const next: MailAccount = {
        id: input.id ?? id(),
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        ownNetwork: input.ownNetwork,
        hasPassword: true,
        checkedAt: now(),
      };
      state.mailAccounts = [
        ...state.mailAccounts.filter((m) => m.id !== next.id),
        next,
      ];
      return next;
    },
    removeMail: async (accountId) => {
      state.mailAccounts = state.mailAccounts.filter((m) => m.id !== accountId);
      state.assistants = state.assistants.map((a) => ({
        ...a,
        mail: (a.mail ?? []).filter((m) => m !== accountId),
        mailReads: (a.mailReads ?? []).filter((m) => m !== accountId),
      }));
    },
    removeMailRead: async (assistantId, accountId) =>
      change(assistantId, (a) => ({
        ...a,
        mailReads: (a.mailReads ?? []).filter((m) => m !== accountId),
      })),
    saveSource: async (input) => {
      const next: ModelSource = {
        id: input.id ?? id(),
        preset: input.preset,
        name: input.name ?? input.preset,
        baseUrl: input.baseUrl ?? presetOf(input.preset).baseUrl,
        wire: presetOf(input.preset).wire,
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
    openCloud: async () => {},
    openLink: async () => {},
    openDataFolder: async () => {},
    clearApprovals: async () => {
      const count = state.assistants.reduce((n, a) => n + a.sites.length, 0);
      state.assistants = state.assistants.map((a) => ({ ...a, sites: [] }));
      return count;
    },
    deleteAllChats: async () => {
      const count = chats.size;
      chats.clear();
      return count;
    },
    ...previewMemory(chats),
    checkNow: async () => {},
    checkForUpdate: async () => ({ status: "current" }),
    dismissUpdate: async () => state.settings,
    searchChats: async (query) =>
      searchChats(
        [...chats].map(([assistantId, messages]) => ({
          assistantId,
          messages,
        })),
        query,
      ),
    exportChat: async () => false,
    copyMessage: async () => {},
    onDelta: () => () => {},
    onDone: (listener) => {
      doneListeners.add(listener);
      return () => doneListeners.delete(listener);
    },
    onActivity: () => () => {},
    onApproval: () => () => {},
    // A stand-in computer: no Docker, only a drawn screen, so the panel can be
    // worked on in a browser.
    computerStatus: async () => ({
      docker: "ready",
      version: "preview",
      image: computerImage,
      building: false,
    }),
    computerSetup: async () => {
      for (const line of ["Downloading the base image", "Adding packages"]) {
        for (const listener of progressListeners)
          listener({ line, state: "running" });
        await new Promise((r) => setTimeout(r, 600));
      }
      computerImage = true;
      for (const listener of progressListeners)
        listener({ line: "Done", state: "done" });
    },
    computerView: async (assistantId) => computerViewOf(assistantId),
    computerStart: async (assistantId) => {
      computers.set(assistantId, "none");
      return computerViewOf(assistantId);
    },
    computerShot: async (assistantId) =>
      computers.has(assistantId)
        ? {
            src: `data:image/svg+xml,${encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="#1d1d23"/><rect x="80" y="80" width="640" height="420" rx="8" fill="#f3efe6"/></svg>',
            )}`,
            at: now(),
          }
        : null,
    computerHold: async (assistantId, hold) => {
      computers.set(assistantId, hold);
      return computerViewOf(assistantId);
    },
    computerInput: async () => {},
    computerStop: async (assistantId) => {
      computers.delete(assistantId);
      return computerViewOf(assistantId);
    },
    computerRemove: async (assistantId) => {
      computers.delete(assistantId);
      return computerViewOf(assistantId);
    },
    computerOpenExchange: async () => {},
    onComputerProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    ...recordPreview(state),
  };
}

export const api: OpenApi = window.stellarOpen ?? preview();
