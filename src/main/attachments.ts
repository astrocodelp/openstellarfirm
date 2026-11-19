import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ID } from "../shared/assistant-file";
import type {
  AttachmentKind,
  AttachmentRef,
  ChatMessage,
  PendingAttachment,
} from "../shared/types";
import {
  ATTACH_LIMITS,
  AttachError,
  cleanFileName,
  type SniffedFile,
  sniff,
} from "./file-kind";

/**
 * Files a person attaches to a message.
 *
 * A file waits in memory, checked, until its message is sent; then its bytes
 * are copied into the app's data folder, at `attachments/<assistant>/<id>.<ext>`,
 * where the chat can show it and open it. The ending comes from the kind the
 * bytes proved, never from the name. Every path is built here from an id this
 * code made and checks, so nothing from the page ever names a file.
 */

const ATTACHMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENDINGS: Record<AttachmentKind, readonly string[]> = {
  png: ["png"],
  jpeg: ["jpg"],
  webp: ["webp"],
  gif: ["gif"],
  pdf: ["pdf"],
  text: ["txt", "md", "csv", "json"],
};

export function isAttachmentId(id: unknown): id is string {
  return typeof id === "string" && ATTACHMENT_ID.test(id);
}

/**
 * The bytes of a file the page read from a drop or a paste. The page hands
 * over bytes, never a path: anything but a byte array is refused.
 */
export function pageBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new AttachError("That is not allowed.");
  if (value.length > ATTACH_LIMITS.fileBytes)
    throw new AttachError(
      "That file is too large. Attach one of at most 20 MB.",
    );
  return value;
}

/** The ids of waiting files a message names. Only ids are taken from the page. */
export function attachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > ATTACH_LIMITS.files ||
    !value.every(isAttachmentId)
  )
    throw new Error("That is not allowed.");
  return value;
}

/** What the checks need besides the bytes: a PDF's pages and a small preview. */
export interface AttachInspector {
  /** How many pages a PDF has. Throws when it cannot be read. */
  pdfPages(bytes: Uint8Array): Promise<number>;
  /** A small picture as a data URL, made from checked bytes. */
  preview?(file: SniffedFile, bytes: Uint8Array): Promise<string | undefined>;
}

export interface WaitingFile extends PendingAttachment {
  ext: string;
  mediaType: string;
  sha256: string;
  bytes: Uint8Array;
}

/** A stored file, read back for sending. */
export interface LoadedFile extends AttachmentRef {
  mediaType: string;
  bytes: Uint8Array;
}

const MEDIA: Record<AttachmentKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  text: "text/plain",
};

/** The files of one assistant's box, by assistant, and the folder they go to. */
export class Attachments {
  private readonly waiting = new Map<string, WaitingFile[]>();

  constructor(
    private readonly dataDir: string,
    private readonly inspector: AttachInspector,
  ) {}

  /** The folder every assistant's files are kept in. */
  get root(): string {
    return join(this.dataDir, "attachments");
  }

  private folderOf(assistantId: string): string {
    if (!ID.test(assistantId))
      throw new Error("That assistant is no longer here.");
    return join(this.root, assistantId);
  }

  /** The stored file for an id, or undefined when there is none. */
  fileOf(assistantId: string, id: string): string | undefined {
    if (!isAttachmentId(id)) return undefined;
    const folder = this.folderOf(assistantId);
    if (!existsSync(folder)) return undefined;
    const name = readdirSync(folder).find(
      (entry) =>
        entry.startsWith(`${id}.`) &&
        Object.values(ENDINGS).some((list) =>
          list.includes(entry.slice(id.length + 1)),
        ),
    );
    return name ? join(folder, name) : undefined;
  }

  pending(assistantId: string): PendingAttachment[] {
    return (this.waiting.get(assistantId) ?? []).map(publicOf);
  }

  /** Checks one file and puts it in the box. The bytes decide what it is. */
  async add(
    assistantId: string,
    rawName: unknown,
    bytes: Uint8Array,
  ): Promise<PendingAttachment> {
    this.folderOf(assistantId);
    const name = cleanFileName(rawName);
    const list = this.waiting.get(assistantId) ?? [];
    if (list.length >= ATTACH_LIMITS.files) {
      throw new AttachError(
        `A message can carry up to ${ATTACH_LIMITS.files} files.`,
      );
    }
    const sniffed = sniff(name, bytes);
    const total = list.reduce((sum, f) => sum + f.size, 0) + bytes.length;
    if (total > ATTACH_LIMITS.messageBytes) {
      throw new AttachError(
        "The files on one message can add up to at most 50 MB.",
      );
    }
    let pages: number | undefined;
    if (sniffed.kind === "pdf") {
      try {
        pages = await this.inspector.pdfPages(bytes);
      } catch (error) {
        throw error instanceof AttachError
          ? error
          : new AttachError(
              "That PDF could not be read. It may be damaged or locked.",
            );
      }
      if (pages > ATTACH_LIMITS.pdfPages) {
        throw new AttachError(
          `That PDF has ${pages} pages. Attach one of at most ${ATTACH_LIMITS.pdfPages}.`,
        );
      }
    }
    let preview: string | undefined;
    try {
      preview = await this.inspector.preview?.(sniffed, bytes);
    } catch {
      // A file with no preview is still a file.
    }
    const file: WaitingFile = {
      id: randomUUID(),
      name,
      kind: sniffed.kind,
      size: bytes.length,
      ext: sniffed.ext,
      mediaType: sniffed.mediaType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: Uint8Array.from(bytes),
      ...(pages !== undefined ? { pages } : {}),
      ...(preview ? { preview } : {}),
    };
    // Read again: another file may have been added while this one was checked.
    const now = this.waiting.get(assistantId) ?? [];
    if (now.length >= ATTACH_LIMITS.files) {
      throw new AttachError(
        `A message can carry up to ${ATTACH_LIMITS.files} files.`,
      );
    }
    if (
      now.reduce((sum, f) => sum + f.size, 0) + file.size >
      ATTACH_LIMITS.messageBytes
    ) {
      throw new AttachError(
        "The files on one message can add up to at most 50 MB.",
      );
    }
    this.waiting.set(assistantId, [...now, file]);
    return publicOf(file);
  }

  remove(assistantId: string, id: string): void {
    const list = this.waiting.get(assistantId);
    if (!list) return;
    this.waiting.set(
      assistantId,
      list.filter((f) => f.id !== id),
    );
  }

  /** Forgets the box of one assistant, or of every assistant. */
  clearWaiting(assistantId?: string): void {
    if (assistantId) this.waiting.delete(assistantId);
    else this.waiting.clear();
  }

  /**
   * Takes the named files out of the box and writes them to the data folder.
   * An id that is not waiting for this assistant is refused, so the page can
   * only send files it was given back.
   */
  commit(assistantId: string, ids: readonly string[]): AttachmentRef[] {
    const folder = this.folderOf(assistantId);
    const list = this.waiting.get(assistantId) ?? [];
    const unique = [...new Set(ids)];
    if (unique.length > ATTACH_LIMITS.files) {
      throw new AttachError(
        `A message can carry up to ${ATTACH_LIMITS.files} files.`,
      );
    }
    const picked = unique.map((id) => {
      const found = list.find((f) => f.id === id);
      if (!found)
        throw new Error("A file is no longer waiting. Attach it again.");
      return found;
    });
    if (picked.length === 0) return [];
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    for (const file of picked) {
      const target = join(folder, `${file.id}.${file.ext}`);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, file.bytes, { mode: 0o600 });
      renameSync(temp, target);
    }
    this.waiting.set(
      assistantId,
      list.filter((f) => !unique.includes(f.id)),
    );
    return picked.map(({ id, name, kind, size, pages, sha256 }) => ({
      id,
      name,
      kind,
      size,
      sha256,
      ...(pages !== undefined ? { pages } : {}),
    }));
  }

  /** Reads a sent file back for the model. Undefined when it is gone. */
  load(assistantId: string, ref: AttachmentRef): LoadedFile | undefined {
    const file = this.fileOf(assistantId, ref.id);
    if (!file) return undefined;
    const bytes = new Uint8Array(readFileSync(file));
    return {
      ...ref,
      mediaType: MEDIA[ref.kind],
      bytes,
    };
  }
}

function publicOf(file: WaitingFile): PendingAttachment {
  const { id, name, kind, size, pages, preview } = file;
  return {
    id,
    name,
    kind,
    size,
    ...(pages !== undefined ? { pages } : {}),
    ...(preview ? { preview } : {}),
  };
}

/** Removes the stored files of one assistant. */
export function removeAssistantFiles(
  dataDir: string,
  assistantId: string,
): void {
  if (!ID.test(assistantId)) return;
  rmSync(join(dataDir, "attachments", assistantId), {
    recursive: true,
    force: true,
  });
}

/** Removes every stored file of every assistant. */
export function removeAllFiles(dataDir: string): void {
  rmSync(join(dataDir, "attachments"), { recursive: true, force: true });
}

/** Removes the stored files of the given ids for one assistant. */
export function removeFiles(
  dataDir: string,
  assistantId: string,
  ids: readonly string[],
): void {
  if (!ID.test(assistantId) || ids.length === 0) return;
  const folder = join(dataDir, "attachments", assistantId);
  if (!existsSync(folder)) return;
  const gone = new Set(ids.filter(isAttachmentId));
  for (const entry of readdirSync(folder)) {
    const id = entry.split(".")[0] ?? "";
    if (gone.has(id)) rmSync(join(folder, entry), { force: true });
  }
}

/** The ids of every file a chat still shows. */
export function referencedIds(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages)
    for (const ref of message.attachments ?? []) ids.add(ref.id);
  return ids;
}

/**
 * Removes stored files no chat refers to any more: left behind by a crash,
 * by an assistant that is gone, or by a half-written copy.
 */
export function sweepFiles(
  dataDir: string,
  chats: (assistantId: string) => readonly ChatMessage[] | undefined,
): number {
  const root = join(dataDir, "attachments");
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const assistantId of readdirSync(root)) {
    const folder = join(root, assistantId);
    const messages = ID.test(assistantId) ? chats(assistantId) : undefined;
    if (!messages) {
      rmSync(folder, { recursive: true, force: true });
      removed += 1;
      continue;
    }
    const keep = referencedIds(messages);
    for (const entry of readdirSync(folder)) {
      const id = entry.split(".")[0] ?? "";
      if (!keep.has(id) || entry.endsWith(".tmp")) {
        rmSync(join(folder, entry), { recursive: true, force: true });
        removed += 1;
      }
    }
  }
  return removed;
}
