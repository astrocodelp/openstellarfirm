import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ID } from "../shared/assistant-file";
import {
  type AssistantMemory,
  cleanNoteText,
  MAX_NOTE_CHARS,
  MAX_NOTES,
  MAX_REMEMBER_A_TURN,
  type MemoryNote,
} from "../shared/memory";
import type { ChatStep } from "../shared/types";
import type { ToolSpec } from "./models";
import type { Seen } from "./seen";

/**
 * An assistant's memory, on this computer: one small JSON file per assistant
 * in the app's data folder, beside its chat. An assistant with no file has
 * memory on and no notes, so a data folder made before memory existed loads
 * exactly as it did.
 */

interface StoredMemory {
  v: 1;
  on: boolean;
  notes: MemoryNote[];
}

export class MemoryStore {
  constructor(private readonly dir: string) {}

  /** The id comes from the page, so it is checked before it names a file. */
  private file(assistantId: string): string {
    if (!ID.test(assistantId))
      throw new Error("That assistant is no longer here.");
    return join(this.dir, "memory", `${assistantId}.json`);
  }

  read(assistantId: string): AssistantMemory {
    const file = this.file(assistantId);
    if (!existsSync(file)) return { on: true, notes: [] };
    const parsed = JSON.parse(
      readFileSync(file, "utf8"),
    ) as Partial<StoredMemory>;
    if (parsed.v !== 1)
      throw new Error("This memory was saved by a newer version of the app.");
    return { on: parsed.on !== false, notes: cleanNotes(parsed.notes) };
  }

  private write(assistantId: string, memory: AssistantMemory): AssistantMemory {
    const file = this.file(assistantId);
    mkdirSync(join(this.dir, "memory"), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    const stored: StoredMemory = { v: 1, on: memory.on, notes: memory.notes };
    writeFileSync(temp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    renameSync(temp, file);
    return memory;
  }

  /** Adds a note. A note already kept (in any case) is not added twice. */
  add(
    assistantId: string,
    raw: unknown,
    by: MemoryNote["by"] = "person",
  ): { memory: AssistantMemory; note: MemoryNote; added: boolean } {
    const text = cleanNoteText(raw);
    const memory = this.read(assistantId);
    const same = memory.notes.find(
      (n) => n.text.toLowerCase() === text.toLowerCase(),
    );
    if (same) return { memory, note: same, added: false };
    if (memory.notes.length >= MAX_NOTES)
      throw new Error(
        `Memory is full: it keeps up to ${MAX_NOTES} notes. Remove one first.`,
      );
    const note: MemoryNote = {
      id: randomUUID(),
      text,
      at: new Date().toISOString(),
      by,
    };
    const next = this.write(assistantId, {
      ...memory,
      notes: [...memory.notes, note],
    });
    return { memory: next, note, added: true };
  }

  edit(assistantId: string, noteId: unknown, raw: unknown): AssistantMemory {
    const text = cleanNoteText(raw);
    const memory = this.read(assistantId);
    if (!memory.notes.some((n) => n.id === noteId))
      throw new Error("That note is no longer here.");
    return this.write(assistantId, {
      ...memory,
      notes: memory.notes.map((n) => (n.id === noteId ? { ...n, text } : n)),
    });
  }

  remove(assistantId: string, noteId: unknown): AssistantMemory {
    const memory = this.read(assistantId);
    if (!memory.notes.some((n) => n.id === noteId)) return memory;
    return this.write(assistantId, {
      ...memory,
      notes: memory.notes.filter((n) => n.id !== noteId),
    });
  }

  setOn(assistantId: string, on: unknown): AssistantMemory {
    if (typeof on !== "boolean") throw new Error("That is not allowed.");
    return this.write(assistantId, { ...this.read(assistantId), on });
  }

  /** Puts notes back, as a backup brings them. Notes that cannot be kept are skipped. */
  restore(
    assistantId: string,
    memory: { on?: unknown; notes?: unknown },
  ): {
    added: number;
  } {
    const texts = Array.isArray(memory.notes) ? memory.notes : [];
    const notes: MemoryNote[] = [];
    for (const raw of texts.slice(0, MAX_NOTES)) {
      try {
        const text = cleanNoteText(raw);
        if (notes.some((n) => n.text.toLowerCase() === text.toLowerCase()))
          continue;
        notes.push({
          id: randomUUID(),
          text,
          at: new Date().toISOString(),
          by: "person",
        });
      } catch {
        // A note that reads like a secret, or is too long, stays out.
      }
    }
    if (notes.length === 0 && memory.on !== false) return { added: 0 };
    this.write(assistantId, { on: memory.on !== false, notes });
    return { added: notes.length };
  }

  /** Deletes an assistant's memory, as removing the assistant does. */
  forget(assistantId: string): void {
    rmSync(this.file(assistantId), { force: true });
  }
}

/** Notes from a file that may be edited by hand: anything odd is left out. */
function cleanNotes(raw: unknown): MemoryNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: MemoryNote[] = [];
  for (const item of raw.slice(0, MAX_NOTES)) {
    if (typeof item !== "object" || item === null) continue;
    const n = item as Partial<MemoryNote>;
    if (typeof n.id !== "string" || typeof n.text !== "string") continue;
    const text = n.text.trim().slice(0, MAX_NOTE_CHARS);
    if (!text) continue;
    notes.push({
      id: n.id,
      text,
      at: typeof n.at === "string" ? n.at : new Date(0).toISOString(),
      by: n.by === "assistant" ? "assistant" : "person",
    });
  }
  return notes;
}

/**
 * True once an answer has read anything from outside the chat: a file, a web
 * page, mail, a connection, the screen or another assistant's answer. Every
 * flag counts, so a kind of reading added later counts too.
 */
export function readOutside(seen: Seen): boolean {
  return Object.values(seen).some((value) => value === true);
}

export const REMEMBER_TOOL_NAME = "remember";

export const REMEMBER_TOOL: ToolSpec = {
  name: REMEMBER_TOOL_NAME,
  description: `Save one short note to your memory, for later chats: a preference or a fact the person told you. One fact a note, at most ${MAX_NOTE_CHARS} characters. Never a key, password or token.`,
  parameters: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description:
          "The note, in plain words, such as “Prefers short answers.”",
      },
    },
    required: ["note"],
  },
};

export const REMEMBER_AFTER_OUTSIDE =
  "You cannot save a note in an answer that has read a file, a web page, mail, a connection, the screen or another assistant's answer. Tell the person what you would keep; they can add it themselves in this assistant's Memory section.";

/** What the agent needs to offer `remember` in one answer. */
export interface MemoryGate {
  spec: ToolSpec;
  /**
   * Saves one note, unless the answer has read outside text or saved enough.
   * Never asks the person, and never throws.
   */
  save(
    rawArguments: string,
    outside: boolean,
  ): { result: string; step: ChatStep };
}

/** The `remember` tool for one answer of one assistant. It counts its own saves. */
export function rememberGate(
  store: Pick<MemoryStore, "add">,
  assistantId: string,
): MemoryGate {
  let saved = 0;
  return {
    spec: REMEMBER_TOOL,
    save(rawArguments, outside) {
      if (outside)
        return {
          result: REMEMBER_AFTER_OUTSIDE,
          step: {
            label: "Did not save a note after reading outside text",
            ok: false,
          },
        };
      if (saved >= MAX_REMEMBER_A_TURN)
        return {
          result: `You have already saved ${MAX_REMEMBER_A_TURN} notes in this answer. Save no more now.`,
          step: { label: "Saved enough notes for one answer", ok: false },
        };
      let note: unknown;
      try {
        const args: unknown = JSON.parse(rawArguments || "{}");
        note =
          args && typeof args === "object"
            ? (args as Record<string, unknown>).note
            : undefined;
      } catch {
        return {
          result: "The tool call was not written correctly. Try again.",
          step: { label: "Could not save a note", ok: false },
        };
      }
      try {
        const done = store.add(assistantId, note, "assistant");
        if (!done.added)
          return {
            result: "That is already in your memory.",
            step: { label: `Already remembered: ${done.note.text}`, ok: true },
          };
        saved += 1;
        return {
          result: "Saved. The person sees it in the chat and can undo it.",
          step: {
            label: `Remembered: ${done.note.text}`,
            ok: true,
            note: { id: done.note.id, text: done.note.text },
          },
        };
      } catch (error) {
        return {
          result:
            error instanceof Error ? error.message : "The note was not saved.",
          step: { label: "Did not save a note", ok: false },
        };
      }
    },
  };
}
