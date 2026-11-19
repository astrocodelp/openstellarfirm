import type { ChatMessage } from "../shared/types";

/**
 * "Save this chat": one chat as a Markdown file the person keeps. It holds the
 * assistant's name, the times, and what the person and the assistant wrote.
 * Never a key: the steps an assistant took are left out (their inputs can hold
 * one), every saved key is hidden wherever it appears, and so are the shapes
 * of the common kinds of key.
 */

const HIDDEN = "[key hidden]";

/** Known shapes of keys and tokens, so a key pasted into a chat stays out. */
const KEY_SHAPES: [RegExp, string][] = [
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, HIDDEN],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, HIDDEN],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, HIDDEN],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, HIDDEN],
  [/\bAKIA[0-9A-Z]{16}\b/g, HIDDEN],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, HIDDEN],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, `$1 ${HIDDEN}`],
  [
    /\b(api[_-]?key|access[_-]?token|secret|password|passwd)(\s*[:=]\s*)["']?[^\s"']{8,}["']?/gi,
    `$1$2${HIDDEN}`,
  ],
];

/** Takes keys out of a piece of text: the saved ones first, then known shapes. */
export function hideKeys(text: string, known: readonly string[] = []): string {
  let out = text;
  // Longest first, so a key that holds a shorter one is hidden whole.
  for (const key of [...known].sort((a, b) => b.length - a.length)) {
    if (key.length >= 8) out = out.split(key).join(HIDDEN);
  }
  for (const [shape, replacement] of KEY_SHAPES)
    out = out.replace(shape, replacement);
  return out;
}

/** Characters that would turn a name into Markdown, written as themselves. */
function plainName(name: string): string {
  return name
    .replace(/[\\`*_[\]#<>|]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A time as "2026-11-19 14:03", in the given zone or this computer's own. */
export function stamp(at: string, timeZone?: string): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return "";
  if (timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(time)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

export interface ChatMarkdownOptions {
  now: Date;
  /** The saved keys, so none is written even if it was pasted into the chat. */
  hide?: readonly string[];
  /** For tests: the zone the times are written in. This computer's by default. */
  timeZone?: string;
}

export function chatMarkdown(
  assistantName: string,
  messages: readonly ChatMessage[],
  options: ChatMarkdownOptions,
): string {
  const name = plainName(assistantName) || "Assistant";
  const when = (at: string) => stamp(at, options.timeZone);
  const shown = messages.filter((m) => typeof m.text === "string");
  const words = shown.filter((m) => m.check !== "request").length;
  const lines = [
    `# Chat with ${name}`,
    "",
    `Saved from OpenStellarFirm on ${when(options.now.toISOString())}. ${words} ${words === 1 ? "message" : "messages"}.`,
  ];
  for (const m of shown) {
    lines.push("", "---", "");
    if (m.check === "request") {
      // The app's own words to start a check; the chat shows only this line.
      lines.push(`_Started a check at ${when(m.at)}._`);
      continue;
    }
    const who = m.role === "user" ? "You" : name;
    const note = m.failed
      ? " · could not answer"
      : m.check === "update"
        ? " · check update"
        : "";
    lines.push(`**${who}** · ${when(m.at)}${note}`, "");
    lines.push(hideKeys(m.text, options.hide).trimEnd() || "_(empty)_");
  }
  return `${lines.join("\n")}\n`;
}

/** The name offered in the save dialog, such as "Trip planner chat 2026-11-19.md". */
export function chatFileName(assistantName: string, now: Date): string {
  const base =
    assistantName
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
      .trim() || "Assistant";
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${base} chat ${day}.md`;
}

/**
 * The path a save dialog gave back, with the file type's ending added when
 * the person typed none. The save dialog on Linux does not add it, as the ones
 * on macOS and Windows do. The ending is added only when no file already has
 * that name: the dialog asked before replacing the name it was given, and
 * never about the other one.
 */
export function withExtension(
  path: string,
  extension: string,
  exists: (path: string) => boolean,
): string {
  const name = path.slice(Math.max(path.lastIndexOf("/"), 0));
  if (/\.[^./\\]+$/.test(name)) return path;
  const longer = `${path}.${extension}`;
  return exists(longer) ? path : longer;
}
