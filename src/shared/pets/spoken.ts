import { PET_LIMITS } from "./limits";

/** The longest text the first cleaning step keeps, cut at a sentence. */
const MAX_SPEAK_CHARS = 1_200;

/**
 * Turns an assistant message into something worth hearing: no code blocks,
 * links or markdown marks, and a sensible length. Returns "" when nothing
 * speakable is left. (The same rules as the app's own read-aloud cleaning.)
 */
function speakableText(raw: string): string {
  let text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_SPEAK_CHARS) {
    return text;
  }
  text = text.slice(0, MAX_SPEAK_CHARS);
  const stop = Math.max(
    text.lastIndexOf(". "),
    text.lastIndexOf("! "),
    text.lastIndexOf("? "),
  );
  return (stop > MAX_SPEAK_CHARS / 2 ? text.slice(0, stop + 1) : text).trim();
}

/**
 * Words that end in a period without ending a sentence. A single capital
 * letter before a period (an initial, "J. Smith") is handled apart.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "e.g",
  "i.e",
  "vs",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "approx",
  "inc",
  "ltd",
  "u.s",
  "u.k",
  "a.m",
  "p.m",
]);

/** Bullets, rules and table bars that a voice would read as noise. */
const LIST_REMNANTS =
  /[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\u25A0\u25A1|]|(?:^|\s)(?:[-=_*~]{3,})(?=\s|$)/g;

/** Emoji, their joiners and modifiers, flags and keycaps. */
const EMOJI = new RegExp(
  [
    "\\p{Extended_Pictographic}",
    // Joiner, text and picture selectors, and the keycap mark.
    "\\u200D",
    "\\uFE0E",
    "\\uFE0F",
    "\\u20E3",
    // Skin tones, regional indicators (flags) and tag characters.
    "[\\u{1F3FB}-\\u{1F3FF}]",
    "[\\u{1F1E6}-\\u{1F1FF}]",
    "[\\u{E0020}-\\u{E007F}]",
  ].join("|"),
  "gu",
);

/** Splits text after sentence-ending punctuation, keeping the punctuation. */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  const end = /[.!?]+["'\u2019\u201D)\]]*(?=\s)/g;
  let start = 0;
  for (let match = end.exec(text); match; match = end.exec(text)) {
    const stop = match.index + match[0].length;
    const before = text.slice(start, match.index).split(/\s/).pop() ?? "";
    const word = before.replace(/^[("'\u2018\u201C[]+/, "").toLowerCase();
    const initial = /^[a-z]$/i.test(word) && match[0].startsWith(".");
    const abbreviation = match[0] === "." && ABBREVIATIONS.has(word);
    if (initial || abbreviation) {
      continue;
    }
    sentences.push(text.slice(start, stop).trim());
    start = stop;
  }
  const rest = text.slice(start).trim();
  if (rest) {
    sentences.push(rest);
  }
  return sentences;
}

/** A UTF-16 unit that starts an astral character and has no second half yet. */
const HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * The text with every half of a surrogate pair that has no other half
 * replaced (by nothing unless `replacement` says otherwise). Such a half can
 * come from a cut inside an emoji or a CJK Extension B character, or from a
 * model's own output, and `encodeURIComponent` throws on it (`toWellFormed`
 * does the same on Node 22; this runs wherever the package does).
 */
export function withoutLoneSurrogates(text: string, replacement = ""): string {
  return text.replace(LONE_SURROGATE, replacement);
}

/** Cuts at a word boundary within `max` characters and ends with a period. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  // One character is kept back for the period. A cut that lands between the
  // two halves of an astral character drops the first half too.
  let room = text.slice(0, max - 1);
  if (HIGH_SURROGATE_AT_END.test(room)) {
    room = room.slice(0, -1);
  }
  const space = room.lastIndexOf(" ");
  const cut =
    text.charAt(max - 1) === " " || space < 1 ? room : room.slice(0, space);
  const trimmed = cut.replace(/[\s,;:\u2013\u2014-]+$/u, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The part of an answer the pet says out loud: at most two sentences and 300
 * characters, with no markdown, code, links, lists or emoji. The whole answer
 * is in the pet's chat. Returns "" when nothing speakable is left.
 */
export function spokenLine(answer: string): string {
  const { spokenLineMaxChars: maxChars, spokenLineMaxSentences: maxSentences } =
    PET_LIMITS;
  // A lone half of a pair in the answer itself (not only one a cut would make)
  // goes first: the line is sent in an HTTP header and to the speech service.
  const cleaned = speakableText(withoutLoneSurrogates(answer))
    .replace(EMOJI, " ")
    .replace(LIST_REMNANTS, " ")
    .replace(/\s+/g, " ")
    // A dash set off by spaces is a pause, which a comma gives the voice.
    .replace(/ [\u2013\u2014] /g, ", ")
    // What was cut out can leave a space before a mark.
    .replace(/ +([,.;:!?)\]])/g, "$1")
    .trim();
  if (!cleaned) {
    return "";
  }
  const sentences = splitSentences(cleaned);
  let line = "";
  for (const sentence of sentences.slice(0, maxSentences)) {
    const next = line ? `${line} ${sentence}` : sentence;
    // Whole sentences only: a second one that does not fit is left out
    // rather than cut in half.
    if (line && next.length > maxChars) {
      break;
    }
    line = next;
  }
  return cutAtWord(line, maxChars);
}

const CURRENCY_SYMBOLS =
  /[$\u20AC\u00A3\u00A5\u20B9\u20BD\u20A9\u20BA\u20AA\u20AB\u0E3F\u00A2]/u;

const CURRENCY_CODES: ReadonlySet<string> = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "CNY",
  "INR",
  "RUB",
  "KRW",
  "TRY",
  "BRL",
  "MXN",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ILS",
  "THB",
  "VND",
  "SGD",
  "HKD",
  "ZAR",
  "AED",
  "SAR",
  "UAH",
  "IDR",
  "MYR",
  "PHP",
  "TWD",
  "ARS",
  "CLP",
  "COP",
  "PEN",
  "NGN",
  "EGP",
  "KES",
]);

const MONEY_WORDS: ReadonlySet<string> = new Set([
  "dollar",
  "dollars",
  "euro",
  "euros",
  "pound",
  "pounds",
  "cent",
  "cents",
  "yen",
  "yuan",
  "rupee",
  "rupees",
  "franc",
  "francs",
  "peso",
  "pesos",
  "penny",
  "pennies",
  "pence",
  "bucks",
  "quid",
  "krona",
  "kronor",
  "krone",
  "kroner",
  "zloty",
  "lira",
  "shekel",
  "shekels",
  "baht",
]);

const ARTICLES: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "your",
  "my",
  "our",
]);

const EDGE_OPENERS = /^[("'\u2018\u2019\u201C\u201D[{<]+/u;
const EDGE_CLOSERS = /[)"'\u2018\u2019\u201C\u201D\]}>.,;:!?\u2026]+$/u;

/** True when a token is, or holds, something the voice must not say. */
function isDroppedToken(token: string): boolean {
  const core = token.replace(EDGE_OPENERS, "").replace(EDGE_CLOSERS, "");
  if (!core) {
    return true;
  }
  if (core.includes("@") || core.includes("://") || core.includes("%")) {
    return true;
  }
  if (CURRENCY_SYMBOLS.test(core)) {
    return true;
  }
  if (/^www\./i.test(core)) {
    return true;
  }
  // A domain: words joined by dots that end in a top-level domain.
  if (
    /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?:[/?#]\S*)?$/u.test(core)
  ) {
    return true;
  }
  if (/\d{3,}/.test(core)) {
    return true;
  }
  // Amounts with a separator: 12.99, 1,000, 1.000,50.
  if (/^\d+(?:[.,]\d+)+\+?$/.test(core)) {
    return true;
  }
  if (CURRENCY_CODES.has(core) || MONEY_WORDS.has(core.toLowerCase())) {
    return true;
  }
  // An amount with its code stuck on: 50USD, EUR50.
  const attached = /^(?:\d[\d.,]*([A-Z]{3})|([A-Z]{3})\d[\d.,]*)$/.exec(core);
  const attachedCode = attached?.[1] ?? attached?.[2];
  return attachedCode !== undefined && CURRENCY_CODES.has(attachedCode);
}

/**
 * Everything of the answer the pet may say aloud, or nothing at all.
 *
 * The pet's lines never carry step text, an amount or a digit (rule 3), and
 * an assistant's answer is free text: "I drafted a reply to jane@acme.com for
 * the 4,200 EUR invoice 1187". So the first sentences (`spokenLine`) are
 * checked word by word, and when any word is an email address, a link, a
 * domain, a currency symbol, code or word, an amount, a percentage or holds a
 * digit, the whole line is dropped and the caller says its plain `done` line
 * instead. Dropping a word would leave a sentence that says something else
 * ("confirming the payment for invoice"), so it is all or nothing. A number
 * spelled out in words is not caught; the answer is still the owner
 * assistant's own words, and a step that waits for the owner's Approve is never
 * read out at all (the turn says `needs-approve`). Returns "" when nothing
 * speakable is left.
 */
export function spokenAnswer(answer: string): string {
  const line = spokenLine(answer);
  for (const token of line.split(/\s+/)) {
    const core = token.replace(EDGE_OPENERS, "").replace(EDGE_CLOSERS, "");
    // A bare mark or bracket is punctuation, not a word to refuse.
    if (!core) {
      continue;
    }
    if (isDroppedToken(token) || /\p{N}/u.test(core)) {
      return "";
    }
  }
  return line;
}

/**
 * What the pet says when the main assistant answered with a question card,
 * which a pet cannot show (11 November 2026: "the pet should ask the
 * questions and say to you to go to app to answer em"): the questions it may
 * read aloud, then where to answer them. Each question passes the same check
 * as an answer (`spokenAnswer`): one with a digit, an amount or an address is
 * left out, never cut. Questions are added whole while the line stays within
 * `spokenLineMaxChars`; the ending is always said, so the owner always hears
 * that the questions wait in the app.
 */
export function spokenQuestions(questions: readonly string[]): string {
  const ending =
    questions.length === 1
      ? "Open OpenStellarFirm to answer it."
      : "Open OpenStellarFirm to answer them.";
  const lead =
    questions.length === 1
      ? "I have a question for you."
      : "I have some questions for you.";
  const maxChars = PET_LIMITS.spokenLineMaxChars;
  const said: string[] = [];
  let length = ending.length;
  for (const question of questions) {
    const spoken = spokenAnswer(question);
    if (!spoken) {
      continue;
    }
    const asked = /[?]$/.test(spoken)
      ? spoken
      : `${spoken.replace(/[.!]+$/, "")}?`;
    if (length + asked.length + 1 > maxChars) {
      break;
    }
    said.push(asked);
    length += asked.length + 1;
  }
  if (said.length === 0) {
    return `${lead} ${ending}`;
  }
  return `${said.join(" ")} ${ending}`;
}

/** "Bakery" becomes "bakery"; "OpenStellarFirm", "iOS" and "API" stay as they are. */
function lowerFirstWord(word: string): string {
  return /^\p{Lu}\p{Ll}+(?:['\u2019-]\p{Ll}+)*$/u.test(word)
    ? word.charAt(0).toLowerCase() + word.slice(1)
    : word;
}

/**
 * A run's work title made safe to say aloud: at most six words, with no
 * markdown, quotes, emails, links, domains, amounts, currency, percentages or
 * long digit runs. A short digit stays ("Q3 report"). Returns `undefined`
 * when nothing is left, so the notice names the role instead.
 */
export function spokenTitle(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    // A heading or quote mark starts a line; "C#" keeps its sharp.
    .replace(/(^|\s)[#>]+/g, "$1")
    .replace(/_/g, " ")
    // Double quotes of every kind go; a single quote is an apostrophe
    // inside a word and is trimmed only at the edges of a token.
    .replace(/["\u201C\u201D\u201E\u00AB\u00BB]/g, "");
  const words: string[] = [];
  for (const token of text.split(/\s+/)) {
    if (!token || isDroppedToken(token)) {
      continue;
    }
    const word = token
      .replace(EDGE_OPENERS, "")
      .replace(/[\s'\u2018\u2019]+$/u, "");
    if (word && /[\p{L}\p{N}]/u.test(word)) {
      words.push(word);
    }
  }
  if (words.length > 0 && ARTICLES.has((words[0] ?? "").toLowerCase())) {
    words.shift();
  }
  const kept = words.slice(0, PET_LIMITS.workTitleMaxWords);
  if (kept.length === 0) {
    return undefined;
  }
  kept[0] = lowerFirstWord(kept[0] ?? "");
  const title = kept
    .join(" ")
    .replace(/[\s.,;:!?\u2026\u2013\u2014-]+$/u, "")
    .trim();
  return title || undefined;
}
