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
  Notification,
  nativeTheme,
  safeStorage,
  session,
  shell,
} from "electron";
import { presetOf } from "../shared/catalog";
import { checkSettings } from "../shared/checks";
import { cloudCopyUrl, cloudHomeUrl, MAX_LINK_WINDOWS } from "../shared/cloud";
import { checkEndpoint, isLocalEndpoint } from "../shared/endpoint";
import { linkUrl } from "../shared/links";
import { systemPrompt } from "../shared/prompt";
import { type Theme, windowBackground } from "../shared/theme";
import {
  type ApprovalCard,
  type AppState,
  type Assistant,
  type AssistantInput,
  type BackupResult,
  type ChatMessage,
  type ChatStep,
  type ConnectionInput,
  type Decision,
  IPC,
  type IpcResult,
  type LocalModels,
  type ModelSource,
  type ModelSourceInput,
  type PresetId,
  type Settings,
} from "../shared/types";
import { availableUpdate } from "../shared/update";
import { type AgentResult, runAgent } from "./agent";
import {
  backupName,
  buildBackup,
  MAX_BACKUP_BYTES,
  restoreBackup,
} from "./backup";
import {
  CheckScheduler,
  checkMessage,
  GAVE_UP_LINE,
  MAX_CHECK_TURNS,
  scheduleChecks,
  updateNotice,
} from "./checks";
import {
  ConnectionService,
  composioInput,
  connectionInput,
} from "./connections";
import { folderLabels } from "./folders";
import { listModels, ModelError, streamTurn, type WireMessage } from "./models";
import { lookupCompany } from "./poppy";
import { electronScreen } from "./screen-capture";
import { Secrets } from "./secrets";
import type { Seen } from "./seen";
import { Store } from "./store";
import {
  askedMessage,
  buildTeam,
  MAX_ASKED_TURNS,
  type TeamGate,
} from "./team";
import type { Ask } from "./tools";
import { scheduleUpdateChecks, UpdateChecker } from "./update-check";

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
let connections: ConnectionService;
let updates: UpdateChecker;
let checker: CheckScheduler;
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
    connections: connections.list(),
    settings: store.settings(),
    keychain: await secrets.available(),
    platform: process.platform,
    version: app.getVersion(),
    dataDir: store.folder,
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
  ask: Omit<ApprovalCard, "id" | "assistantId"> & {
    /** What an "always allow" would remember; the page is never told which. */
    remember?: unknown;
  },
  signal: AbortSignal,
): Promise<Decision> {
  return new Promise((resolve, reject) => {
    const { remember, ...shown } = ask;
    const card: ApprovalCard = {
      ...shown,
      ...(remember ? { canAlways: true } : {}),
      id: randomUUID(),
      assistantId,
    };
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

/** What one run of an assistant is for, and what it is handed. */
interface RunSpec {
  assistant: Assistant;
  /** "answer" is the person's message, "check" the app's own read-only look, "asked" one question from another assistant. */
  kind: "answer" | "check" | "asked";
  signal: AbortSignal;
  /** What the model is sent after its instructions. */
  history: WireMessage[];
  ask: (ask: Ask) => Promise<Decision>;
  onText: (text: string) => void;
  onActivity: (label: string) => void;
  /** The other assistants an answer may ask. Never given to a check or an asked run. */
  team?: TeamGate | undefined;
  /** The name of the assistant that asks, for an asked run. */
  askedBy?: string;
  /** The flags an asked run starts from and updates. */
  seen?: Seen;
}

/** Runs one assistant on its own model and tools. Saves nothing. */
async function runAssistant(spec: RunSpec): Promise<AgentResult> {
  const { assistant, kind, signal } = spec;
  const sourceId = assistant.sourceId ?? store.settings().defaultSourceId;
  const source = sourceId
    ? store.sources().find((s) => s.id === sourceId)
    : undefined;
  if (!source)
    throw new ModelError("No model is set up yet. Add one in Models.");
  const apiKey = await secrets.get(source.id);
  const mcp = connections.gateFor(assistant, signal);
  // A check never looks at the screen, whatever the assistant is set to.
  const screen = assistant.screen === true && kind !== "check";
  const prompt = systemPrompt({
    ...assistant,
    screen,
    folderLabels: folderLabels(assistant.folders).map((f) => f.label),
    connectionNames: mcp
      ? store
          .connections()
          .filter((c) => assistant.connections.includes(c.id))
          .filter((c) => c.tools.length > 0)
          .map((c) => c.name)
      : [],
    ...(spec.team ? { askable: spec.team.names } : {}),
    ...(spec.askedBy ? { askedBy: spec.askedBy } : {}),
  });
  return runAgent(
    assistant,
    [{ role: "system", content: prompt }, ...spec.history],
    {
      turn: (messages, tools) =>
        streamTurn({
          baseUrl: source.baseUrl,
          wire: source.wire,
          ...(apiKey ? { apiKey } : {}),
          model: assistant.model ?? source.model,
          messages,
          tools,
          signal,
        }),
      modeKey: `${source.id}\n${assistant.model ?? source.model}`,
      ...(mcp ? { mcp } : {}),
      ...(spec.team ? { team: spec.team } : {}),
      ...(spec.seen ? { seen: spec.seen } : {}),
      ...(kind === "check"
        ? { readOnly: true, maxTurns: MAX_CHECK_TURNS }
        : kind === "asked"
          ? { maxTurns: MAX_ASKED_TURNS }
          : {}),
      ask: spec.ask,
      allowSite: (site) => {
        store.addSite(assistant.id, site);
      },
      onText: spec.onText,
      onActivity: spec.onActivity,
      signal,
      ...(screen
        ? {
            screen: electronScreen(
              isLocalEndpoint(source.baseUrl)
                ? "on this computer"
                : source.name,
            ),
          }
        : {}),
    },
  );
}

/**
 * The assistants this one may ask, as a tool. An asked assistant answers in a
 * run of its own: it sees only the question, writes nothing to its own chat,
 * and is never given this tool, so questions never chain.
 */
function teamFor(asker: Assistant): TeamGate | undefined {
  const all = store.assistants();
  const peers = (asker.canAsk ?? []).flatMap((id) => {
    const found = all.find((a) => a.id === id && a.id !== asker.id);
    return found
      ? [{ id: found.id, name: found.name, brief: found.brief }]
      : [];
  });
  return buildTeam(peers, async (peer, question, link) => {
    const result = await runAssistant({
      assistant: store.assistant(peer.id),
      kind: "asked",
      askedBy: asker.name,
      signal: link.signal,
      seen: link.seen,
      history: [{ role: "user", content: askedMessage(asker.name, question) }],
      ask: link.ask,
      onText: () => {},
      onActivity: link.onActivity,
    });
    return { text: result.text, steps: result.steps };
  });
}

/** What the model is shown of a chat: the last 40 messages that worked. */
function chatHistory(assistantId: string): WireMessage[] {
  return store
    .messages(assistantId)
    .filter((m) => !m.failed)
    .slice(-40)
    .map((m) => ({ role: m.role, content: m.text }));
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
    const result = await runAssistant({
      assistant,
      kind: "answer",
      signal: controller.signal,
      history: chatHistory(assistant.id),
      team: teamFor(assistant),
      ask: (ask) => askPerson(window, assistant.id, ask, controller.signal),
      onText: (text) => {
        full += text;
        tell(window, IPC.delta, { assistantId: assistant.id, text });
      },
      onActivity: (label) =>
        tell(window, IPC.activity, { assistantId: assistant.id, label }),
    });
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

/**
 * One check by the main assistant: the app's own message, answered with the
 * assistant's own model, read only. It never asks the person: a step that
 * would need an Approve is left for them. The check and its update are saved
 * together, marked as a check.
 */
async function runCheck(window: BrowserWindow): Promise<"done" | "stopped"> {
  const settings = checkSettings(store.settings());
  const main = settings.mainAssistantId
    ? store.assistant(settings.mainAssistantId)
    : undefined;
  if (!main) throw new Error("Pick the main assistant first.");
  if (running.has(main.id)) throw new Error("It is answering right now.");
  const controller = new AbortController();
  running.set(main.id, controller);
  const startedAt = new Date();
  const request = checkMessage(settings.lookFor, startedAt);
  let full = "";
  let failed = false;
  let steps: ChatStep[] = [];
  let problem: unknown;
  try {
    const result = await runAssistant({
      assistant: main,
      kind: "check",
      signal: controller.signal,
      history: [...chatHistory(main.id), { role: "user", content: request }],
      // A check never waits for a card. This is only a second lock.
      ask: async () => "reject",
      onText: (text) => {
        full += text;
        tell(window, IPC.delta, { assistantId: main.id, text });
      },
      onActivity: (label) =>
        tell(window, IPC.activity, { assistantId: main.id, label }),
    });
    steps = result.steps;
    if (!full) throw new ModelError("The model sent an empty answer.");
  } catch (error) {
    problem = error;
    if (!(controller.signal.aborted && full)) {
      failed = true;
      full =
        error instanceof ModelError
          ? error.message
          : "The check stopped because of an error.";
    }
  } finally {
    running.delete(main.id);
  }
  try {
    const saved = store.appendMessage(
      main.id,
      "user",
      request,
      false,
      [],
      "request",
      startedAt,
    );
    const message = store.appendMessage(
      main.id,
      "assistant",
      full,
      failed,
      steps,
      "update",
    );
    if (!failed) {
      store.markCheckUpdate(main.id);
      if (settings.notify && Notification.isSupported()) {
        const notice = new Notification({ title: updateNotice(main.name) });
        notice.on("click", () => {
          if (window.isDestroyed()) return;
          window.show();
          window.focus();
        });
        notice.show();
      }
    }
    tell(window, IPC.done, {
      assistantId: main.id,
      message,
      request: saved,
    });
  } catch {
    // The assistant was removed while it was checking: nothing to keep.
  }
  if (controller.signal.aborted) return "stopped";
  if (failed) throw problem ?? new Error("The check did not work.");
  return "done";
}

/** Says in the main assistant's chat that checking is off, and why. */
function giveUpChecks(window: BrowserWindow): void {
  const id = store.settings().mainAssistantId;
  store.stopChecks();
  if (!id) return;
  try {
    const message = store.appendMessage(
      id,
      "assistant",
      GAVE_UP_LINE,
      true,
      [],
      "update",
    );
    tell(window, IPC.done, { assistantId: id, message });
  } catch {
    // The assistant is gone: nothing to say it in.
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

/** Both backup dialogs are opened here: the page never names a file. */
async function exportBackup(
  window: BrowserWindow,
  includeChats: unknown,
): Promise<boolean> {
  if (typeof includeChats !== "boolean")
    throw new Error("That is not allowed.");
  const picked = await dialog.showSaveDialog(window, {
    defaultPath: backupName(),
    filters: [{ name: "Backup file", extensions: ["json"] }],
  });
  if (picked.canceled || !picked.filePath) return false;
  writeFileSync(
    picked.filePath,
    JSON.stringify(buildBackup(store, includeChats), null, 2),
    { mode: 0o600 },
  );
  return true;
}

async function importBackup(
  window: BrowserWindow,
): Promise<BackupResult | null> {
  const picked = await dialog.showOpenDialog(window, {
    properties: ["openFile"],
    filters: [{ name: "Backup file", extensions: ["json"] }],
  });
  const path = picked.filePaths[0];
  if (picked.canceled || !path) return null;
  if (statSync(path).size > MAX_BACKUP_BYTES)
    throw new Error("That file is too large to be a backup.");
  return restoreBackup(store, readFileSync(path, "utf8"));
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

/**
 * Opens one of the app's fixed links. The page sends a name; the address is
 * built here, and the release link only while a newer version is known.
 */
function openLink(name: unknown): Promise<void> {
  const newest = availableUpdate(store.settings(), app.getVersion());
  return shell.openExternal(linkUrl(name, newest));
}

/** The app's own data folder, opened by the system. The page names no path. */
async function openDataFolder(): Promise<void> {
  const problem = await shell.openPath(store.folder);
  if (problem) throw new Error("The folder could not be opened.");
}

function deleteAllChats(): number {
  // An answer that is still being written would save itself after the delete.
  if (running.size > 0)
    throw new Error("An assistant is still answering. Stop it first, or wait.");
  return store.deleteAllChats();
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
  handle(IPC.exportBackup, (_e, includeChats: unknown) =>
    exportBackup(window, includeChats),
  );
  handle(IPC.importBackup, () => importBackup(window));
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
  handle(IPC.checkConnection, (_e, input: ConnectionInput) =>
    connections.check(connectionInput(input)),
  );
  handle(IPC.saveConnection, (_e, input: ConnectionInput) =>
    connections.save(connectionInput(input)),
  );
  handle(IPC.checkComposio, (_e, input: unknown) =>
    connections.checkComposio(composioInput(input)),
  );
  handle(IPC.saveComposio, (_e, input: unknown) =>
    connections.saveComposio(composioInput(input)),
  );
  handle(IPC.lookupCompany, (_e, domain: unknown) => lookupCompany(domain));
  handle(IPC.removeConnection, (_e, id: unknown) => {
    connections.remove(str(id));
  });
  handle(
    IPC.removeConnectionTool,
    (_e, id: unknown, connectionId: unknown, tool: unknown) =>
      store.removeAllowedTool(str(id), str(connectionId), str(tool, 200)),
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
  handle(IPC.setSettings, (_e, patch: Partial<Settings>) => {
    const next = store.setSettings(patch);
    applyTheme(next.theme);
    return next;
  });
  handle(IPC.openCloud, (_e, target: unknown, assistantId: unknown) =>
    openCloud(target, assistantId),
  );
  handle(IPC.openLink, (_e, name: unknown) => openLink(name));
  handle(IPC.openDataFolder, () => openDataFolder());
  handle(IPC.clearApprovals, () => store.clearApprovals());
  handle(IPC.deleteAllChats, () => deleteAllChats());
  handle(
    IPC.checkForUpdate,
    async () => (await updates.check(true)) ?? { status: "unknown" },
  );
  handle(IPC.dismissUpdate, () => store.dismissUpdate());
  handle(IPC.checkNow, () => checker.start());
}

/**
 * The page styles itself with the system's light or dark setting, so the
 * choice is made here: Electron answers the page's own question with it.
 */
function applyTheme(theme: Theme): void {
  nativeTheme.themeSource = theme;
  paintWindows();
}

function paintWindows(): void {
  const color = windowBackground(nativeTheme.shouldUseDarkColors);
  for (const window of BrowserWindow.getAllWindows())
    window.setBackgroundColor(color);
}

const windowIcon = join(__dirname, "../icon.png");

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    icon: windowIcon,
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
  connections = new ConnectionService({
    store,
    secrets,
    appVersion: app.getVersion(),
  });
  updates = new UpdateChecker({
    fetch,
    now: () => new Date(),
    version: app.getVersion(),
    settings: () => store.settings(),
    record: (at, newest) => {
      store.recordUpdateCheck(at, newest);
    },
  });
  scheduleUpdateChecks(updates);
  // The page asks for no camera, microphone or location, so every ask is refused.
  applyTheme(store.settings().theme);
  nativeTheme.on("updated", paintWindows);
  if (process.platform === "darwin") app.dock?.setIcon(windowIcon);
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, done) => done(false),
  );
  const window = createWindow();
  register(window);
  checker = new CheckScheduler({
    now: () => new Date(),
    startedAt: new Date(),
    settings: () => checkSettings(store.settings()),
    busy: () => {
      const main = store.settings().mainAssistantId;
      return (main !== undefined && running.has(main)) || waiting.size > 0;
    },
    load: () => store.checkCounters(),
    save: (counters) => store.saveCheckCounters(counters),
    run: () => runCheck(window),
    giveUp: () => giveUpChecks(window),
  });
  scheduleChecks(checker);
});

app.on("window-all-closed", () => {
  app.quit();
});
