import type { AttachmentKind } from "../shared/types";

/**
 * What a file a person attaches really is, decided from its own first bytes.
 * Never from its name, never from what the page says. A file that is none of
 * the kinds below is refused with a plain line.
 *
 * Pure: no file system, no Electron, so every rule here is tested offline.
 */

export const ATTACH_LIMITS = {
  /** Files on one message. */
  files: 10,
  /** Bytes in one file. */
  fileBytes: 20 * 1024 * 1024,
  /** Bytes in all the files of one message. */
  messageBytes: 50 * 1024 * 1024,
  /** Pages in one PDF. */
  pdfPages: 200,
  /** Pages of one PDF that may be read as pictures on this computer. */
  ocrPages: 50,
  /** Pixels in one picture, as width times height. */
  pixels: 40_000_000,
} as const;

/** The text kinds a person may attach, by the end of the file's name. */
const TEXT_ENDINGS = ["txt", "md", "csv", "json"] as const;
export type TextEnding = (typeof TEXT_ENDINGS)[number];

export interface SniffedFile {
  kind: AttachmentKind;
  /** The ending the stored copy gets, chosen here from the checked kind. */
  ext: string;
  mediaType: string;
  /** Set for a picture. */
  width?: number;
  height?: number;
}

/** A refusal the person reads as it is. */
export class AttachError extends Error {}

const NOT_ACCEPTED =
  "That kind of file cannot be attached. Attach a picture (PNG, JPEG, WebP or GIF), a PDF, or a text file (.txt, .md, .csv or .json).";

function startsWith(bytes: Uint8Array, signature: number[], at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  return signature.every((value, index) => bytes[at + index] === value);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = at; i < at + length && i < bytes.length; i += 1)
    out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function be16(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}
function be32(b: Uint8Array, at: number): number {
  return (
    ((b[at] ?? 0) * 0x1000000) |
    (((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0))
  );
}
function le16(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}
function le24(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
}

type Size = { width: number; height: number } | undefined;

function pngSize(b: Uint8Array): Size {
  // The first chunk must be IHDR, which holds the size.
  if (ascii(b, 12, 4) !== "IHDR") return undefined;
  return { width: be32(b, 16) >>> 0, height: be32(b, 20) >>> 0 };
}

function gifSize(b: Uint8Array): Size {
  return { width: le16(b, 6), height: le16(b, 8) };
}

function jpegSize(b: Uint8Array): Size {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return undefined;
    const marker = b[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers with no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = be16(b, at + 2);
    if (length < 2) return undefined;
    // Start of frame: every SOF marker but DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: be16(b, at + 5), width: be16(b, at + 7) };
    }
    at += 2 + length;
  }
  return undefined;
}

function webpSize(b: Uint8Array): Size {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // A key frame starts with 9D 01 2A, then 14-bit width and height.
    if (!startsWith(b, [0x9d, 0x01, 0x2a], 23)) return undefined;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return undefined;
    const bits =
      (b[21] ?? 0) |
      ((b[22] ?? 0) << 8) |
      ((b[23] ?? 0) << 16) |
      ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return undefined;
}

/** A picture's size from its header, so a huge one is refused before it is decoded. */
export function pictureSize(
  kind: AttachmentKind,
  bytes: Uint8Array,
): { width: number; height: number } {
  const size =
    kind === "png"
      ? pngSize(bytes)
      : kind === "jpeg"
        ? jpegSize(bytes)
        : kind === "gif"
          ? gifSize(bytes)
          : kind === "webp"
            ? webpSize(bytes)
            : undefined;
  if (!size || size.width < 1 || size.height < 1) {
    throw new AttachError("That picture could not be read. It may be damaged.");
  }
  if (size.width * size.height > ATTACH_LIMITS.pixels) {
    throw new AttachError(
      "That picture is too large. Attach one of at most 40 megapixels.",
    );
  }
  return size;
}

/** The ending of a file's name, in lower case, or "" when it has none. */
function endingOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** True for UTF-8 text with no control characters but tab, line feed and return. */
export function isPlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return false;
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

/**
 * Decides the kind of a file from its bytes. A text file is plain UTF-8 and
 * also has to be named as one of the text kinds, since any bytes could be
 * text; every other kind is decided by its signature alone.
 */
export function sniff(name: string, bytes: Uint8Array): SniffedFile {
  if (bytes.length === 0) throw new AttachError("That file is empty.");
  if (bytes.length > ATTACH_LIMITS.fileBytes) {
    throw new AttachError(
      "That file is too large. Attach one of at most 20 MB.",
    );
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return {
      kind: "png",
      ext: "png",
      mediaType: "image/png",
      ...pictureSize("png", bytes),
    };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return {
      kind: "jpeg",
      ext: "jpg",
      mediaType: "image/jpeg",
      ...pictureSize("jpeg", bytes),
    };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return {
      kind: "webp",
      ext: "webp",
      mediaType: "image/webp",
      ...pictureSize("webp", bytes),
    };
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return {
      kind: "gif",
      ext: "gif",
      mediaType: "image/gif",
      ...pictureSize("gif", bytes),
    };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") {
    return { kind: "pdf", ext: "pdf", mediaType: "application/pdf" };
  }
  const ending = endingOf(name);
  if (
    (TEXT_ENDINGS as readonly string[]).includes(ending) &&
    isPlainText(bytes)
  ) {
    return {
      kind: "text",
      ext: ending,
      mediaType: ending === "json" ? "application/json" : "text/plain",
    };
  }
  throw new AttachError(NOT_ACCEPTED);
}

/**
 * A name fit to show and to send to a model: no folders, no control
 * characters, no bidirectional overrides, and not too long.
 */
export function cleanFileName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  const base = text.split(/[\\/]/).pop() ?? "";
  const clean = base
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const short = clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
  return short || "file";
}

export function isPicture(kind: AttachmentKind): boolean {
  return kind === "png" || kind === "jpeg" || kind === "webp" || kind === "gif";
}

/** How a kind is named to the person and to the model. */
export function kindName(kind: AttachmentKind): string {
  if (kind === "pdf") return "PDF";
  if (kind === "text") return "text file";
  return "picture";
}
