import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  Notification,
  nativeTheme,
  safeStorage,
  session,
  shell,
} from "electron";
import { resolveAddress } from "../shared/address";
import { headerOf, presetOf } from "../shared/catalog";
import { checkSettings } from "../shared/checks";
import { cloudCopyUrl, cloudHomeUrl, MAX_LINK_WINDOWS } from "../shared/cloud";
import { sentMessages } from "../shared/context";
import { isLocalEndpoint } from "../shared/endpoint";
import { linkUrl } from "../shared/links";
import { codeBlocksOf, linksOf, plainText, safeHref } from "../shared/markdown";
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
  type ModelInfo,
  type ModelPick,
  type ModelSource,
  type ModelSourceInput,
  type PendingAttachment,
  type PickedAttachments,
  PRESET_IDS,
  type PresetId,
  type Settings,
} from "../shared/types";
import { availableUpdate } from "../shared/update";
import { cardText } from "../shared/visible-text";
import { type AgentDeps, type AgentResult, runAgent } from "./agent";
import { menuTemplate, refusedLaunch } from "./app-menu";
import {
  type FileReaders,
  filesToText,
  historyText,
  messageWithFiles,
} from "./attach-send";
import {
  Attachments,
  attachmentIds,
  pageBytes,
  sweepFiles,
} from "./attachments";
import {
  backupName,
  buildBackup,
  MAX_BACKUP_BYTES,
  restoreBackup,
} from "./backup";
import {
  applySummary,
  forgetMessage,
  keepSummary,
  planSummary,
  restoreMessage,
  undoSummary,
  writeSummary,
} from "./chat-context";
import {
  CheckScheduler,
  checkMessage,
  GAVE_UP_LINE,
  MAX_CHECK_TURNS,
  scheduleChecks,
  updateNotice,
} from "./checks";
import { createComputers, registerComputer } from "./computer/ipc";
import type { ComputerService } from "./computer/service";
import { computerGate, MAX_COMPUTER_TURNS } from "./computer/tools";
import {
  ConnectionService,
  catalogInput,
  composioInput,
  connectionInput,
} from "./connections";
import { chatFileName, chatMarkdown, withExtension } from "./export";
import { ATTACH_LIMITS, AttachError, sniff } from "./file-kind";
import { cannotRead, rememberCannotRead } from "./file-modes";
import { folderLabels } from "./folders";
import { MailService, mailInput } from "./mail";
import { MemoryStore, rememberGate } from "./memory";
import { describeLocalModels } from "./model-pick";
import {
  listModelInfo,
  ModelError,
  streamTurn,
  type WireMessage,
} from "./models";
import { OcrLanguages } from "./ocr-languages";
import { modelPicture, previewOf } from "./picture";
import { lookupCompany } from "./poppy";
import { Reader, ReaderError, registerReaderScheme } from "./reader";
import { type DraftModel, registerRecording } from "./recording/service";
import { electronScreen } from "./screen-capture";
import { searchQuery, searchStore } from "./search";
import { keychainUsable, Secrets } from "./secrets";
import { newSeen, type Seen } from "./seen";
import { modelsOf } from "./source-models";
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

/** What the page may send to list a source's models before it is saved. */
function probeInput(value: unknown): {
  preset: PresetId;
  baseUrl?: string;
  part?: string;
  apiKey?: string;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("That is not allowed.");
  }
  const v = value as Record<string, unknown>;
  const preset = str(v.preset, 40);
  if (!(PRESET_IDS as readonly string[]).includes(preset)) {
    throw new Error("That model source is not known.");
  }
  const optional = (field: unknown, max: number) =>
    field === undefined ? undefined : str(field, max);
  return {
    preset: preset as PresetId,
    baseUrl: optional(v.baseUrl, 2048),
    part: optional(v.part, 300),
    apiKey: optional(v.apiKey, 8192),
  };
}

let store: Store;
let secrets: Secrets;
let connections: ConnectionService;
let mail: MailService;
let memory: MemoryStore;
/** The newest message forgotten in each chat, so Undo can put it back. */
const forgotten = new Map<string, { message: ChatMessage; index: number }>();
let updates: UpdateChecker;
let checker: CheckScheduler;
let attachments: Attachments;
let reader: Reader;
let languages: OcrLanguages;
let computers: ComputerService;
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
    mailAccounts: mail.list(),
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
  if (preset.needsKey && !key && !(before && secrets.has(before.id))) {
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

async function detectLocal(): Promise<LocalModels> {
  const look = async (preset: "ollama" | "lmstudio") => {
    const baseUrl = presetOf(preset).baseUrl;
    let models: ModelInfo[];
    try {
      models = await listModelInfo({ baseUrl, timeoutMs: 1200 });
    } catch {
      return null;
    }
    return models.length > 0
      ? describeLocalModels(preset, baseUrl, models)
      : { models, pick: undefined as ModelPick | undefined };
  };
  const [ollama, lmstudio] = await Promise.all([
    look("ollama"),
    look("lmstudio"),
  ]);
  const names = (found: { models: ModelInfo[] } | null) =>
    found ? found.models.map((m) => m.id) : null;
  return {
    ollama: names(ollama),
    lmstudio: names(lmstudio),
    picks: {
      ...(ollama?.pick ? { ollama: ollama.pick } : {}),
      ...(lmstudio?.pick ? { lmstudio: lmstudio.pick } : {}),
    },
    details: {
      ...(ollama ? { ollama: ollama.models } : {}),
      ...(lmstudio ? { lmstudio: lmstudio.models } : {}),
    },
  };
}

function tell(window: BrowserWindow, channel: string, payload: unknown): void {
  if (!window.isDestroyed()) window.webContents.send(channel, payload);
}

function send(
  window: BrowserWindow,
  assistantId: string,
  text: string,
  ids: string[],
): ChatMessage {
  const body = typeof text === "string" ? text.trim().slice(0, 20_000) : "";
  if (!body && ids.length === 0) throw new Error("Type a message first.");
  if (running.has(assistantId))
    throw new Error("It is still answering. Stop it first, or wait.");
  const assistant = store.assistant(assistantId);
  const refs = attachments.commit(assistantId, ids);
  const message = store.appendMessage(
    assistantId,
    "user",
    body,
    false,
    [],
    undefined,
    new Date(),
    refs,
  );
  void answer(window, assistant);
  return message;
}

/** Every language the reader knows, for one job. */
function readerLangs(): string[] {
  return languages.installed();
}

/** How the files of a message are read and encoded, all on this computer. */
const fileReaders: FileReaders = {
  pdfText: (bytes) =>
    reader.pdfText(bytes, ATTACH_LIMITS.ocrPages, readerLangs()),
  ocr: (bytes, mediaType) => reader.ocr(bytes, mediaType, readerLangs()),
  picture: (file) =>
    modelPicture(file, (bytes, mediaType) => reader.toPng(bytes, mediaType)),
};

/** Checks a file and puts it in the assistant's message box. */
function addAttachment(
  assistantId: string,
  name: unknown,
  bytes: unknown,
): Promise<PendingAttachment> {
  const checked = pageBytes(bytes);
  store.assistant(assistantId);
  return attachments.add(assistantId, str(name, 1024), checked);
}

/** Only the system's own file picker, opened here, names a file on disk. */
async function pickAttachments(
  window: BrowserWindow,
  assistantId: string,
): Promise<PickedAttachments> {
  store.assistant(assistantId);
  const picked = await dialog.showOpenDialog(window, {
    title: "Attach files",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Pictures, PDFs and text",
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
          "pdf",
          "txt",
          "md",
          "csv",
          "json",
        ],
      },
    ],
  });
  const result: PickedAttachments = { added: [], problems: [] };
  if (picked.canceled) return result;
  for (const path of picked.filePaths.slice(0, ATTACH_LIMITS.files)) {
    const name = basename(path);
    try {
      const info = statSync(path);
      if (!info.isFile()) throw new AttachError("That is not a file.");
      if (info.size > ATTACH_LIMITS.fileBytes)
        throw new AttachError(
          "That file is too large. Attach one of at most 20 MB.",
        );
      const bytes = new Uint8Array(readFileSync(path));
      result.added.push(await attachments.add(assistantId, name, bytes));
    } catch (error) {
      result.problems.push(`${name}: ${attachLine(error)}`);
    }
  }
  if (picked.filePaths.length > ATTACH_LIMITS.files)
    result.problems.push(
      `A message can carry up to ${ATTACH_LIMITS.files} files, so the rest were left out.`,
    );
  return result;
}

function attachLine(error: unknown): string {
  return error instanceof AttachError || error instanceof ReaderError
    ? error.message
    : "That file could not be added.";
}

/** Opens a sent file with the system's own app, by id, on the person's click. */
async function openAttachment(assistantId: string, id: string): Promise<void> {
  const file = attachments.fileOf(assistantId, id);
  if (!file) throw new Error("That file is no longer here.");
  const problem = await shell.openPath(file);
  if (problem) throw new Error("The file could not be opened.");
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
      ...cardText(shown),
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
  /** The files on the person's message, for the fallback to text. */
  files?: AgentDeps["files"];
  /** True when the person's message carries files. */
  attachments?: boolean;
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
  const mailGate = mail.gateFor(assistant, signal);
  // A check never looks at the screen, whatever the assistant is set to.
  const screen = assistant.screen === true && kind !== "check";
  // Notes are the person's: an assistant that is asked a question by another
  // gets none, and only an answer to the person may save one.
  const notes = kind === "asked" ? undefined : memoryOf(assistant.id);
  const remember = kind === "answer" && notes?.on === true;
  // Its own computer is used only in an answer to the person: never by a
  // check, which only reads, nor when another assistant asks it a question.
  // Its tools are there only where Docker runs and the computers are set
  // up; this asks Docker nothing when it is not on this computer, and starts
  // nothing.
  const readiness =
    kind === "answer" && assistant.computer
      ? await computers.readinessNow()
      : undefined;
  const computer = readiness === "ready" ? assistant.computer : undefined;
  const computerTools = computer
    ? computerGate(assistant, computers)
    : undefined;
  const prompt = systemPrompt({
    ...assistant,
    screen,
    computer,
    ...(readiness && readiness !== "ready" ? { computerNote: readiness } : {}),
    folderLabels: folderLabels(assistant.folders).map((f) => f.label),
    connectionNames: mcp
      ? store
          .connections()
          .filter((c) => assistant.connections.includes(c.id))
          .filter((c) => c.tools.length > 0)
          .map((c) => c.name)
      : [],
    mailNames: mailGate
      ? store
          .mailAccounts()
          .filter((m) => (assistant.mail ?? []).includes(m.id))
          .map((m) => m.name)
      : [],
    ...(spec.team ? { askable: spec.team.names } : {}),
    ...(spec.askedBy ? { askedBy: spec.askedBy } : {}),
    ...(notes?.on ? { notes: notes.notes.map((n) => n.text) } : {}),
    ...(remember ? { canRemember: true } : {}),
    ...(spec.attachments ? { attachments: true } : {}),
    ownSkills: store.ownSkills(),
  });
  // While the answer runs, its computer is in use: never stopped to make
  // room for another or for being idle.
  const release = computerTools ? computers.lease(assistant.id) : undefined;
  const runAgentFor = (): Promise<AgentResult> =>
    runAgent(
      assistant,
      [{ role: "system", content: prompt }, ...spec.history],
      {
        turn: (messages, tools) =>
          streamTurn({
            baseUrl: source.baseUrl,
            wire: source.wire,
            auth: headerOf(source.preset),
            ...(apiKey ? { apiKey } : {}),
            model: assistant.model ?? source.model,
            messages,
            tools,
            signal,
          }),
        modeKey: `${source.id}\n${assistant.model ?? source.model}`,
        ...(mcp ? { mcp } : {}),
        ...(mailGate ? { mail: mailGate } : {}),
        ...(computerTools ? { computer: computerTools } : {}),
        ...(spec.team ? { team: spec.team } : {}),
        ...(remember ? { memory: rememberGate(memory, assistant.id) } : {}),
        ...(spec.seen ? { seen: spec.seen } : {}),
        ...(spec.files ? { files: spec.files } : {}),
        ...(kind === "check"
          ? { readOnly: true, maxTurns: MAX_CHECK_TURNS }
          : kind === "asked"
            ? { maxTurns: MAX_ASKED_TURNS }
            : computerTools
              ? { maxTurns: MAX_COMPUTER_TURNS }
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
  try {
    return await runAgentFor();
  } finally {
    release?.();
  }
}

/**
 * The model a recording's draft goes to: the assistant's own, as an answer
 * would use it, or another saved source the person picked after a model could
 * not read the pictures. Never a silent fallback to another model.
 */
async function draftModel(
  assistantId: string,
  pickedSourceId?: string,
): Promise<DraftModel> {
  const assistant = store.assistant(assistantId);
  const sourceId =
    pickedSourceId ?? assistant.sourceId ?? store.settings().defaultSourceId;
  const source = sourceId
    ? store.sources().find((s) => s.id === sourceId)
    : undefined;
  if (!source) throw new Error("No model is set up yet. Add one in Models.");
  const apiKey = await secrets.get(source.id);
  const model =
    pickedSourceId === undefined
      ? (assistant.model ?? source.model)
      : source.model;
  const local = isLocalEndpoint(source.baseUrl);
  return {
    plan: {
      model: `${source.name} · ${model}`,
      where: local ? "on this computer" : source.name,
      local,
      sourceId: source.id,
    },
    turn: (messages, signal) =>
      streamTurn({
        baseUrl: source.baseUrl,
        wire: source.wire,
        auth: headerOf(source.preset),
        ...(apiKey ? { apiKey } : {}),
        model,
        messages,
        signal,
      }),
  };
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

/**
 * What the model is shown of a chat: the last 40 messages that worked, with a
 * summary in place of the older messages it stands in for.
 */
function chatHistory(assistantId: string): WireMessage[] {
  // A message's files are named, never resent, in what came before.
  return sentMessages(
    store
      .messages(assistantId)
      .map((m) => (m.attachments?.length ? { ...m, text: historyText(m) } : m)),
  );
}

/** An assistant's memory, or none when its file cannot be read. */
function memoryOf(assistantId: string) {
  try {
    return memory.read(assistantId);
  } catch {
    return undefined;
  }
}

/** One plain call to the assistant's own model, with no tools. */
async function plainTurn(assistant: Assistant, signal: AbortSignal) {
  const sourceId = assistant.sourceId ?? store.settings().defaultSourceId;
  const source = sourceId
    ? store.sources().find((s) => s.id === sourceId)
    : undefined;
  if (!source)
    throw new ModelError("No model is set up yet. Add one in Models.");
  const apiKey = await secrets.get(source.id);
  return (messages: WireMessage[]) =>
    streamTurn({
      baseUrl: source.baseUrl,
      wire: source.wire,
      auth: headerOf(source.preset),
      ...(apiKey ? { apiKey } : {}),
      model: assistant.model ?? source.model,
      messages,
      tools: [],
      signal,
    });
}

/** A chat can only be changed while nothing is being written to it. */
function idle(assistantId: string): void {
  if (running.has(assistantId))
    throw new Error("It is still answering. Stop it first, or wait.");
}

/**
 * The assistant's own model sums up the older messages. They stop being sent
 * at once, and are deleted only when the person keeps the summary.
 */
async function summariseChat(assistantId: string): Promise<ChatMessage[]> {
  idle(assistantId);
  const assistant = store.assistant(assistantId);
  const plan = planSummary(store.messages(assistantId));
  const controller = new AbortController();
  running.set(assistantId, controller);
  try {
    const turn = await plainTurn(assistant, controller.signal);
    const text = await writeSummary(turn, assistant.name, plan.transcript);
    const next = applySummary(store.messages(assistantId), plan.older, text);
    store.replaceMessages(assistantId, next);
    forgotten.delete(assistantId);
    return next;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Stopped. Nothing changed.");
    throw error instanceof ModelError || error instanceof Error
      ? error
      : new Error("The summary did not work.");
  } finally {
    running.delete(assistantId);
  }
}

function changeChat(
  assistantId: string,
  edit: (messages: ChatMessage[]) => ChatMessage[],
): ChatMessage[] {
  idle(assistantId);
  const next = edit(store.messages(assistantId));
  store.replaceMessages(assistantId, next);
  return next;
}

/** The model source and model an assistant answers with, as the agent names them. */
function modeKeyOf(assistant: Assistant): string | undefined {
  const sourceId = assistant.sourceId ?? store.settings().defaultSourceId;
  const source = sourceId
    ? store.sources().find((s) => s.id === sourceId)
    : undefined;
  return source
    ? `${source.id}\n${assistant.model ?? source.model}`
    : undefined;
}

/**
 * The history for an answer. The person's newest message carries its files,
 * native where the model takes them; every earlier message only names its own.
 */
async function answerHistory(
  assistant: Assistant,
  activity: (label: string) => void,
): Promise<{ history: WireMessage[]; files: boolean }> {
  const history = chatHistory(assistant.id);
  const last = store
    .messages(assistant.id)
    .filter((m) => !m.failed)
    .at(-1);
  const refs = last?.role === "user" ? (last.attachments ?? []) : [];
  if (!last || refs.length === 0) return { history, files: false };
  activity("Reading the files");
  const loaded = refs.flatMap((ref) => {
    const file = attachments.load(assistant.id, ref);
    return file ? [file] : [];
  });
  const sourceId = assistant.sourceId ?? store.settings().defaultSourceId;
  const source = store.sources().find((s) => s.id === sourceId);
  const key = modeKeyOf(assistant);
  const message = await messageWithFiles(
    last.text,
    loaded,
    {
      wire: source?.wire ?? "openai",
      pictures: !cannotRead(key, "picture"),
      pdfs: !cannotRead(key, "pdf"),
    },
    fileReaders,
  );
  history[history.length - 1] = message;
  return { history, files: true };
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
    const onActivity = (label: string) =>
      tell(window, IPC.activity, { assistantId: assistant.id, label });
    const { history, files } = await answerHistory(assistant, onActivity);
    const key = modeKeyOf(assistant);
    // A file the person attached is private text, like a file in a folder:
    // a later call that reaches outside asks again.
    const seen = files ? { ...newSeen(), files: true } : undefined;
    const result = await runAssistant({
      assistant,
      kind: "answer",
      signal: controller.signal,
      history,
      ...(seen ? { seen } : {}),
      ...(files
        ? {
            attachments: true,
            files: {
              toText: (messages) => filesToText(messages, fileReaders),
              remember: (mode) => rememberCannotRead(key, mode),
            },
          }
        : {}),
      team: teamFor(assistant),
      ask: (ask) => askPerson(window, assistant.id, ask, controller.signal),
      onText: (text) => {
        full += text;
        tell(window, IPC.delta, { assistantId: assistant.id, text });
      },
      onActivity,
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
    title: "Export as a file",
    defaultPath: `${file.name.replace(/[^\w -]+/g, "").trim() || "assistant"}.assistant.json`,
    filters: [{ name: "Assistant file", extensions: ["json"] }],
  });
  if (picked.canceled || !picked.filePath) return false;
  writeFileSync(
    withExtension(picked.filePath, "json", existsSync),
    JSON.stringify(file, null, 2),
  );
  return true;
}

async function importAssistant(
  window: BrowserWindow,
): Promise<Assistant | null> {
  const picked = await dialog.showOpenDialog(window, {
    title: "Import an assistant file",
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
    title: "Export everything",
    defaultPath: backupName(),
    filters: [{ name: "Backup file", extensions: ["json"] }],
  });
  if (picked.canceled || !picked.filePath) return false;
  writeFileSync(
    withExtension(picked.filePath, "json", existsSync),
    JSON.stringify(
      buildBackup(store, includeChats, new Date(), memory),
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return true;
}

async function importBackup(
  window: BrowserWindow,
): Promise<BackupResult | null> {
  const picked = await dialog.showOpenDialog(window, {
    title: "Import a backup",
    properties: ["openFile"],
    filters: [{ name: "Backup file", extensions: ["json"] }],
  });
  const path = picked.filePaths[0];
  if (picked.canceled || !path) return null;
  if (statSync(path).size > MAX_BACKUP_BYTES)
    throw new Error("That file is too large to be a backup.");
  return restoreBackup(store, readFileSync(path, "utf8"), memory);
}

/**
 * "Save this chat": the save dialog is opened here, so the file goes only where
 * the person picked. Every saved key is read here, only to be hidden.
 */
async function exportChat(window: BrowserWindow, id: string): Promise<boolean> {
  const assistant = store.assistant(id);
  const messages = store.messages(id);
  if (messages.length === 0)
    throw new Error("There is nothing in this chat to save yet.");
  const now = new Date();
  const picked = await dialog.showSaveDialog(window, {
    title: "Save this chat",
    defaultPath: chatFileName(assistant.name, now),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (picked.canceled || !picked.filePath) return false;
  writeFileSync(
    withExtension(picked.filePath, "md", existsSync),
    chatMarkdown(assistant.name, messages, { now, hide: await savedKeys() }),
    { mode: 0o600 },
  );
  return true;
}

/** Every key the app keeps, opened only so an export can leave each one out. */
async function savedKeys(): Promise<string[]> {
  const ids = [
    ...store.sources().map((s) => s.id),
    ...store.connections().map((c) => c.id),
    ...store.mailAccounts().map((m) => m.id),
  ];
  const keys: string[] = [];
  for (const id of ids) {
    try {
      const key = await secrets.get(id);
      if (key) keys.push(key);
    } catch {
      // A key the keychain cannot open is not in the chat either.
    }
  }
  return keys;
}

/** One saved message, by the ids the page sends. */
function savedMessage(id: string, messageId: string): ChatMessage {
  const found = store.messages(id).find((m) => m.id === messageId);
  if (!found) throw new Error("That message is no longer here.");
  return found;
}

/**
 * One saved message to the clipboard, as plain words: its Markdown marks are
 * left out. The page names it; the text comes from here.
 */
function copyMessage(id: string, messageId: string): void {
  clipboard.writeText(plainText(savedMessage(id, messageId).text));
}

/** One code block of a saved answer to the clipboard, as it is written. */
function copyCode(id: string, messageId: string, index: unknown): void {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0)
    throw new Error("That is not allowed.");
  const code = codeBlocksOf(savedMessage(id, messageId).text)[index];
  if (code === undefined) throw new Error("That code is no longer here.");
  clipboard.writeText(code);
}

/**
 * Opens a link from a saved answer in the browser. The page asked the person
 * first; here the link must be one the answer holds, and http or https.
 */
async function openAnswerLink(
  id: string,
  messageId: string,
  href: string,
): Promise<void> {
  const safe = safeHref(href);
  if (!safe || !linksOf(savedMessage(id, messageId).text).includes(safe))
    throw new Error("That link cannot be opened.");
  await shell.openExternal(safe);
}

/** Small pictures of sent pictures, made once each while the app runs. */
const sentPreviews = new Map<string, string | null>();

/** A small picture of a sent picture, made again from its stored bytes. */
async function attachmentPreview(
  assistantId: string,
  id: string,
): Promise<string | null> {
  const key = `${assistantId}/${id}`;
  const known = sentPreviews.get(key);
  if (known !== undefined) return known;
  const file = attachments.fileOf(assistantId, id);
  if (!file) return null;
  let preview: string | null = null;
  try {
    const bytes = new Uint8Array(readFileSync(file));
    const kind = sniff(basename(file), bytes);
    preview =
      (await previewOf(kind, bytes, (b, type) => reader.toPng(b, type))) ??
      null;
  } catch {
    // A file that cannot be drawn keeps its plain mark.
  }
  if (sentPreviews.size >= 200) {
    const oldest = sentPreviews.keys().next().value;
    if (oldest !== undefined) sentPreviews.delete(oldest);
  }
  sentPreviews.set(key, preview);
  return preview;
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
  forgotten.clear();
  attachments.clearWaiting();
  return store.deleteAllChats();
}

function register(window: BrowserWindow): void {
  handle(IPC.getState, () => state());
  handle(IPC.saveAssistant, (_e, input: AssistantInput) => {
    const had = store.assistants().find((a) => a.id === input?.id)?.computer;
    const saved = store.saveAssistant(input);
    // Turning the computer off stops it; it is kept until the person removes it.
    if (had && !saved.computer) {
      computers.setHold(saved.id, "none");
      void computers.stop(saved.id).catch(() => {});
    }
    return saved;
  });
  handle(IPC.removeAssistant, (_e, id: unknown) => {
    running.get(str(id))?.abort();
    store.removeAssistant(str(id));
    memory.forget(str(id));
    forgotten.delete(str(id));
    attachments.clearWaiting(str(id));
    // Its computer goes with it, even one turned off; the exchange folder
    // stays in the data folder. Without Docker nothing is run.
    void computers.remove(str(id)).catch(() => {});
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
  handle(IPC.send, (_e, id: unknown, text: unknown, ids: unknown) =>
    send(window, str(id), str(text, 100_000), attachmentIds(ids)),
  );
  handle(IPC.pickAttachments, (_e, id: unknown) =>
    pickAttachments(window, str(id)),
  );
  handle(
    IPC.addAttachment,
    async (_e, id: unknown, name: unknown, bytes: unknown) => {
      try {
        return await addAttachment(str(id), name, bytes);
      } catch (error) {
        throw new Error(attachLine(error));
      }
    },
  );
  handle(IPC.removeAttachment, (_e, id: unknown, attachmentId: unknown) => {
    attachments.remove(str(id), str(attachmentId));
  });
  handle(IPC.pendingAttachments, (_e, id: unknown) =>
    attachments.pending(str(id)),
  );
  handle(IPC.openAttachment, (_e, id: unknown, attachmentId: unknown) =>
    openAttachment(str(id), str(attachmentId)),
  );
  handle(IPC.attachmentPreview, (_e, id: unknown, attachmentId: unknown) =>
    attachmentPreview(str(id, 64), str(attachmentId, 64)),
  );
  handle(IPC.ocrLanguages, () => languages.list());
  // The code is checked against the pinned list in both; progress goes back
  // only as numbers the main process counted itself.
  handle(IPC.downloadOcrLanguage, (_e, code: unknown) =>
    languages.download(code, (progress) =>
      tell(window, IPC.ocrProgress, progress),
    ),
  );
  handle(IPC.cancelOcrLanguage, (_e, code: unknown) => languages.cancel(code));
  handle(IPC.removeOcrLanguage, (_e, code: unknown) => languages.remove(code));
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
  handle(IPC.checkCatalog, (_e, input: unknown) =>
    connections.checkCatalog(catalogInput(input)),
  );
  handle(IPC.saveCatalog, (_e, input: unknown) =>
    connections.saveCatalog(catalogInput(input)),
  );
  handle(IPC.removeConnection, (_e, id: unknown) => {
    connections.remove(str(id));
  });
  handle(
    IPC.removeConnectionTool,
    (_e, id: unknown, connectionId: unknown, tool: unknown) =>
      store.removeAllowedTool(str(id), str(connectionId), str(tool, 200)),
  );
  handle(IPC.checkMail, (_e, input: unknown) => mail.check(mailInput(input)));
  handle(IPC.saveMail, (_e, input: unknown) => mail.save(mailInput(input)));
  handle(IPC.removeMail, (_e, id: unknown) => {
    mail.remove(str(id));
  });
  handle(IPC.removeMailRead, (_e, id: unknown, accountId: unknown) =>
    store.removeAllowedMail(str(id), str(accountId)),
  );
  handle(IPC.saveSource, (_e, input: ModelSourceInput) => saveSource(input));
  handle(IPC.removeSource, (_e, id: string) => {
    store.removeSource(id);
    secrets.remove(id);
  });
  handle(IPC.probeModels, (_e, input: unknown) => {
    const probe = probeInput(input);
    const preset = presetOf(probe.preset);
    const baseUrl = resolveAddress(probe.preset, probe);
    return modelsOf(preset, baseUrl, probe.apiKey?.trim() || undefined);
  });
  handle(IPC.checkSource, async (_e, id: unknown) => {
    const source = store.source(str(id, 100));
    const preset = presetOf(source.preset);
    // Suggestions need no key and send nothing.
    if (!preset.lists) return modelsOf(preset, source.baseUrl, undefined);
    const key = await secrets.get(source.id);
    if (!key && !isLocalEndpoint(source.baseUrl) && preset.needsKey) {
      throw new Error("This source has no key saved. Add it again.");
    }
    return modelsOf(preset, source.baseUrl, key ?? undefined);
  });
  handle(IPC.setSourceModel, async (_e, id: unknown, model: unknown) =>
    withKey(store.setSourceModel(str(id, 100), str(model, 200))),
  );
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
  handle(IPC.searchChats, (_e, query: unknown) =>
    searchStore(store, searchQuery(query)),
  );
  handle(IPC.exportChat, (_e, id: unknown) => exportChat(window, str(id, 64)));
  handle(IPC.copyMessage, (_e, id: unknown, messageId: unknown) =>
    copyMessage(str(id, 64), str(messageId, 64)),
  );
  handle(IPC.copyCode, (_e, id: unknown, messageId: unknown, index: unknown) =>
    copyCode(str(id, 64), str(messageId, 64), index),
  );
  handle(
    IPC.openAnswerLink,
    (_e, id: unknown, messageId: unknown, href: unknown) =>
      openAnswerLink(str(id, 64), str(messageId, 64), str(href, 2048)),
  );
  registerComputer({
    handle,
    service: computers,
    assistant: (id) => store.assistant(str(id)),
    assistants: () => store.assistants(),
    progress: (payload) => tell(window, IPC.computerProgress, payload),
    state: (payload) => tell(window, IPC.computerState, payload),
    openFolder: (path) => shell.openPath(path),
  });
  registerRecording({ handle, window, store, model: draftModel });
  registerMemory();
}

/** Memory notes and the chat's context. Every value from the page is checked. */
function registerMemory(): void {
  const known = (id: unknown) => store.assistant(str(id)).id;
  handle(IPC.memory, (_e, id: unknown) => memory.read(known(id)));
  handle(IPC.addNote, (_e, id: unknown, text: unknown) => {
    return memory.add(known(id), str(text, 2000)).memory;
  });
  handle(IPC.editNote, (_e, id: unknown, noteId: unknown, text: unknown) =>
    memory.edit(known(id), str(noteId, 100), str(text, 2000)),
  );
  handle(IPC.removeNote, (_e, id: unknown, noteId: unknown) =>
    memory.remove(known(id), str(noteId, 100)),
  );
  handle(IPC.setMemoryOn, (_e, id: unknown, on: unknown) =>
    memory.setOn(known(id), on),
  );
  handle(IPC.forgetMessage, (_e, id: unknown, messageId: unknown) => {
    const assistantId = known(id);
    let kept: { message: ChatMessage; index: number } | undefined;
    const next = changeChat(assistantId, (messages) => {
      const done = forgetMessage(messages, str(messageId, 100));
      kept = { message: done.removed, index: done.index };
      return done.messages;
    });
    if (kept) forgotten.set(assistantId, kept);
    return next;
  });
  handle(IPC.undoForget, (_e, id: unknown) => {
    const assistantId = known(id);
    const kept = forgotten.get(assistantId);
    if (!kept) throw new Error("There is nothing to bring back.");
    const next = changeChat(assistantId, (messages) =>
      restoreMessage(messages, kept.message, kept.index),
    );
    forgotten.delete(assistantId);
    return next;
  });
  handle(IPC.clearChat, (_e, id: unknown) => {
    const assistantId = known(id);
    changeChat(assistantId, () => []);
    forgotten.delete(assistantId);
  });
  handle(IPC.summariseChat, (_e, id: unknown) => summariseChat(known(id)));
  handle(IPC.keepSummary, (_e, id: unknown, summaryId: unknown) =>
    changeChat(known(id), (messages) =>
      keepSummary(messages, str(summaryId, 100)),
    ),
  );
  handle(IPC.undoSummary, (_e, id: unknown, summaryId: unknown) =>
    changeChat(known(id), (messages) =>
      undoSummary(messages, str(summaryId, 100)),
    ),
  );
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

/** Whether keys can be kept in this computer's keychain, asked once a run. */
let keychainCheck: Promise<boolean> | undefined;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    icon: windowIcon,
    title: "OpenStellarFirm",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // On Linux and Windows the menu sits inside the window, under the title
    // bar. It stays out of sight until Alt is pressed; its keys still work.
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The developer tools could press Approve for the person: an installed
      // app has none. No spelling check either: on Linux Chromium would
      // download its dictionaries from Google for it.
      devTools: !app.isPackaged,
      spellcheck: false,
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

// The reader's scheme has to be known before the app is ready.
registerReaderScheme();

// An installed app is never driven from outside: a debugging port or pipe,
// or an inspector, would let another program on this computer press Approve
// for the person.
if (
  refusedLaunch(
    app.isPackaged,
    (name) => app.commandLine.hasSwitch(name),
    process.argv,
  )
) {
  app.exit(1);
}

app.whenReady().then(() => {
  const dir = app.getPath("userData");
  store = new Store(dir);
  memory = new MemoryStore(dir);
  secrets = new Secrets(join(dir, "keys.json"), {
    // Decided once a run: the keyring a Linux desktop has does not appear
    // while the app is open, and the app says to open it again.
    available: () => {
      keychainCheck ??= keychainUsable(
        process.platform,
        () => safeStorage.isAsyncEncryptionAvailable(),
        (plain) => safeStorage.encryptStringAsync(plain),
      );
      return keychainCheck;
    },
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
  mail = new MailService({ store, secrets });
  const readerDir = join(__dirname, "../reader");
  languages = new OcrLanguages({
    dataDir: dir,
    builtInDir: join(readerDir, "lang"),
    fetch,
  });
  reader = new Reader({
    dir: readerDir,
    language: (code) => languages.bytesOf(code),
  });
  attachments = new Attachments(dir, {
    pdfPages: (bytes) => reader.pdfPages(bytes),
    preview: (file, bytes) =>
      previewOf(file, bytes, (b, type) => reader.toPng(b, type)),
  });
  // Files no chat refers to any more, left by a crash or a removed assistant.
  try {
    const ids = new Set(store.assistants().map((a) => a.id));
    sweepFiles(dir, (id) => (ids.has(id) ? store.messages(id) : undefined));
  } catch {
    // A sweep that fails leaves files for the next start.
  }
  computers = createComputers(dir, join(__dirname, "../computer"));
  // A computer nobody has used for a while is stopped. Docker is asked
  // nothing until a computer was started in this run of the app.
  setInterval(() => {
    void computers.sweepIdle().catch(() => {});
  }, 60_000).unref();
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
  // The app's own menu: edit, zoom and window items, and no developer tools
  // in an installed app.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(menuTemplate(process.platform, app.isPackaged)),
  );
  const window = createWindow();
  // The hidden reader is a window too; it must not keep the app open.
  window.on("closed", () => reader.dispose());
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

// The assistants' computers stop when the app quits. They are kept, with
// their files, until the person removes them.
let stoppedComputers = false;
app.on("before-quit", (event) => {
  if (stoppedComputers || !computers) return;
  event.preventDefault();
  stoppedComputers = true;
  void Promise.race([
    computers.stopAll().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ]).finally(() => app.quit());
});
