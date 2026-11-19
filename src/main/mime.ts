import { htmlToText } from "./web";

/**
 * Turning one mail message into plain text, for an assistant to read.
 *
 * A message is written by someone else, so nothing in it is trusted: every
 * length is bounded, the structure is read strictly, and the result is plain
 * text only. HTML is never rendered and nothing a message links to is ever
 * fetched. Attachments are named and counted, never opened.
 */

const MAX_HEADERS = 200;
const MAX_HEADER_CHARS = 8_000;
const MAX_PARTS = 100;
const MAX_DEPTH = 5;
const MAX_TEXT_CHARS = 200_000;
const MAX_ATTACHMENTS = 50;

/** Decodes bytes with a charset name. An unknown name reads as UTF-8. */
export function decodeCharset(
  bytes: Uint8Array,
  label: string | undefined,
): string {
  const name = (label ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  const wanted = name === "" || name === "us-ascii" ? "utf-8" : name;
  try {
    return new TextDecoder(wanted).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Decodes quoted-printable. In a header, "_" is a space. */
export function decodeQuotedPrintable(input: string, header = false): Buffer {
  const text = header ? input : input.replace(/=[ \t]*\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x3d /* = */) {
      const hex = text.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(header && c === 0x5f ? 0x20 : c & 0xff);
  }
  return Buffer.from(out);
}

/** Decodes RFC 2047 words ("=?utf-8?B?...?=") inside a header value. */
export function decodeWords(value: string): string {
  const joined = value.replace(/(\?=)\s+(?==\?)/g, "$1");
  return joined.replace(
    /=\?([^?\s]{1,40})\?([bBqQ])\?([^?\s]{0,500})\?=/g,
    (whole, charset: string, kind: string, data: string) => {
      try {
        const bytes =
          kind.toLowerCase() === "b"
            ? Buffer.from(data, "base64")
            : decodeQuotedPrintable(data, true);
        return decodeCharset(bytes, charset.split("*")[0]);
      } catch {
        return whole;
      }
    },
  );
}

/** Reads a header block into names (lower case) and values, first one wins. */
export function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  let count = 0;
  for (const line of unfolded.split(/\r?\n/)) {
    if (count >= MAX_HEADERS) break;
    const at = line.indexOf(":");
    if (at < 1) continue;
    const name = line.slice(0, at).toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(name)) continue;
    count += 1;
    if (!headers.has(name))
      headers.set(name, line.slice(at + 1, at + 1 + MAX_HEADER_CHARS).trim());
  }
  return headers;
}

interface Params {
  type: string;
  params: Record<string, string>;
}

/** Reads "text/plain; charset=utf-8; name*=..." into a type and parameters. */
export function parseParams(value: string): Params {
  const semi = value.indexOf(";");
  const type = (semi < 0 ? value : value.slice(0, semi)).trim().toLowerCase();
  const raw: [string, string][] = [];
  let i = semi < 0 ? value.length : semi + 1;
  while (i < value.length && raw.length < 40) {
    while (i < value.length && /[\s;]/.test(value.charAt(i))) i += 1;
    const eq = value.indexOf("=", i);
    if (eq < 0) break;
    const key = value.slice(i, eq).trim().toLowerCase();
    i = eq + 1;
    while (i < value.length && /\s/.test(value.charAt(i))) i += 1;
    let text = "";
    if (value.charAt(i) === '"') {
      i += 1;
      while (i < value.length && value.charAt(i) !== '"') {
        if (value.charAt(i) === "\\" && i + 1 < value.length) i += 1;
        text += value.charAt(i);
        i += 1;
      }
      i += 1;
    } else {
      const end = value.indexOf(";", i);
      const stop = end < 0 ? value.length : end;
      text = value.slice(i, stop).trim();
      i = stop;
    }
    if (/^[a-z0-9*-]{1,60}$/.test(key)) raw.push([key, text]);
  }
  return { type, params: joinExtended(raw) };
}

/** Joins RFC 2231 pieces such as "filename*0*" and "filename*". */
function joinExtended(raw: [string, string][]): Record<string, string> {
  const done: Record<string, string> = {};
  const pieces = new Map<string, { n: number; v: string; enc: boolean }[]>();
  for (const [key, value] of raw) {
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (!m?.[1]) {
      if (!Object.hasOwn(done, key)) done[key] = value;
      continue;
    }
    const list = pieces.get(m[1]) ?? [];
    list.push({ n: m[2] ? Number(m[2]) : 0, v: value, enc: !m[2] || !!m[3] });
    pieces.set(m[1], list);
  }
  for (const [name, list] of pieces) {
    if (Object.hasOwn(done, name)) continue;
    list.sort((a, b) => a.n - b.n);
    let charset: string | undefined;
    const bytes: number[] = [];
    list.forEach((piece, index) => {
      let v = piece.v;
      if (piece.enc) {
        if (index === 0) {
          const m = /^([^']*)'[^']*'(.*)$/s.exec(v);
          if (m) {
            charset = m[1] || undefined;
            v = m[2] ?? "";
          }
        }
        for (let k = 0; k < v.length; k += 1) {
          const hex = v.slice(k + 1, k + 3);
          if (v.charAt(k) === "%" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
            bytes.push(Number.parseInt(hex, 16));
            k += 2;
          } else bytes.push(v.charCodeAt(k) & 0xff);
        }
      } else {
        for (let k = 0; k < v.length; k += 1)
          bytes.push(v.charCodeAt(k) & 0xff);
      }
    });
    done[name] = decodeCharset(Buffer.from(bytes), charset);
  }
  return done;
}

/** Splits a message or part into its header block and its body. */
function splitEntity(raw: Buffer): { head: string; body: Buffer } {
  const text = raw.toString("latin1");
  const crlf = text.indexOf("\r\n\r\n");
  const lf = text.indexOf("\n\n");
  let at: number;
  let gap: number;
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    at = crlf;
    gap = 4;
  } else if (lf >= 0) {
    at = lf;
    gap = 2;
  } else {
    // A part with no blank line is all headers when it starts like one.
    return /^[A-Za-z0-9-]+:/.test(text)
      ? { head: raw.toString("utf8"), body: Buffer.alloc(0) }
      : { head: "", body: raw };
  }
  return {
    head: raw.subarray(0, at).toString("utf8"),
    body: raw.subarray(at + gap),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The parts between a multipart body's boundary lines. */
function splitMultipart(body: Buffer, boundary: string): Buffer[] {
  if (!/^[\w'()+,./:=?-]{1,70}$/.test(boundary)) return [];
  const text = body.toString("latin1");
  const delimiter = new RegExp(
    `(?:^|\\r?\\n)--${escapeRegExp(boundary)}(--)?[ \\t]*(?=\\r?\\n|$)`,
    "g",
  );
  const marks: { start: number; end: number; last: boolean }[] = [];
  for (const m of text.matchAll(delimiter)) {
    marks.push({
      start: m.index,
      end: m.index + m[0].length,
      last: m[1] !== undefined,
    });
    if (marks.length > MAX_PARTS + 1) break;
  }
  const parts: Buffer[] = [];
  for (let k = 0; k < marks.length - 1 && parts.length < MAX_PARTS; k += 1) {
    const here = marks[k];
    const next = marks[k + 1];
    if (!here || !next || here.last) break;
    let from = here.end;
    if (text.startsWith("\r\n", from)) from += 2;
    else if (text.startsWith("\n", from)) from += 1;
    parts.push(Buffer.from(text.slice(from, next.start), "latin1"));
  }
  // A message cut short has no closing line: what follows the last
  // boundary is still a part.
  const tail = marks[marks.length - 1];
  if (tail && !tail.last && parts.length < MAX_PARTS && marks.length >= 1) {
    let from = tail.end;
    if (text.startsWith("\r\n", from)) from += 2;
    else if (text.startsWith("\n", from)) from += 1;
    if (from < text.length) parts.push(Buffer.from(text.slice(from), "latin1"));
  }
  return parts;
}

function decodeBody(body: Buffer, encoding: string): Buffer {
  if (encoding === "base64")
    return Buffer.from(
      body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""),
      "base64",
    );
  if (encoding === "quoted-printable")
    return decodeQuotedPrintable(body.toString("latin1"));
  return body;
}

function decodedSize(body: Buffer, encoding: string): number {
  if (encoding === "base64") {
    const clean = body.toString("latin1").replace(/[^A-Za-z0-9+/]/g, "");
    return Math.floor((clean.length * 3) / 4);
  }
  return body.length;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
}

export interface ParsedMail {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  text: string;
  attachments: Attachment[];
  /** True when the text was cut at the size limit. */
  truncated: boolean;
}

interface Collected {
  plain: string[];
  html: string[];
  attachments: Attachment[];
  parts: number;
}

function walk(raw: Buffer, depth: number, out: Collected): void {
  if (out.parts >= MAX_PARTS) return;
  out.parts += 1;
  const { head, body } = splitEntity(raw);
  const headers = parseHeaders(head);
  const ct = parseParams(headers.get("content-type") ?? "text/plain");
  const disposition = parseParams(headers.get("content-disposition") ?? "");
  const encoding = (headers.get("content-transfer-encoding") ?? "7bit")
    .trim()
    .toLowerCase();
  const type = ct.type || "text/plain";

  if (type.startsWith("multipart/") && depth < MAX_DEPTH) {
    for (const part of splitMultipart(body, ct.params.boundary ?? ""))
      walk(part, depth + 1, out);
    return;
  }

  const filename = decodeWords(
    disposition.params.filename ?? ct.params.name ?? "",
  );
  const isText = type === "text/plain" || type === "text/html";
  const attached =
    disposition.type === "attachment" ||
    !isText ||
    (filename !== "" && disposition.type !== "inline");
  if (attached) {
    if (out.attachments.length < MAX_ATTACHMENTS) {
      out.attachments.push({
        name: cleanLine(
          filename ||
            (type === "message/rfc822"
              ? "an attached message"
              : `unnamed ${type}`),
          120,
        ),
        type: cleanLine(type, 60),
        size: decodedSize(body, encoding),
      });
    }
    return;
  }
  const text = decodeCharset(decodeBody(body, encoding), ct.params.charset);
  (type === "text/html" ? out.html : out.plain).push(text);
}

/** One line of plain text: control characters become spaces, then it is cut. */
export function cleanLine(value: string, max: number): string {
  const one = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Takes control characters out of a text and keeps its line breaks. */
function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]+/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The headers of one message, decoded and on one line each. */
export function readHeaders(head: Buffer | string): {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
} {
  const headers = parseHeaders(
    typeof head === "string" ? head : head.toString("utf8"),
  );
  const value = (name: string, max: number) =>
    cleanLine(decodeWords(headers.get(name) ?? ""), max);
  return {
    from: value("from", 200),
    to: value("to", 300),
    cc: value("cc", 300),
    subject: value("subject", 300),
    date: value("date", 80),
  };
}

/** Reads a whole message into plain text and a list of attachment names. */
export function parseMessage(raw: Buffer): ParsedMail {
  const { head } = splitEntity(raw);
  const headers = readHeaders(head);
  const out: Collected = { plain: [], html: [], attachments: [], parts: 0 };
  walk(raw, 0, out);
  // The plain part is preferred; HTML is used only when there is no plain
  // text at all, and then only as text: tags are dropped, nothing is run.
  const joined =
    out.plain.join("\n\n").trim() !== ""
      ? out.plain.join("\n\n")
      : out.html.map((html) => htmlToText(html)).join("\n\n");
  let text = cleanText(joined);
  let truncated = false;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }
  return { ...headers, text, attachments: out.attachments, truncated };
}
