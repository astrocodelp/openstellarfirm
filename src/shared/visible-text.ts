/**
 * Text that reaches an approval card is shown as it is, with one exception:
 * characters that draw nothing, or that change how the text around them is
 * drawn, are written out as their code (such as "[U+202E]"). Otherwise a
 * right-to-left override could make a command read backwards, or a
 * zero-width character could hide a word, on the very card meant to show it.
 *
 * Shared by the main process, which builds every card, and its tests. No
 * Node or DOM imports.
 */

/** Format characters, line and paragraph separators and lone surrogates. */
const HIDDEN_CLASS = /^[\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;

/** The code points, outside those classes, that draw nothing. */
const HIDDEN_RANGES: [number, number][] = [
  // Control characters, all but a tab (0x09) and a new line (0x0a).
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  // The combining grapheme joiner, and the Hangul fillers.
  [0x034f, 0x034f],
  [0x115f, 0x1160],
  [0x3164, 0x3164],
  [0xffa0, 0xffa0],
  // Variation selectors, which can carry text no one sees.
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef],
];

function hidden(char: string): boolean {
  const point = char.codePointAt(0) ?? 0;
  return (
    HIDDEN_CLASS.test(char) ||
    HIDDEN_RANGES.some(([low, high]) => point >= low && point <= high)
  );
}

function code(char: string): string {
  const point = char.codePointAt(0) ?? 0;
  return `[U+${point.toString(16).toUpperCase().padStart(4, "0")}]`;
}

/** The text with every hidden character written out as its code. */
export function showHidden(text: string): string {
  let out = "";
  for (const char of text) out += hidden(char) ? code(char) : char;
  return out;
}

/** The text with every hidden character taken out, for names and descriptions. */
export function dropHidden(text: string): string {
  let out = "";
  for (const char of text) if (!hidden(char)) out += char;
  return out;
}

/**
 * The most a card shows. A step whose full details are longer is not shown
 * cut: it is turned down with a plain line, so nothing is ever sent that the
 * person could not read.
 */
export const MAX_CARD_CHARS = 100_000;

/** True when the text fits on a card whole, hidden characters written out. */
export function fitsCard(text: string): boolean {
  return (
    text.length <= MAX_CARD_CHARS && showHidden(text).length <= MAX_CARD_CHARS
  );
}

/**
 * A card's words with every hidden character written out: the title (which
 * holds tool, connection and assistant names), the details, the reason and
 * the site. Every card the person sees is made through this.
 */
export function cardText<
  T extends { title: string; detail: string; why: string; site?: string },
>(card: T): T {
  return {
    ...card,
    title: showHidden(card.title),
    detail: showHidden(card.detail),
    why: showHidden(card.why),
    ...(card.site === undefined ? {} : { site: showHidden(card.site) }),
  };
}
