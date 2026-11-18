import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  safeStorage,
  session,
  shell,
} from "electron";
import { presetOf } from "../shared/catalog";
import { checkEndpoint, isLocalEndpoint } from "../shared/endpoint";
import { systemPrompt } from "../shared/prompt";
import {
  type AppState,
  type Assistant,
  type AssistantInput,
  type ChatMessage,
  IPC,
  type IpcResult,
  type LocalModels,
  type ModelSource,
  type ModelSourceInput,
  type PresetId,
  type Settings,
} from "../shared/types";
import { listModels, ModelError, streamChat } from "./models";
import { Secrets } from "./secrets";
import { Store } from "./store";

const pageUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
// The dev server is this computer's only: any other address is ignored.
const devUrl = process.env.STELLARFIRM_OPEN_DEV_URL?.startsWith(
  "http://localhost:",
)
  ? process.env.STELLARFIRM_OPEN_DEV_URL
  : undefined;

let store: Store;
let secrets: Secrets;
const running = new Map<string, AbortController>();

function isAppUrl(url: string): boolean {
  return url === pageUrl || (devUrl !== undefined && url.startsWith(devUrl));
}

/** Registers a call from the page. Only the app's own page may make one. */
function handle<T>(
  channel: string,
  run: (event: IpcMainInvokeEvent, ...args: never[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
    try {
      if (!isAppUrl(event.senderFrame?.url ?? ""))
        throw new Error("That is not allowed.");
      return { ok: true, value: await run(event, ...(args as never[])) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Something went wrong.",
      };
    }
  });
}

function withKey(source: Omit<ModelSource, "hasKey">): ModelSource {
  return { ...source, hasKey: secrets.has(source.id) };
}

async function state(): Promise<AppState> {
  return {
    assistants: store.assistants(),
    sources: store.sources().map(withKey),
    settings: store.settings(),
    keychain: await secrets.available(),
    platform: process.platform,
  };
}

async function saveSource(input: ModelSourceInput): Promise<ModelSource> {
  const preset = presetOf(input.preset);
  const key = input.apiKey?.trim();
  const before = input.id
    ? store.sources().find((s) => s.id === input.id)
    : undefined;
  const needsKey = !preset.local && preset.id !== "custom";
  if (needsKey && !key && !(before && secrets.has(before.id))) {
    throw new Error(`Paste your ${preset.name} key.`);
  }
  const saved = store.saveSource(input);
  try {
    // A saved key only ever goes to the address it was saved with.
    if (before && before.baseUrl !== saved.baseUrl && !key)
      secrets.remove(saved.id);
    if (key) await secrets.set(saved.id, key);
  } catch (error) {
    if (!before) store.removeSource(saved.id);
    throw error;
  }
  return withKey(saved);
}

function probeAddress(input: { preset: PresetId; baseUrl?: string }): string {
  const preset = presetOf(input.preset);
  return checkEndpoint(
    preset.id === "custom" ? (input.baseUrl ?? "") : preset.baseUrl,
  );
}

async function detectLocal(): Promise<LocalModels> {
  const look = (preset: PresetId) =>
    listModels({ baseUrl: presetOf(preset).baseUrl, timeoutMs: 1200 }).catch(
      () => null,
    );
  const [ollama, lmstudio] = await Promise.all([
    look("ollama"),
    look("lmstudio"),
  ]);
  return { ollama, lmstudio };
}

function send(
  window: BrowserWindow,
  assistantId: string,
  text: string,
): ChatMessage {
  const body = typeof text === "string" ? text.trim().slice(0, 20_000) : "";
  if (!body) throw new Error("Type a message first.");
  if (running.has(assistantId))
    throw new Error("It is still answering. Stop it first, or wait.");
  const assistant = store.assistant(assistantId);
  const message = store.appendMessage(assistantId, "user", body);
  void answer(window, assistant);
  return message;
}

async function answer(
  window: BrowserWindow,
  assistant: Assistant,
): Promise<void> {
  const controller = new AbortController();
  running.set(assistant.id, controller);
  let full = "";
  let failed = false;
  try {
    const sourceId = assistant.sourceId ?? store.settings().defaultSourceId;
    const source = sourceId
      ? store.sources().find((s) => s.id === sourceId)
      : undefined;
    if (!source)
      throw new ModelError("No model is set up yet. Add one in Models.");
    const history = store
      .messages(assistant.id)
      .filter((m) => !m.failed)
      .slice(-40)
      .map((m) => ({ role: m.role, content: m.text }));
    const apiKey = await secrets.get(source.id);
    for await (const piece of streamChat({
      baseUrl: source.baseUrl,
      ...(apiKey ? { apiKey } : {}),
      model: assistant.model ?? source.model,
      messages: [
        { role: "system", content: systemPrompt(assistant) },
        ...history,
      ],
      signal: controller.signal,
    })) {
      full += piece;
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.delta, {
          assistantId: assistant.id,
          text: piece,
        });
      }
    }
    if (!full) throw new ModelError("The model sent an empty answer.");
  } catch (error) {
    // A stop keeps what was already written. Anything else says why it failed.
    if (!(controller.signal.aborted && full)) {
      failed = true;
      full =
        error instanceof ModelError
          ? error.message
          : "The answer stopped because of an error.";
    }
  } finally {
    running.delete(assistant.id);
  }
  try {
    const message = store.appendMessage(
      assistant.id,
      "assistant",
      full,
      failed,
    );
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.done, { assistantId: assistant.id, message });
    }
  } catch {
    // The assistant was removed while it was answering: nothing to keep.
  }
}

async function exportAssistant(
  window: BrowserWindow,
  id: string,
): Promise<boolean> {
  const file = store.exportFile(id);
  const picked = await dialog.showSaveDialog(window, {
    defaultPath: `${file.name.replace(/[^\w -]+/g, "").trim() || "assistant"}.assistant.json`,
    filters: [{ name: "Assistant file", extensions: ["json"] }],
  });
  if (picked.canceled || !picked.filePath) return false;
  writeFileSync(picked.filePath, JSON.stringify(file, null, 2));
  return true;
}

async function importAssistant(
  window: BrowserWindow,
): Promise<Assistant | null> {
  const picked = await dialog.showOpenDialog(window, {
    properties: ["openFile"],
    filters: [{ name: "Assistant file", extensions: ["json"] }],
  });
  const path = picked.filePaths[0];
  if (picked.canceled || !path) return null;
  if (statSync(path).size > 64 * 1024)
    throw new Error("That file is too large to be an assistant file.");
  return store.importFile(readFileSync(path, "utf8"));
}

function register(window: BrowserWindow): void {
  handle(IPC.getState, () => state());
  handle(IPC.saveAssistant, (_e, input: AssistantInput) =>
    store.saveAssistant(input),
  );
  handle(IPC.removeAssistant, (_e, id: string) => {
    running.get(id)?.abort();
    store.removeAssistant(id);
  });
  handle(IPC.exportAssistant, (_e, id: string) => exportAssistant(window, id));
  handle(IPC.importAssistant, () => importAssistant(window));
  handle(IPC.messages, (_e, id: string) => store.messages(id));
  handle(IPC.send, (_e, id: string, text: string) => send(window, id, text));
  handle(IPC.stop, (_e, id: string) => {
    running.get(id)?.abort();
  });
  handle(IPC.saveSource, (_e, input: ModelSourceInput) => saveSource(input));
  handle(IPC.removeSource, (_e, id: string) => {
    store.removeSource(id);
    secrets.remove(id);
  });
  handle(
    IPC.probeModels,
    (_e, input: { preset: PresetId; baseUrl?: string; apiKey?: string }) => {
      const key = input.apiKey?.trim();
      return listModels({
        baseUrl: probeAddress(input),
        ...(key ? { apiKey: key } : {}),
      });
    },
  );
  handle(IPC.checkSource, async (_e, id: string) => {
    const source = store.source(id);
    const key = await secrets.get(id);
    if (
      !key &&
      !isLocalEndpoint(source.baseUrl) &&
      source.preset !== "custom"
    ) {
      throw new Error("This source has no key saved. Add it again.");
    }
    return listModels({
      baseUrl: source.baseUrl,
      ...(key ? { apiKey: key } : {}),
    });
  });
  handle(IPC.detectLocal, () => detectLocal());
  handle(IPC.setSettings, (_e, patch: Partial<Settings>) =>
    store.setSettings(patch),
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: "#070709",
    title: "StellarFirm Open",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  // The window shows only the app's own page. A link opens in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

app.whenReady().then(() => {
  const dir = app.getPath("userData");
  store = new Store(dir);
  secrets = new Secrets(join(dir, "keys.json"), {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    seal: (plain) => safeStorage.encryptStringAsync(plain),
    open: async (sealed) => {
      const opened = await safeStorage.decryptStringAsync(sealed);
      return { plain: opened.result, stale: opened.shouldReEncrypt };
    },
  });
  // The page asks for no camera, microphone or location, so every ask is refused.
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, done) => done(false),
  );
  register(createWindow());
});

app.on("window-all-closed", () => {
  app.quit();
});
