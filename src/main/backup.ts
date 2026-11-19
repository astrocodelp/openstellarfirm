import {
  type AssistantFile,
  cleanMessages,
  readAssistantFile,
} from "../shared/assistant-file";
import type { OwnSkill } from "../shared/own-skills";
import type { BackupResult } from "../shared/types";
import type { MemoryStore } from "./memory";
import type { Store } from "./store";

/**
 * Moving everything to another computer. The file holds assistants (name,
 * look, brief and skills), the person's own skills as text, and, only when
 * the person asks, their chats and the notes in their memory. It never holds a
 * key, a model source, a model, a folder, a site or any other setting.
 */

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ASSISTANTS = 200;
export const MAX_BACKUP_MESSAGES = 5000;

export interface BackupFile {
  format: "stellarfirm-open.backup";
  version: 1;
  exportedAt: string;
  assistants: AssistantFile[];
  /**
   * The person's own skills, as text. Added before the assistants on restore,
   * so the skills they have ticked are there. An older file has none.
   */
  ownSkills?: OwnSkill[];
  /** Messages by position in `assistants`, as a string such as "0". */
  chats?: Record<
    string,
    { role: string; text: string; at: string; failed?: boolean }[]
  >;
  /**
   * Memory by position in `assistants`, only when chats are in the file too:
   * notes are as personal as a chat. Missing in a backup made before memory.
   */
  memory?: Record<string, { on: boolean; notes: string[] }>;
}

export function buildBackup(
  store: Store,
  includeChats: boolean,
  now: Date = new Date(),
  memory?: Pick<MemoryStore, "read">,
): BackupFile {
  const list = store.assistants();
  const file: BackupFile = {
    format: "stellarfirm-open.backup",
    version: 1,
    exportedAt: now.toISOString(),
    assistants: list.map((a) => store.exportFile(a.id)),
  };
  const own = store.ownSkills();
  if (own.length > 0) file.ownSkills = own;
  if (includeChats) {
    const chats: NonNullable<BackupFile["chats"]> = {};
    list.forEach((a, index) => {
      // A check and its update are the app's own, and the check holds what the
      // person asked it to look for: neither travels.
      const messages = store
        .messages(a.id)
        .filter((m) => !m.check)
        .slice(-MAX_BACKUP_MESSAGES)
        .map((m) => ({
          role: m.role,
          text: m.text,
          at: m.at,
          ...(m.failed ? { failed: true } : {}),
        }));
      if (messages.length > 0) chats[String(index)] = messages;
    });
    file.chats = chats;
    if (memory) file.memory = memoryOf(list, memory);
  }
  return file;
}

/** Each assistant's notes, by position. Off with no notes is the default: left out. */
function memoryOf(
  list: { id: string }[],
  memory: Pick<MemoryStore, "read">,
): NonNullable<BackupFile["memory"]> {
  const out: NonNullable<BackupFile["memory"]> = {};
  list.forEach((a, index) => {
    try {
      const m = memory.read(a.id);
      if (m.notes.length > 0 || !m.on)
        out[String(index)] = { on: m.on, notes: m.notes.map((n) => n.text) };
    } catch {
      // Memory this version cannot read stays on this computer.
    }
  });
  return out;
}

export function backupName(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `openstellarfirm-backup-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}

/**
 * Adds what a backup holds as new assistants. Nothing here is overwritten or
 * deleted, and a bad assistant is skipped and counted, never fatal.
 */
export function restoreBackup(
  store: Store,
  raw: string,
  memory?: Pick<MemoryStore, "restore">,
): BackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file is not a backup from this app.");
  }
  const file = parsed as Partial<BackupFile> | null;
  if (
    typeof file !== "object" ||
    file === null ||
    file.format !== "stellarfirm-open.backup" ||
    file.version !== 1 ||
    !Array.isArray(file.assistants)
  ) {
    throw new Error("That file is not a backup from this app.");
  }
  const entries = file.assistants;
  const ownSkills = store.addOwnSkills(file.ownSkills);
  const chats =
    typeof file.chats === "object" &&
    file.chats !== null &&
    !Array.isArray(file.chats)
      ? file.chats
      : {};
  const memories =
    typeof file.memory === "object" &&
    file.memory !== null &&
    !Array.isArray(file.memory)
      ? file.memory
      : {};
  let added = 0;
  let chatCount = 0;
  let full = false;
  // Anything past the cap is left out and counted as skipped.
  let skipped = Math.max(0, entries.length - MAX_BACKUP_ASSISTANTS);
  entries.slice(0, MAX_BACKUP_ASSISTANTS).forEach((entry, index) => {
    if (full) {
      skipped += 1;
      return;
    }
    try {
      const { assistant } = readAssistantFile(entry);
      const key = String(index);
      const chat = Object.hasOwn(chats, key)
        ? cleanMessages(chats[key], MAX_BACKUP_MESSAGES)
        : [];
      const saved = store.addImported(assistant, chat);
      added += 1;
      const notes = Object.hasOwn(memories, key) ? memories[key] : undefined;
      // Notes are checked one by one: one that reads like a secret stays out.
      if (memory && notes && typeof notes === "object") {
        try {
          memory.restore(saved.id, notes);
        } catch {
          // The assistant is in; only its notes could not be written.
        }
      }
      if (chat.length > 0) chatCount += 1;
    } catch (error) {
      skipped += 1;
      if (error instanceof Error && /up to \d+ assistants/.test(error.message))
        full = true;
    }
  });
  return {
    added,
    skipped,
    chats: chatCount,
    full,
    ...(ownSkills > 0 ? { ownSkills } : {}),
  };
}
