import {
  MAX_FILE_TEXT,
  type PdfText,
  pdfTextBlock,
  pictureTextBlock,
  textFileBlock,
  withinBudget,
} from "../shared/reading";
import type { AttachmentRef, ChatMessage, Wire } from "../shared/types";
import type { LoadedFile } from "./attachments";
import { ATTACH_LIMITS, isPicture, kindName } from "./file-kind";
import type { FilePart, ImagePart, WireMessage } from "./wires/common";

/**
 * How the files of a message reach the model.
 *
 * Native first: a picture goes as a picture, and a PDF goes as a document to
 * a service that takes one (Anthropic, Gemini). Otherwise, or once a service
 * has refused, the file is read on this computer and sent as text, marked
 * plainly. Everything from a file is information, never instructions.
 *
 * Only the message the person sends carries its files. Earlier messages name
 * theirs in one line, so a long chat never sends every file again.
 */

/**
 * Anthropic's limits for PDFs, from
 * https://platform.claude.com/docs/en/build-with-claude/pdf-support (read 19
 * November 2026): a request may be up to 128 MB on Anthropic's own API but
 * less on other platforms, and may hold 600 pages, or 100 when the model's
 * context window is under 1M tokens. The app keeps under the smaller of each:
 * 100 pages, and 24 MB of PDF, which is 32 MB once written as base64.
 */
export const ANTHROPIC_PDF = { pages: 100, bytes: 24 * 1024 * 1024 } as const;

/**
 * Gemini's limits for a PDF sent inline, from
 * https://aistudio.google.com/docs/document-processing (read 19 November
 * 2026): up to 50 MB and 1,000 pages a file. Every file the app takes is
 * smaller than that, so the totals here only guard the whole message.
 */
export const GEMINI_PDF = { pages: 1000, bytes: 50 * 1024 * 1024 } as const;

/** A user message with what the files used of the text budget. */
export type UserMessage = Extract<WireMessage, { role: "user" }> & {
  /** Characters of file text already in `content`. */
  fileText?: number;
};

/** What the files need from the rest of the app: the reader and the picture encoder. */
export interface FileReaders {
  /** A PDF's text, page by page, with scanned pages read on this computer. */
  pdfText(bytes: Uint8Array): Promise<PdfText>;
  /** The text in a picture, read on this computer. */
  ocr(bytes: Uint8Array, mediaType: string): Promise<string>;
  /** A picture scaled and encoded again for a model, with its metadata dropped. */
  picture(file: LoadedFile): Promise<ImagePart>;
}

export interface SendOptions {
  wire: Wire;
  /** False once this model has refused a picture in this run of the app. */
  pictures: boolean;
  /** False once this model has refused a PDF in this run of the app. */
  pdfs: boolean;
}

/** One line that names the files of an earlier message, instead of their bytes. */
export function namesLine(refs: readonly AttachmentRef[]): string {
  const list = refs.map((r) => `"${r.name}" (${kindName(r.kind)})`).join(", ");
  return `[The person attached ${refs.length === 1 ? "a file" : "files"} to this message: ${list}. ${refs.length === 1 ? "It was" : "They were"} sent with it then and ${refs.length === 1 ? "is" : "are"} not sent again.]`;
}

/** The text of a chat message as history: an earlier message names its files. */
export function historyText(message: ChatMessage): string {
  const refs = message.attachments ?? [];
  if (refs.length === 0) return message.text;
  return message.text
    ? `${message.text}\n\n${namesLine(refs)}`
    : namesLine(refs);
}

function errorLine(file: AttachmentRef, error: unknown): string {
  const why =
    error instanceof Error && error.message
      ? error.message
      : "It could not be read.";
  return `[The ${kindName(file.kind)} "${file.name}" could not be read on this computer: ${why}]`;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/** Whether a PDF may go to this wire as a document, given what is already going. */
function nativePdf(
  options: SendOptions,
  file: LoadedFile,
  sent: { pages: number; bytes: number },
): boolean {
  if (!options.pdfs) return false;
  const limit =
    options.wire === "anthropic"
      ? ANTHROPIC_PDF
      : options.wire === "gemini"
        ? GEMINI_PDF
        : undefined;
  if (!limit) return false;
  const pages = file.pages ?? ATTACH_LIMITS.pdfPages;
  return (
    sent.pages + pages <= limit.pages &&
    sent.bytes + file.bytes.length <= limit.bytes
  );
}

/** Builds the person's message with its files, native where the model allows. */
export async function messageWithFiles(
  text: string,
  files: readonly LoadedFile[],
  options: SendOptions,
  readers: FileReaders,
): Promise<UserMessage> {
  const blocks: string[] = [];
  const parts: FilePart[] = [];
  let used = 0;
  const sent = { pages: 0, bytes: 0 };
  const addText = (name: string, block: string) => {
    const kept = withinBudget(block, MAX_FILE_TEXT - used, name);
    used += kept.used;
    blocks.push(kept.text);
  };
  for (const file of files) {
    try {
      if (file.kind === "text") {
        addText(file.name, textFileBlock(file.name, decodeText(file.bytes)));
      } else if (file.kind === "pdf") {
        if (nativePdf(options, file, sent)) {
          sent.pages += file.pages ?? 0;
          sent.bytes += file.bytes.length;
          parts.push({
            type: "pdf",
            name: file.name,
            data: Buffer.from(file.bytes).toString("base64"),
          });
        } else {
          const pdf = await readers.pdfText(file.bytes);
          addText(file.name, pdfTextBlock(file.name, pdf));
        }
      } else if (isPicture(file.kind)) {
        const image = await readers.picture(file);
        if (options.pictures) {
          parts.push({ type: "image", name: file.name, ...image });
        } else {
          const read = await readers.ocr(
            Buffer.from(image.data, "base64"),
            image.mediaType,
          );
          addText(file.name, pictureTextBlock(file.name, read));
        }
      }
    } catch (error) {
      blocks.push(errorLine(file, error));
    }
  }
  const content = [text, ...blocks].filter((b) => b.length > 0).join("\n\n");
  return {
    role: "user",
    content,
    ...(parts.length > 0 ? { files: parts } : {}),
    ...(used > 0 ? { fileText: used } : {}),
  };
}

/**
 * After a service refused a request that carried files, turns the files of
 * one kind into text read on this computer. PDFs go first, since a size limit
 * is the likelier cause; pictures next. Returns the kind it changed, if any.
 */
export async function filesToText(
  messages: WireMessage[],
  readers: Pick<FileReaders, "pdfText" | "ocr">,
): Promise<"pdf" | "picture" | undefined> {
  for (const kind of ["pdf", "picture"] as const) {
    const type = kind === "pdf" ? "pdf" : "image";
    let changed = false;
    for (const message of messages) {
      if (message.role !== "user" || !message.files) continue;
      const user = message as UserMessage;
      const keep: FilePart[] = [];
      const blocks: string[] = [];
      let used = user.fileText ?? 0;
      for (const part of user.files ?? []) {
        if (part.type !== type) {
          keep.push(part);
          continue;
        }
        changed = true;
        const bytes = Buffer.from(part.data, "base64");
        let block: string;
        try {
          block =
            part.type === "pdf"
              ? pdfTextBlock(part.name, await readers.pdfText(bytes))
              : pictureTextBlock(
                  part.name,
                  await readers.ocr(bytes, part.mediaType),
                );
        } catch (error) {
          blocks.push(
            errorLine(
              {
                id: "",
                name: part.name,
                kind: part.type === "pdf" ? "pdf" : "png",
                size: 0,
              },
              error,
            ),
          );
          continue;
        }
        const kept = withinBudget(block, MAX_FILE_TEXT - used, part.name);
        used += kept.used;
        blocks.push(kept.text);
      }
      if (blocks.length === 0 && keep.length === user.files?.length) continue;
      user.content = [user.content, ...blocks]
        .filter((b) => b.length > 0)
        .join("\n\n");
      if (keep.length > 0) user.files = keep;
      else delete user.files;
      if (used > 0) user.fileText = used;
    }
    if (changed) return kind;
  }
  return undefined;
}

/** True when a request carries any file sent natively. */
export function carriesFiles(messages: readonly WireMessage[]): boolean {
  return messages.some((m) => m.role === "user" && (m.files?.length ?? 0) > 0);
}

/**
 * True when a service's refusal is plainly about tools, not files, so the
 * files are left as they are and the tool fallback runs instead.
 */
export function refusedForTools(message: string): boolean {
  return (
    /\btools?\b|function/i.test(message) &&
    !/image|vision|picture|pdf|document|multimodal|file|media/i.test(message)
  );
}
