/**
 * Finding words in the chats on this computer. Pure: no Node, no DOM. The main
 * process runs it over the chat files, and the palette uses the same folding
 * to filter its own list, so "café", "Cafe" and "CAFÉ" are one word everywhere.
 */

import type { ChatMessage, SearchHit, SearchPart } from "./types";

/** The longest search the main process takes, in characters. */
export const SEARCH_QUERY_MAX = 200;
/** How many results come back unless fewer are asked for, and the most. */
export const SEARCH_LIMIT = 30;
export const SEARCH_LIMIT_MAX = 50;
/** Words after the eighth are not searched, so a pasted paragraph stays quick. */
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 64;
/** A very common word matches many messages: only the newest are ranked. */
const MAX_CANDIDATES = 2000;
/** How many places one word is marked in one message. */
const MAX_OCCURRENCES = 50;
/** The snippet: some text before the match and more after it. */
const BEFORE = 48;
const AFTER = 112;

/** Letters that do not lose their mark in NFD, written the way people type them. */
const LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
  ı: "i",
  ς: "σ",
};
const LETTER = /[ßæœøđłıς]/g;
const MARK = /\p{M}/gu;
const WORD = /[\p{L}\p{N}]/u;

function foldText(text: string): string {
  return text
    .normalize("NFD")
    .toLowerCase()
    .replace(MARK, "")
    .replace(LETTER, (letter) => LETTERS[letter] ?? letter);
}

/** Lower case, with accents and marks taken off: what a search compares. */
export function normalise(text: string): string {
  return foldText(text);
}

/** Folded text, and for each of its characters where it came from. */
interface Folded {
  text: string;
  /** The index in the original of the code point that made each character. */
  from: number[];
}

function foldWithMap(source: string): Folded {
  let text = "";
  const from: number[] = [];
  let at = 0;
  for (const point of source) {
    const code = point.charCodeAt(0);
    // Plain ASCII needs no table: most chats are mostly this.
    const folded =
      code < 0x80
        ? code >= 65 && code <= 90
          ? String.fromCharCode(code + 32)
          : point
        : foldText(point);
    for (let k = 0; k < folded.length; k++) from.push(at);
    text += folded;
    at += point.length;
  }
  return { text, from };
}

/** The words of a search, folded, without repeats, at most eight. */
export function searchTerms(query: string): string[] {
  const terms = foldText(query.slice(0, SEARCH_QUERY_MAX))
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.slice(0, MAX_TERM_LENGTH));
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

/** True when the match at [start, end) stands as a whole word. */
function wholeAt(text: string, start: number, end: number): boolean {
  const first = text[start];
  const last = text[end - 1];
  const before = isWordChar(first) ? !isWordChar(text[start - 1]) : true;
  const after = isWordChar(last) ? !isWordChar(text[end]) : true;
  return before && after;
}

interface Occurrence {
  start: number;
  end: number;
  whole: boolean;
}

function occurrences(text: string, term: string): Occurrence[] {
  const found: Occurrence[] = [];
  let from = 0;
  while (found.length < MAX_OCCURRENCES) {
    const start = text.indexOf(term, from);
    if (start < 0) break;
    const end = start + term.length;
    found.push({ start, end, whole: wholeAt(text, start, end) });
    from = start + 1;
  }
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How well a message matches, lower first. 0: the words stand whole, and more
 * than one stand together in the order typed. 1: every word stands whole.
 * 2: every word is there, some only inside a longer word. Null: a word is missing.
 */
export function matchRank(
  text: string,
  terms: string[],
): { rank: 0 | 1 | 2; found: Occurrence[][] } | null {
  if (terms.length === 0) return null;
  const folded = foldText(text);
  return rankFolded(folded, terms);
}

function rankFolded(
  folded: string,
  terms: string[],
): { rank: 0 | 1 | 2; found: Occurrence[][] } | null {
  const found: Occurrence[][] = [];
  for (const term of terms) {
    const list = occurrences(folded, term);
    if (list.length === 0) return null;
    found.push(list);
  }
  const allWhole = found.every((list) => list.some((o) => o.whole));
  if (!allWhole) return { rank: 2, found };
  if (terms.length === 1) return { rank: 0, found };
  const phrase = new RegExp(
    `(?<![\\p{L}\\p{N}])${terms.map(escapeRegExp).join("\\s+")}(?![\\p{L}\\p{N}])`,
    "u",
  );
  return { rank: phrase.test(folded) ? 0 : 1, found };
}

/** The length, in UTF-16 units, of the code point that starts at `at`. */
function pointLength(source: string, at: number): number {
  const code = source.codePointAt(at);
  return code !== undefined && code > 0xffff ? 2 : 1;
}

/**
 * A short piece of the message around the first match, as plain parts with the
 * matched words marked. Whitespace is folded to single spaces. Never HTML.
 */
export function snippet(source: string, terms: string[]): SearchPart[] {
  const { text, from } = foldWithMap(source);
  const ranked = rankFolded(text, terms);
  if (!ranked)
    return [{ text: collapse(source.slice(0, AFTER)), match: false }];
  const first = ranked.found[0] ?? [];
  const anchor = first.find((o) => o.whole) ?? first[0];
  const toOriginal = (o: Occurrence): [number, number] => {
    const start = from[o.start] ?? 0;
    const lastFrom = from[o.end - 1] ?? start;
    return [start, lastFrom + pointLength(source, lastFrom)];
  };
  const [anchorStart] = anchor ? toOriginal(anchor) : [0];

  // The window, moved to the nearest spaces so no word is cut in half.
  let start = Math.max(0, anchorStart - BEFORE);
  let end = Math.min(source.length, anchorStart + AFTER);
  if (start > 0) {
    const space = source.slice(start, anchorStart).search(/\s/);
    if (space >= 0) start += space + 1;
  }
  if (end < source.length) {
    const tail = source.slice(anchorStart, end);
    const space = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf("\n"));
    if (space > 0) end = anchorStart + space;
  }

  // Every match in the window, clipped to it, overlapping ones merged.
  const marks = ranked.found
    .flat()
    .map(toOriginal)
    .filter(([s, e]) => e > start && s < end)
    .map(([s, e]): [number, number] => [Math.max(s, start), Math.min(e, end)])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
    else merged.push([mark[0], mark[1]]);
  }

  const parts: SearchPart[] = [];
  let at = start;
  for (const [s, e] of merged) {
    if (s > at) parts.push({ text: source.slice(at, s), match: false });
    parts.push({ text: source.slice(s, e), match: true });
    at = e;
  }
  if (at < end) parts.push({ text: source.slice(at, end), match: false });
  if (start > 0) parts.unshift({ text: "…", match: false });
  if (end < source.length) parts.push({ text: "…", match: false });

  const cleaned = parts.map((part) => ({ ...part, text: collapse(part.text) }));
  const head = cleaned[0];
  if (head) head.text = head.text.trimStart();
  const tail = cleaned[cleaned.length - 1];
  if (tail) tail.text = tail.text.trimEnd();
  return cleaned.filter((part) => part.text.length > 0);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

export interface ChatToSearch {
  assistantId: string;
  messages: ChatMessage[];
}

/**
 * Searches every chat. All words must be in a message. Better matches come
 * first (see `matchRank`), newest first within the same rank. The app's own
 * request to start a check is not searched: the chat shows it only as a line.
 */
export function searchChats(
  chats: ChatToSearch[],
  query: string,
  limit = SEARCH_LIMIT,
): SearchHit[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const max = Math.min(Math.max(1, Math.floor(limit)), SEARCH_LIMIT_MAX);

  // A quick pass with the plain folded text finds the messages that hold every
  // word. Only those are ranked, newest first, up to a cap.
  const candidates: { assistantId: string; message: ChatMessage }[] = [];
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.check === "request" || typeof message.text !== "string")
        continue;
      const folded = foldText(message.text);
      if (terms.every((term) => folded.includes(term)))
        candidates.push({ assistantId: chat.assistantId, message });
    }
  }
  candidates.sort((a, b) => time(b.message.at) - time(a.message.at));

  const ranked: { rank: number; at: number; hit: SearchHit }[] = [];
  for (const { assistantId, message } of candidates.slice(0, MAX_CANDIDATES)) {
    const match = matchRank(message.text, terms);
    if (!match) continue;
    ranked.push({
      rank: match.rank,
      at: time(message.at),
      hit: {
        assistantId,
        messageId: message.id,
        role: message.role,
        at: message.at,
        parts: [],
      },
    });
  }
  ranked.sort((a, b) => a.rank - b.rank || b.at - a.at);

  // The snippet is built only for what is shown.
  const shown = ranked.slice(0, max);
  const byId = new Map(candidates.map((c) => [c.message.id, c.message]));
  for (const entry of shown) {
    const message = byId.get(entry.hit.messageId);
    if (message) entry.hit.parts = snippet(message.text, terms);
  }
  return shown.map((entry) => entry.hit);
}

function time(at: string): number {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
}
