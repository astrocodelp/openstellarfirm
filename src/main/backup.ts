import {
  type AssistantFile,
  cleanMessages,
  readAssistantFile,
} from "../shared/assistant-file";
import type { BackupResult } from "../shared/types";
import type { Store } from "./store";

/**
 * Moving everything to another computer. The file holds assistants (name,
 * look, brief and skills) and, only when the person asks, their chats. It never
 * holds a key, a model source, a model, a folder, a site or a setting.
 */

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ASSISTANTS = 200;
export const MAX_BACKUP_MESSAGES = 5000;

export interface BackupFile {
  format: "stellarfirm-open.backup";
  version: 1;
  exportedAt: string;
  assistants: AssistantFile[];
  /** Messages by position in `assistants`, as a string such as "0". */
  chats?: Record<
    string,
    { role: string; text: string; at: string; failed?: boolean }[]
  >;
}

export function buildBackup(
  store: Store,
  includeChats: boolean,
  now: Date = new Date(),
): BackupFile {
  const list = store.assistants();
  const file: BackupFile = {
    format: "stellarfirm-open.backup",
    version: 1,
    exportedAt: now.toISOString(),
    assistants: list.map((a) => store.exportFile(a.id)),
  };
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
  }
  return file;
}

export function backupName(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `stellarfirm-open-backup-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}

/**
 * Adds what a backup holds as new assistants. Nothing here is overwritten or
 * deleted, and a bad assistant is skipped and counted, never fatal.
 */
export function restoreBackup(store: Store, raw: string): BackupResult {
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
  const chats =
    typeof file.chats === "object" &&
    file.chats !== null &&
    !Array.isArray(file.chats)
      ? file.chats
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
      store.addImported(assistant, chat);
      added += 1;
      if (chat.length > 0) chatCount += 1;
    } catch (error) {
      skipped += 1;
      if (error instanceof Error && /up to \d+ assistants/.test(error.message))
        full = true;
    }
  });
  return { added, skipped, chats: chatCount, full };
}
