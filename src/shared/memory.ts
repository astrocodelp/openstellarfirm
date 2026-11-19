/**
 * An assistant's memory: short notes the person wants it to keep. The rules
 * are here so the page and the main process read them the same way; the main
 * process is the one that enforces them.
 */

export const MAX_NOTES = 100;
export const MAX_NOTE_CHARS = 500;
/** Notes the assistant itself may save in one answer. */
export const MAX_REMEMBER_A_TURN = 3;

export interface MemoryNote {
  id: string;
  text: string;
  at: string;
  /** Who wrote it: the person in the Memory section, or the assistant with `remember`. */
  by: "person" | "assistant";
}

export interface AssistantMemory {
  /** Off means no notes go into its instructions and it cannot save one. */
  on: boolean;
  notes: MemoryNote[];
}

export const SECRET_REFUSAL =
  "That looks like a key, a password or a token. Notes go to the model with every message, so keep secrets out of them.";

/**
 * A note as it is kept: one paragraph of plain text, control characters out,
 * spaces tidied. Throws a plain sentence when it cannot be kept.
 */
export function cleanNoteText(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Write the note first.");
  const text = raw
    .replace(/[^\P{Cc}\n\t]+/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  if (!text) throw new Error("Write the note first.");
  if (text.length > MAX_NOTE_CHARS)
    throw new Error(
      `Keep a note to ${MAX_NOTE_CHARS} characters. This one has ${text.length}.`,
    );
  if (looksLikeSecret(text)) throw new Error(SECRET_REFUSAL);
  return text;
}

/** Well-known shapes of keys and tokens. */
const KEY_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bhf_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
];

/** "password: hunter2", "my PIN is 4821", "api key = abc...". */
const LABELLED_SECRET =
  /\b(?:password|passcode|passphrase|pin|api[ _-]?key|access[ _-]?key|secret|token|private[ _-]?key|recovery[ _-]?code)s?\b\s*(?:is|=|:|was)\s*\S{4,}/i;

/**
 * True when a note holds what reads like a key, a password or a token. It errs
 * on the side of refusing: a long run of mixed letters and digits with no
 * spaces reads like a key even when it is not one.
 */
export function looksLikeSecret(text: string): boolean {
  if (KEY_SHAPES.some((shape) => shape.test(text))) return true;
  if (LABELLED_SECRET.test(text)) return true;
  for (const word of text.split(/\s+/)) {
    // An ordinary web address is not a key, unless it carries one after "?".
    const bare = /^https?:\/\//i.test(word) ? (word.split("?")[1] ?? "") : word;
    const run = bare.match(/[A-Za-z0-9_+/=-]{32,}/)?.[0];
    if (run && /[0-9]/.test(run) && /[A-Za-z]/.test(run)) return true;
  }
  return false;
}
