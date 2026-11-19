/** Types shared by the main process, the preload and the page. No Node or DOM imports. */

import type { AccessibilityPrefs } from "./accessibility";
import type { CheckEvery } from "./checks";
import type {
  ComputerHold,
  ComputerInput,
  ComputerListItem,
  ComputerProgress,
  ComputerSettings,
  ComputerShot,
  ComputerState,
  ComputerStatus,
  ComputerView,
} from "./computer";
import type {
  DeskPetConfig,
  DeskPetConfirm,
  DeskPetSetupCode,
  DeskPetsStatus,
} from "./desk-pets";
import type { OcrDownloadProgress } from "./download-progress";
import type { LinkName } from "./links";
import type { AssistantMemory, MemoryNote } from "./memory";
import type { OwnSkill, OwnSkillDraft, OwnSkillInput } from "./own-skills";
import type { SendKey, TextSize } from "./preferences";
import type { RecordPlan, RecordSource, RecordStatus } from "./recording";
import type { Theme } from "./theme";
import type { UpdateCheck } from "./update";

export type {
  AccessibilityPrefs,
  AssistantMemory,
  CheckEvery,
  LinkName,
  MemoryNote,
  SendKey,
  TextSize,
  UpdateCheck,
};

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
  "xai",
  "deepseek",
  "groq",
  "cerebras",
  "nvidia",
  "huggingface",
  "requesty",
  "requesty-eu",
  "vercel",
  "llmapi",
  "ironlane",
  "orcarouter",
  "azure",
  "bedrock",
  "litellm",
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
  /**
   * A computer of its own: a Linux desktop in Docker on this computer, with
   * no network unless the person allows it. A new assistant has one with the
   * defaults; only the assistant form turns it off or changes it, never a
   * shared file, a backup or a persona.
   */
  computer?: ComputerSettings;
  /** Set when the person turned its computer off, so the default stays off. */
  computerOff?: true;
  /** Sites the person chose to always allow for this assistant. */
  sites: string[];
  /** Ids of the connections it may use. Only the assistant form sets them. */
  connections: string[];
  /**
   * Reads the person chose to always allow, as "<connection id>:<tool>".
   * Only a tool marked as a read can ever be listed here.
   */
  connectionTools: string[];
  /**
   * Ids of the mail accounts it may read. Only the assistant form sets them;
   * never in a shared file, a backup or a persona. Missing means none.
   */
  mail?: string[];
  /**
   * Mail accounts the person chose to always allow reading for this assistant.
   * Only an account listed in `mail` can be here.
   */
  mailReads?: string[];
  /**
   * Ids of the other assistants it may ask one question at a time. Empty unless
   * the person ticks them in the assistant form; never in a shared file, a
   * backup or a persona.
   */
  canAsk?: string[];
  /** The start of its newest message, for the sidebar. */
  lastLine?: string;
  createdAt: string;
}

/** What the page may set. Folders and sites are never set from here. */
export type AssistantInput = Pick<
  Assistant,
  "name" | "group" | "pet" | "color" | "brief" | "skills" | "sourceId" | "model"
> & {
  id?: string;
  web?: boolean;
  screen?: boolean;
  /** Null turns its computer off; missing keeps it as it is. */
  computer?: ComputerSettings | null;
  connections?: string[];
  mail?: string[];
  canAsk?: string[];
};

/** One thing the assistant did while answering, as a short plain line. */
export interface ChatStep {
  label: string;
  ok: boolean;
  /** Set when it saved a note with `remember`, so the chat can offer Undo. */
  note?: { id: string; text: string };
  /**
   * A picture of its own computer's screen after this step, kept in memory
   * while the app runs and never saved; missing once the app has quit.
   */
  frame?: string;
}

/** What a file a person attached turned out to be, from its own bytes. */
export type AttachmentKind = "png" | "jpeg" | "webp" | "gif" | "pdf" | "text";

/** A file on a sent message. The bytes stay in the app's data folder. */
export interface AttachmentRef {
  id: string;
  /** The file's own name, cleaned. */
  name: string;
  kind: AttachmentKind;
  /** Bytes. */
  size: number;
  /** Set for a PDF. */
  pages?: number;
  /** The SHA-256 of the stored bytes, kept with a sent file. */
  sha256?: string;
}

/** A file waiting in the message box, before it is sent. */
export interface PendingAttachment extends AttachmentRef {
  /** A small picture made by the main process from the checked bytes. */
  preview?: string;
}

/** What picking files did: the files added, and a line for each one refused. */
export interface PickedAttachments {
  added: PendingAttachment[];
  problems: string[];
}

/** A language the reader on this computer can learn. */
export interface OcrLanguage {
  code: string;
  name: string;
  /** Bytes to download. */
  size: number;
  /** True for English, which comes with the app. */
  builtIn: boolean;
  installed: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  /** True when the model call failed and the text says why. */
  failed?: boolean;
  steps?: ChatStep[];
  /**
   * Set when the app wrote or answered this on its own: "request" is the check
   * the app started (not something the person typed), "update" is the reply.
   */
  check?: "request" | "update";
  /**
   * Set when this message was the person's own words spoken to a desk pet. It
   * is sent and approved exactly like a typed one; the mark only says where it
   * came from. Older saved chats have none.
   */
  from?: "pet";
  /**
   * A summary of older messages, written by the assistant's own model.
   * "pending" until the person keeps it; the older messages stay until then.
   */
  summary?: "pending" | "kept";
  /** The id of the pending summary that stands in for this message. Not sent. */
  summarised?: string;
  /** The files the person sent with this message. */
  attachments?: AttachmentRef[];
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
  /**
   * What the person types for a cloud preset: an Azure resource name or host,
   * or a Bedrock region. Checked in the main process, never trusted.
   */
  part?: string;
  model: string;
  /** Sent once, on save. Never returned. Empty keeps the saved key. */
  apiKey?: string;
}

/**
 * How a connection was made. "custom" is an address the person typed,
 * "composio" is the Composio preset, and "catalog:<id>" is one service from the
 * built-in list. Only the main process decides it.
 */
export type ConnectionPreset = "custom" | "composio" | `catalog:${string}`;

/** What the page may send for a catalog service: which one, a name and a key. */
export interface CatalogInput {
  /** An id from the built-in list. The address and header come from it. */
  catalogId: string;
  id?: string;
  name: string;
  /** Sent once, on check or save. Never returned. Empty keeps the saved key. */
  apiKey?: string;
}

/** What the page may send for a Composio connection: no address, no header. */
export interface ComposioInput {
  id?: string;
  name: string;
  /** Sent once, on check or save. Never returned. Empty keeps the saved key. */
  apiKey?: string;
}

/** What a company says it offers to personal agents. Plain, cleaned text. */
export interface CompanyOffer {
  domain: string;
  name: string;
  /** True when the file says sign-in is offered. */
  signIn: boolean;
  apis: { type: "mcp" | "openapi"; url: string; description: string }[];
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
  /** "composio" is the preset that uses the person's own Composio key. */
  preset: ConnectionPreset;
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

/** A mailbox an assistant may read. The password never leaves the main process. */
export interface MailAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** True when the person said the server is on their own network. */
  ownNetwork: boolean;
  hasPassword: boolean;
  checkedAt: string;
}

export interface MailAccountInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  ownNetwork: boolean;
  /** Sent once, on check or save. Never returned. Empty keeps the saved one. */
  password?: string;
}

/** What a mail check found: the folder names, cut and cleaned. */
export interface MailCheck {
  folders: string[];
  /** How many more folders there were than are listed. */
  more: number;
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
  /** Contrast, motion, focus, reading space, target size and read aloud. Missing means the defaults. */
  accessibility?: AccessibilityPrefs;
  /**
   * Off until the person turns it on: a look at the newest version when the
   * app starts, and once a day while it stays open.
   */
  checkUpdates: boolean;
  /** When the update check last ran, and the newest version it found. */
  lastUpdateCheck?: string;
  newestVersion?: string;
  /** The version whose notice the person closed. */
  dismissedVersion?: string;
  /** False once the person turned off the system notice for a new version. Missing means on. */
  updateNotify?: boolean;
  /** The newest version the person was already told about, so it is told once. */
  notifiedVersion?: string;
  /** The one assistant that may check on its own. Missing means none. */
  mainAssistantId?: string;
  /** Off until the person turns it on: checks run only while the app is open. */
  checkOnItsOwn?: boolean;
  /** Minutes between checks; one of the choices in `CHECK_EVERY`. */
  checkEvery?: CheckEvery;
  /** What to look for, in the person's own words. */
  checkLookFor?: string;
  /** Off until the person turns it on: a notice, with the name only. */
  checkNotify?: boolean;
  /** True while the main assistant has an update the person has not seen. */
  checkUnread?: boolean;
  /**
   * The person's own skills, such as one drafted from a recording. Only the
   * main process changes them, through `saveOwnSkill` and `removeOwnSkill`.
   */
  ownSkills?: OwnSkill[];
}

export interface AppState {
  assistants: Assistant[];
  sources: ModelSource[];
  connections: Connection[];
  mailAccounts: MailAccount[];
  settings: Settings;
  /** False when this computer has no keychain to keep a key in. */
  keychain: boolean;
  platform: string;
  /** The processor this app was built for, such as "arm64", to pick its download. */
  arch: string;
  /** This app's own version, such as "0.1.0". */
  version: string;
  /** The folder the app keeps everything in, shown as plain text. */
  dataDir: string;
}

export interface LocalModels {
  ollama: string[] | null;
  lmstudio: string[] | null;
  /** The model a first run starts with for each, and why it was picked. */
  picks?: { ollama?: ModelPick; lmstudio?: ModelPick };
  /** What each program said about its models, for the picker. */
  details?: { ollama?: ModelInfo[]; lmstudio?: ModelInfo[] };
}

/** One model a service lists, with what its list says about it. */
export interface ModelInfo {
  /** The name a call uses. */
  id: string;
  /** A display name, when the list gives one that differs from the id. */
  name?: string;
  /** How many tokens it can take in, when the list says. */
  context?: number;
  /** True when the list says it reads pictures. */
  pictures?: boolean;
  /** True when the list says it can use tools. */
  tools?: boolean;
  /** When it was published or added, in milliseconds, when the list says. */
  created?: number;
}

/**
 * The models to pick from. "listed" came from the service itself; "suggested"
 * is a short list written in this app for a service with no list to ask.
 */
export interface ModelList {
  models: ModelInfo[];
  from: "listed" | "suggested";
}

/** A model picked to start with, and the end of a sentence saying why. */
export interface ModelPick {
  model: string;
  /** Such as "it can use tools and read pictures." */
  reason: string;
}

export interface ChatDelta {
  assistantId: string;
  text: string;
}

export interface ChatDone {
  assistantId: string;
  message: ChatMessage;
  /** The check the app started, saved just before `message`; none for an answer. */
  request?: ChatMessage;
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
  /** How many of the person's own skills were added. */
  ownSkills?: number;
}

/** A piece of a search result's snippet; `match` marks the words found. */
export interface SearchPart {
  text: string;
  match: boolean;
}

/** One message a search found, with a short piece of it around the match. */
export interface SearchHit {
  assistantId: string;
  messageId: string;
  role: ChatMessage["role"];
  at: string;
  parts: SearchPart[];
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
  /**
   * Sends a message, with the files waiting in the box whose ids are given.
   * The files were checked when they were added; the page never names a path.
   */
  send(
    assistantId: string,
    text: string,
    attachmentIds?: string[],
  ): Promise<ChatMessage>;
  /** Opens the system's file picker, opened by the main process, to add files. */
  pickAttachments(assistantId: string): Promise<PickedAttachments>;
  /**
   * Adds a file the person dropped or pasted, as bytes the page read. Its kind
   * is decided from the bytes in the main process.
   */
  addAttachment(
    assistantId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<PendingAttachment>;
  /** Takes a waiting file out of the box. */
  removeAttachment(assistantId: string, attachmentId: string): Promise<void>;
  /** The files waiting in this assistant's box. */
  pendingAttachments(assistantId: string): Promise<PendingAttachment[]>;
  /** Opens a sent file with the system's default app, by id, on the person's click. */
  openAttachment(assistantId: string, attachmentId: string): Promise<void>;
  /** A small picture of a sent picture, made again by the app; null for other files. */
  attachmentPreview(
    assistantId: string,
    attachmentId: string,
  ): Promise<string | null>;
  /** The languages the reader on this computer knows or can learn. */
  ocrLanguages(): Promise<OcrLanguage[]>;
  /**
   * Downloads one language, on the person's click, and checks it. Progress
   * arrives as events, about ten a second at most.
   */
  downloadOcrLanguage(code: string): Promise<OcrLanguage[]>;
  /** Stops that download, on the person's click; the partial file is deleted. */
  cancelOcrLanguage(code: string): Promise<boolean>;
  removeOcrLanguage(code: string): Promise<OcrLanguage[]>;
  onOcrProgress(listener: (progress: OcrDownloadProgress) => void): () => void;
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
  /** Like checkConnection, for the Composio preset: the address is fixed. */
  checkComposio(input: ComposioInput): Promise<ConnectionTool[]>;
  saveComposio(input: ComposioInput): Promise<Connection>;
  /** Like checkConnection, for a service from the built-in list. */
  checkCatalog(input: CatalogInput): Promise<ConnectionTool[]>;
  saveCatalog(input: CatalogInput): Promise<Connection>;
  /** Reads what a company publishes for personal agents. Saves nothing. */
  lookupCompany(domain: string): Promise<CompanyOffer>;
  /** Takes back an "Always allow" for one read of one connection. */
  removeConnectionTool(
    assistantId: string,
    connectionId: string,
    tool: string,
  ): Promise<Assistant>;
  /** Signs in to a mailbox, lists its folders and signs out. Saves nothing. */
  checkMail(input: MailAccountInput): Promise<MailCheck>;
  /** Signs in once to prove it works, then saves the account. */
  saveMail(input: MailAccountInput): Promise<MailAccount>;
  removeMail(id: string): Promise<void>;
  /** Takes back an "Always allow" for reading one mail account. */
  removeMailRead(assistantId: string, accountId: string): Promise<Assistant>;
  saveSource(input: ModelSourceInput): Promise<ModelSource>;
  removeSource(id: string): Promise<void>;
  /** Lists the models of a source that is not saved yet. */
  probeModels(input: {
    preset: PresetId;
    baseUrl?: string;
    part?: string;
    apiKey?: string;
  }): Promise<ModelList>;
  /** Lists the models of a saved source, which also proves it works. */
  checkSource(id: string): Promise<ModelList>;
  /** Changes only the model a saved source uses. */
  setSourceModel(id: string, model: string): Promise<ModelSource>;
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
  openLink(name: LinkName | `catalog:${string}`): Promise<void>;
  /** Opens the app's own data folder. The page names no path. */
  openDataFolder(): Promise<void>;
  /**
   * Forgets every site "Always allow" remembered, for every assistant, so each
   * asks again. Returns how many were forgotten.
   */
  clearApprovals(): Promise<number>;
  /** Deletes every chat and keeps the assistants. Returns how many chats. */
  deleteAllChats(): Promise<number>;
  /**
   * Starts one check by the main assistant, on the person's click. It only
   * reads. Resolves when it has started; the update appears in the chat.
   */
  checkNow(): Promise<void>;
  /** One check for a newer version, on the person's click. */
  checkForUpdate(): Promise<UpdateCheck>;
  /** Closes the notice for the version that is shown now. */
  dismissUpdate(): Promise<Settings>;
  /**
   * Searches every chat on this computer. Plain text in, plain parts out: the
   * snippet never holds HTML.
   */
  searchChats(query: string): Promise<SearchHit[]>;
  /**
   * Saves one chat as a Markdown file, through the system's save dialog. False
   * when the person closed the dialog. The page never names a path.
   */
  exportChat(assistantId: string): Promise<boolean>;
  /** Copies one saved message to the clipboard. The page sends ids, not text. */
  copyMessage(assistantId: string, messageId: string): Promise<void>;
  /** Copies one code block of a saved answer, by its index in the answer. */
  copyCode(
    assistantId: string,
    messageId: string,
    index: number,
  ): Promise<void>;
  /**
   * Opens a link from a saved answer in the browser, after the person said
   * yes on the page. The app opens it only when that answer holds the link
   * and it is http or https.
   */
  openAnswerLink(
    assistantId: string,
    messageId: string,
    href: string,
  ): Promise<void>;
  /** An assistant's memory: whether it is on, and its notes. */
  memory(assistantId: string): Promise<AssistantMemory>;
  addNote(assistantId: string, text: string): Promise<AssistantMemory>;
  editNote(
    assistantId: string,
    noteId: string,
    text: string,
  ): Promise<AssistantMemory>;
  removeNote(assistantId: string, noteId: string): Promise<AssistantMemory>;
  setMemoryOn(assistantId: string, on: boolean): Promise<AssistantMemory>;
  /** Takes one message out of the chat. The newest one forgotten can be brought back. */
  forgetMessage(assistantId: string, messageId: string): Promise<ChatMessage[]>;
  undoForget(assistantId: string): Promise<ChatMessage[]>;
  /** Deletes this assistant's chat. Its notes stay. */
  clearChat(assistantId: string): Promise<void>;
  /** Has the assistant's own model sum up the older messages. Nothing is deleted yet. */
  summariseChat(assistantId: string): Promise<ChatMessage[]>;
  /** Keeps a summary and deletes the messages it stands in for. */
  keepSummary(assistantId: string, summaryId: string): Promise<ChatMessage[]>;
  /** Takes a summary away and sends the older messages again. */
  undoSummary(assistantId: string, summaryId: string): Promise<ChatMessage[]>;
  /**
   * Record how you work. The screens and windows that may be recorded; the
   * person's pick is the consent. The page never captures anything itself.
   */
  recordSources(): Promise<RecordSource[]>;
  recordStart(sourceId: string): Promise<RecordStatus>;
  recordStop(): Promise<RecordStatus>;
  recordStatus(): Promise<RecordStatus>;
  /** One picture from a video the person picked, as base64 JPEG. */
  recordAddFrame(jpeg: string, atMs: number): Promise<RecordStatus>;
  recordRemoveFrame(frameId: string): Promise<RecordStatus>;
  /** Forgets the recording and every picture in it. */
  recordClear(): Promise<RecordStatus>;
  /** How many pictures would go to which model. Sends nothing. */
  recordPlan(assistantId: string, sourceId?: string): Promise<RecordPlan>;
  /** Sends the kept pictures to the model and returns a draft. Saves nothing. */
  recordDraft(
    assistantId: string,
    notes: string,
    sourceId?: string,
  ): Promise<OwnSkillDraft>;
  recordCancel(): Promise<void>;
  onRecord(listener: (status: RecordStatus) => void): () => void;
  /** Saves one of the person's own skills: only on their own Save. */
  saveOwnSkill(input: OwnSkillInput): Promise<OwnSkill>;
  /** Deletes one, and takes it off every assistant that had it ticked. */
  removeOwnSkill(id: string): Promise<void>;
  onDelta(listener: (delta: ChatDelta) => void): () => void;
  onDone(listener: (done: ChatDone) => void): () => void;
  onActivity(listener: (activity: ChatActivity) => void): () => void;
  onApproval(listener: (change: ApprovalChange) => void): () => void;
  /**
   * An update check found something (`open: false`, read the state again), or
   * the person clicked the system notice for a new version (`open: true`,
   * show Settings, Updates).
   */
  onUpdateNews(listener: (news: { open: boolean }) => void): () => void;
  /** Whether Docker is there and running, and whether the computer is set up. */
  computerStatus(): Promise<ComputerStatus>;
  /** Builds the computer's image, on the person's click. Progress arrives as events. */
  computerSetup(): Promise<void>;
  computerView(assistantId: string): Promise<ComputerView>;
  computerStart(assistantId: string): Promise<ComputerView>;
  /** A picture of the screen for the live view; null when it is off. */
  computerShot(assistantId: string): Promise<ComputerShot | null>;
  /** Pauses the assistant on its computer, or gives the person control. */
  computerHold(assistantId: string, hold: ComputerHold): Promise<ComputerView>;
  /** A click or a key from the person; only while they have taken over. */
  computerInput(assistantId: string, input: ComputerInput): Promise<void>;
  computerStop(assistantId: string): Promise<ComputerView>;
  /** Removes the computer. The exchange folder and its files stay. */
  computerRemove(assistantId: string): Promise<ComputerView>;
  /** Opens the assistant's exchange folder. The page names no path. */
  computerOpenExchange(assistantId: string): Promise<void>;
  onComputerProgress(
    listener: (progress: ComputerProgress) => void,
  ): () => void;
  /** The assistants whose computers are on, as far as this run of the app knows. */
  computerRunning(): Promise<string[]>;
  /** Every assistant's computer: on or off, and when it was last used. */
  computerList(): Promise<ComputerListItem[]>;
  /** The picture kept after one step on its computer; null once it is gone. */
  computerFrame(assistantId: string, frameId: string): Promise<string | null>;
  onComputerState(listener: (state: ComputerState) => void): () => void;
  /** Desk pets: the switch, the certificate, the pets and the pairing. Off until turned on. */
  petsStatus(): Promise<DeskPetsStatus>;
  petsTurnOn(): Promise<DeskPetsStatus>;
  petsTurnOff(): Promise<DeskPetsStatus>;
  /** Replaces the certificate and forgets every paired pet. */
  petsNewCertificate(): Promise<DeskPetsStatus>;
  /** Makes the setup code the owner gives a new pet. */
  petsStartAdding(): Promise<DeskPetSetupCode>;
  /** The confirm code the pet said, typed by the owner. */
  petsConfirm(code: string): Promise<DeskPetConfirm>;
  petsForget(id: string): Promise<DeskPetsStatus>;
  petsRename(id: string, name: string): Promise<DeskPetsStatus>;
  /** Saves the ElevenLabs key. Write-only: the status says only that one is set. */
  petsSetVoiceKey(key: string): Promise<DeskPetsStatus>;
  petsClearVoiceKey(): Promise<DeskPetsStatus>;
  /** Which assistant a pet talks to, its voice and whether it speaks answers. */
  petsSetConfig(id: string, config: DeskPetConfig): Promise<DeskPetsStatus>;
  petsDiscardDraft(id: string): Promise<DeskPetsStatus>;
  /**
   * The USB chooser. While the page asks the browser for a serial port, the
   * app tells it which desk pet boards it found when there is more than one;
   * the page answers with the pick, or null to cancel. Nothing else is asked.
   */
  onSerialChoose(listener: (request: SerialChoice) => void): () => void;
  serialChosen(requestId: string, portId: string | null): Promise<void>;
}

/** One board the app found while the page asked for a USB port. */
export interface SerialChoiceItem {
  readonly portId: string;
  /** What to show: the system's name for the port. */
  readonly name: string;
}

export interface SerialChoice {
  readonly requestId: string;
  readonly ports: readonly SerialChoiceItem[];
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
  pickAttachments: "attachment:pick",
  addAttachment: "attachment:add",
  removeAttachment: "attachment:remove",
  pendingAttachments: "attachment:pending",
  openAttachment: "attachment:open",
  attachmentPreview: "attachment:preview",
  ocrLanguages: "ocr:languages",
  downloadOcrLanguage: "ocr:download",
  cancelOcrLanguage: "ocr:cancel",
  removeOcrLanguage: "ocr:remove",
  ocrProgress: "ocr:progress",
  stop: "chat:stop",
  pending: "chat:pending",
  decide: "chat:decide",
  checkConnection: "connection:check",
  saveConnection: "connection:save",
  removeConnection: "connection:remove",
  checkComposio: "connection:composio:check",
  saveComposio: "connection:composio:save",
  checkCatalog: "connection:catalog:check",
  saveCatalog: "connection:catalog:save",
  lookupCompany: "company:lookup",
  removeConnectionTool: "assistant:connection-tool:remove",
  checkMail: "mail:check",
  saveMail: "mail:save",
  removeMail: "mail:remove",
  removeMailRead: "assistant:mail-read:remove",
  saveSource: "source:save",
  removeSource: "source:remove",
  probeModels: "source:probe",
  checkSource: "source:check",
  setSourceModel: "source:model",
  detectLocal: "source:detect",
  setSettings: "settings:set",
  openCloud: "cloud:open",
  openLink: "link:open",
  openDataFolder: "data:open",
  clearApprovals: "approvals:clear",
  deleteAllChats: "chats:deleteAll",
  checkNow: "checks:now",
  checkForUpdate: "update:check",
  dismissUpdate: "update:dismiss",
  updateNews: "update:news",
  searchChats: "chat:search",
  exportChat: "chat:export",
  copyMessage: "chat:copy",
  copyCode: "chat:copy-code",
  openAnswerLink: "chat:open-link",
  memory: "memory:get",
  addNote: "memory:note:add",
  editNote: "memory:note:edit",
  removeNote: "memory:note:remove",
  setMemoryOn: "memory:on",
  forgetMessage: "chat:message:forget",
  undoForget: "chat:message:unforget",
  clearChat: "chat:clear",
  summariseChat: "chat:summarise",
  keepSummary: "chat:summary:keep",
  undoSummary: "chat:summary:undo",
  recordSources: "record:sources",
  recordStart: "record:start",
  recordStop: "record:stop",
  recordStatus: "record:status",
  recordAddFrame: "record:frame:add",
  recordRemoveFrame: "record:frame:remove",
  recordClear: "record:clear",
  recordPlan: "record:plan",
  recordDraft: "record:draft",
  recordCancel: "record:cancel",
  record: "record:update",
  saveOwnSkill: "skills:own:save",
  removeOwnSkill: "skills:own:remove",
  delta: "chat:delta",
  done: "chat:done",
  activity: "chat:activity",
  approval: "chat:approval",
  computerStatus: "computer:status",
  computerSetup: "computer:setup",
  computerView: "computer:view",
  computerStart: "computer:start",
  computerShot: "computer:shot",
  computerHold: "computer:hold",
  computerInput: "computer:input",
  computerStop: "computer:stop",
  computerRemove: "computer:remove",
  computerOpenExchange: "computer:exchange",
  computerProgress: "computer:progress",
  computerRunning: "computer:running",
  computerList: "computer:list",
  computerFrame: "computer:frame",
  computerState: "computer:state",
  petsStatus: "pets:status",
  petsTurnOn: "pets:on",
  petsTurnOff: "pets:off",
  petsNewCertificate: "pets:certificate",
  petsStartAdding: "pets:add",
  petsConfirm: "pets:confirm",
  petsForget: "pets:forget",
  petsRename: "pets:rename",
  petsSetVoiceKey: "pets:voice-key",
  petsClearVoiceKey: "pets:voice-key-clear",
  petsSetConfig: "pets:config",
  petsDiscardDraft: "pets:discard-draft",
  serialChoose: "serial:choose",
  serialChosen: "serial:chosen",
} as const;

/** Every answer over IPC, so an error arrives as a plain sentence. */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
