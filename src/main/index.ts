import { randomUUID } from "node:crypto";
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
import { cloudCopyUrl, cloudHomeUrl, MAX_LINK_WINDOWS } from "../shared/cloud";
import { checkEndpoint, isLocalEndpoint } from "../shared/endpoint";
import { systemPrompt } from "../shared/prompt";
import {
  type ApprovalCard,
  type AppState,
  type Assistant,
  type AssistantInput,
  type ChatMessage,
  type ChatStep,
  type Decision,
  IPC,
  type IpcResult,
  type LocalModels,
  type ModelSource,
  type ModelSourceInput,
  type PresetId,
  type Settings,
} from "../shared/types";
import { runAgent } from "./agent";
import { folderLabels } from "./folders";
import { listModels, ModelError, streamTurn, type WireMessage } from "./models";
import { Secrets } from "./secrets";
import { Store } from "./store";

const pageUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
// The dev server exists only when the app runs from source, and only on this
// computer. An installed app ignores the variable, so nothing outside it can
// point its window (and the bridge behind it) at another page.
const devUrl =
  !app.isPackaged &&
  process.env.STELLARFIRM_OPEN_DEV_URL?.startsWith("http://localhost:")
    ? process.env.STELLARFIRM_OPEN_DEV_URL
    : undefined;

/** A value from the page is used only when it is a plain, short piece of text. */
function str(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max) {
    throw new Error("That is not allowed.");
  }
  return value;
}

let store: Store;
let secrets: Secrets;
const running = new Map<string, AbortController>();
/** The step that waits for the person, by assistant. One at a time each. */
const waiting = new Map<
  string,
  { card: ApprovalCard; settle(decision: Decision): void }
>();

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

function tell(window: BrowserWindow, channel: string, payload: unknown): void {
  if (!window.isDestroyed()) window.webContents.send(channel, payload);
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

/**
 * Shows a step to the person and waits for their own decision. Nothing in the
 * app answers for them: the only ways out are their click, or Stop.
 */
function askPerson(
  window: BrowserWindow,
  assistantId: string,
  ask: Omit<ApprovalCard, "id" | "assistantId">,
  signal: AbortSignal,
): Promise<Decision> {
  return new Promise((resolve, reject) => {
    const card: ApprovalCard = { ...ask, id: randomUUID(), assistantId };
    const done = () => {
      waiting.delete(assistantId);
      signal.removeEventListener("abort", stopped);
      tell(window, IPC.approval, { assistantId, card: null });
    };
    const stopped = () => {
      done();
      reject(new ModelError("Stopped."));
    };
    signal.addEventListener("abort", stopped, { once: true });
    waiting.set(assistantId, {
      card,
      settle: (decision) => {
        done();
        resolve(decision);
      },
    });
    tell(window, IPC.approval, { assistantId, card });
  });
}

async function answer(
  window: BrowserWindow,
  assistant: Assistant,
): Promise<void> {
  const controller = new AbortController();
  running.set(assistant.id, controller);
  let full = "";
  let failed = false;
  let steps: ChatStep[] = [];
  try {
    const sourceId = assistant.sourceId ?? store.settings().defaultSourceId;
    const source = sourceId
      ? store.sources().find((s) => s.id === sourceId)
      : undefined;
    if (!source)
      throw new ModelError("No model is set up yet. Add one in Models.");
    const history: WireMessage[] = store
      .messages(assistant.id)
      .filter((m) => !m.failed)
      .slice(-40)
      .map((m) => ({ role: m.role, content: m.text }));
    const apiKey = await secrets.get(source.id);
    const prompt = systemPrompt({
      ...assistant,
      folderLabels: folderLabels(assistant.folders).map((f) => f.label),
    });
    const result = await runAgent(
      assistant,
      [{ role: "system", content: prompt }, ...history],
      {
        turn: (messages, tools) =>
          streamTurn({
            baseUrl: source.baseUrl,
            wire: source.wire,
            ...(apiKey ? { apiKey } : {}),
            model: assistant.model ?? source.model,
            messages,
            tools,
            signal: controller.signal,
          }),
        ask: (ask) => askPerson(window, assistant.id, ask, controller.signal),
        allowSite: (site) => {
          store.addSite(assistant.id, site);
        },
        onText: (text) => {
          full += text;
          tell(window, IPC.delta, { assistantId: assistant.id, text });
        },
        onActivity: (label) =>
          tell(window, IPC.activity, { assistantId: assistant.id, label }),
        signal: controller.signal,
      },
    );
    steps = result.steps;
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
      steps,
    );
    tell(window, IPC.done, { assistantId: assistant.id, message });
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

/** Only the system's own picker, opened here, can give an assistant a folder. */
async function addFolder(
  window: BrowserWindow,
  id: string,
): Promise<Assistant | null> {
  store.assistant(id);
  const picked = await dialog.showOpenDialog(window, {
    title: "Pick a folder this assistant may use",
    properties: ["openDirectory", "createDirectory"],
  });
  const folder = picked.filePaths[0];
  if (picked.canceled || !folder) return null;
  return store.addFolder(id, folder);
}

/** Opens StellarFirm in the person's browser. The address is built here. */
async function openCloud(target: unknown, assistantId: unknown): Promise<void> {
  if (target === "home") return shell.openExternal(cloudHomeUrl());
  if (target === "copy" && typeof assistantId === "string") {
    const file = store.exportFile(assistantId);
    return shell.openExternal(
      process.platform === "win32"
        ? cloudCopyUrl(file, MAX_LINK_WINDOWS)
        : cloudCopyUrl(file),
    );
  }
  throw new Error("That is not allowed.");
}

function register(window: BrowserWindow): void {
  handle(IPC.getState, () => state());
  handle(IPC.saveAssistant, (_e, input: AssistantInput) =>
    store.saveAssistant(input),
  );
  handle(IPC.removeAssistant, (_e, id: unknown) => {
    running.get(str(id))?.abort();
    store.removeAssistant(str(id));
  });
  handle(IPC.exportAssistant, (_e, id: unknown) =>
    exportAssistant(window, str(id)),
  );
  handle(IPC.importAssistant, () => importAssistant(window));
  handle(IPC.addFolder, (_e, id: unknown) => addFolder(window, str(id)));
  handle(IPC.removeFolder, (_e, id: unknown, folder: unknown) =>
    store.removeFolder(str(id), str(folder)),
  );
  handle(IPC.removeSite, (_e, id: unknown, site: unknown) =>
    store.removeSite(str(id), str(site)),
  );
  handle(IPC.messages, (_e, id: unknown) => store.messages(str(id)));
  handle(IPC.send, (_e, id: unknown, text: unknown) =>
    send(window, str(id), str(text, 100_000)),
  );
  handle(IPC.stop, (_e, id: unknown) => {
    running.get(str(id))?.abort();
  });
  handle(IPC.pending, (_e, id: unknown) => waiting.get(str(id))?.card ?? null);
  handle(
    IPC.decide,
    (_e, id: string, approvalId: string, decision: Decision) => {
      const entry = waiting.get(id);
      // A click on a card that is no longer the waiting one decides nothing.
      if (!entry || entry.card.id !== approvalId) {
        throw new Error("That step is no longer waiting.");
      }
      if (
        decision !== "approve" &&
        decision !== "always" &&
        decision !== "reject"
      ) {
        throw new Error("That is not allowed.");
      }
      entry.settle(decision);
    },
  );
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
        wire: presetOf(input.preset).wire,
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
      wire: source.wire,
      ...(key ? { apiKey: key } : {}),
    });
  });
  handle(IPC.detectLocal, () => detectLocal());
  handle(IPC.setSettings, (_e, patch: Partial<Settings>) =>
    store.setSettings(patch),
  );
  handle(IPC.openCloud, (_e, target: unknown, assistantId: unknown) =>
    openCloud(target, assistantId),
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
  // The window shows only the app's own page: no new window, no other page,
  // no embedded page. The only links that open are the fixed ones to
  // StellarFirm, which the main process builds itself.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

// An installed app is never driven from outside: a debugging port would let
// another program on this computer press Approve for the person.
if (app.isPackaged && app.commandLine.hasSwitch("remote-debugging-port")) {
  app.quit();
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
