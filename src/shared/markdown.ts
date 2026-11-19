/**
 * A small, safe subset of Markdown, read into plain data. A model writes the
 * text, so nothing here ever becomes HTML: the page draws these nodes as its
 * own elements, and anything that is not in the subset stays text.
 *
 * Blocks: paragraphs (single line breaks kept), headings (drawn as a bold
 * line), fenced code, bullet and numbered lists (nested by indent), task list
 * items ("- [ ]" and "- [x]"), tables in GitHub's pipe form, quotes and
 * rules. Inline: bold, italic, code and links. A link is kept only when its
 * address is http or https; any other address leaves only its words.
 *
 * While an answer is still being written (`streaming`), a mark that has not
 * been closed yet is read as closed at the end of its block, so `**` never
 * shows for a moment and then vanishes.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; children: Inline[] }
  | { type: "code"; lang: string; text: string }
  | {
      type: "list";
      ordered: boolean;
      start: number;
      items: Block[][];
      /**
       * For a task list, whether each item is ticked; null for an item that
       * is not a task. Missing when no item is one.
       */
      checks?: (boolean | null)[];
    }
  | {
      type: "table";
      /** How each column lines up; null when the dashes say nothing. */
      align: (Align | null)[];
      head: Inline[][];
      rows: Inline[][][];
    }
  | { type: "quote"; children: Block[] }
  | { type: "rule" };

export type Align = "left" | "center" | "right";

export interface ParseOptions {
  /** True while the text is still arriving. */
  streaming?: boolean;
}

/** The longest text read as Markdown; past it the rest is one paragraph. */
const MAX_CHARS = 200_000;
/** How deep lists and quotes may nest before the rest is read as text. */
const MAX_DEPTH = 8;
/** A table wider or longer than this keeps only its first columns and rows. */
export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_ROWS = 500;

/**
 * The address a link may open, or undefined. Only http and https, with no
 * name or password in it; spaces and control characters are refused.
 */
export function safeHref(raw: string): string | undefined {
  const value = raw.trim().replace(/^<(.*)>$/, "$1");
  if (!value || value.length > 2048) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  if (!url.hostname) return undefined;
  return url.href;
}

/** The host a link goes to, as the confirm names it. */
export function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

/* ------------------------------------------------------------------------ */
/* Blocks                                                                   */
/* ------------------------------------------------------------------------ */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}#{1,6}(?:\s+(.*?))?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
/** A task list item's box, at the start of its text: "[ ] ", "[x] ". */
const TASK = /^\[([ xX])\](?:\s+|$)/;
/** One cell of a table's dashed line: "---", ":--", "--:" or ":-:". */
const DELIMITER_CELL = /^:?-+:?$/;

interface ItemLine {
  indent: number;
  ordered: boolean;
  /** The marker's own character: "-", "*", "+", "." or ")". */
  kind: string;
  number: number;
  /** Where the item's text starts, in columns. */
  content: number;
  text: string;
}

function columns(spaces: string): number {
  let n = 0;
  for (const c of spaces) n += c === "\t" ? 4 - (n % 4) : 1;
  return n;
}

function itemLine(line: string): ItemLine | undefined {
  const m = ITEM.exec(line);
  if (!m) return undefined;
  const [, lead = "", marker = "", gap = "", text = ""] = m;
  // "* * *" and "- - -" are rules, not items.
  if (RULE.test(line)) return undefined;
  const ordered = /\d/.test(marker);
  const indent = columns(lead);
  return {
    indent,
    ordered,
    kind: ordered ? marker.slice(-1) : marker,
    number: ordered ? Number.parseInt(marker, 10) : 1,
    content: indent + marker.length + Math.min(Math.max(columns(gap), 1), 4),
    text,
  };
}

function blank(line: string): boolean {
  return line.trim() === "";
}

/** Takes up to `n` columns of leading space off a line. */
function dedent(line: string, n: number): string {
  let cols = 0;
  let i = 0;
  while (i < line.length && cols < n) {
    const c = line[i];
    if (c === " ") cols += 1;
    else if (c === "\t") cols += 4 - (cols % 4);
    else break;
    i += 1;
  }
  return line.slice(i);
}

function leading(line: string): number {
  return columns(/^\s*/.exec(line)?.[0] ?? "");
}

/**
 * A table row's cells, split at each "|" that is not escaped and not in a
 * code span. The pipes at the very start and end are optional.
 */
function cells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && text[i + 1] === "|") {
      // An escaped pipe is a pipe in the cell's words.
      cell += "\\|";
      i += 2;
      continue;
    }
    if (c === "`") {
      const span = codeSpanEnd(text, i);
      if (span.end !== -1) {
        cell += text.slice(i, span.end + span.run);
        i = span.end + span.run;
        continue;
      }
    }
    if (c === "|") {
      out.push(cell.trim());
      cell = "";
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  out.push(cell.trim());
  return out;
}

/** The columns' alignment when `line` is a table's dashed line, else undefined. */
function delimiterRow(line: string): (Align | null)[] | undefined {
  if (!line.includes("-") || !/^[\s|:-]+$/.test(line)) return undefined;
  const parts = cells(line);
  if (parts.length === 0 || !parts.every((p) => DELIMITER_CELL.test(p)))
    return undefined;
  // A line of dashes with no pipe at all is a rule or a heading's underline.
  if (!line.includes("|") && parts.length === 1) return undefined;
  return parts.map((p) =>
    p.startsWith(":") && p.endsWith(":")
      ? "center"
      : p.endsWith(":")
        ? "right"
        : p.startsWith(":")
          ? "left"
          : null,
  );
}

/** True when `line` and the one after it start a table. */
function startsTable(line: string, next: string | undefined): boolean {
  if (next === undefined || !line.includes("|")) return false;
  const align = delimiterRow(next);
  return align !== undefined && cells(line).length === align.length;
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    itemLine(line) !== undefined
  );
}

function parseLines(
  lines: string[],
  options: ParseOptions,
  depth: number,
): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1] ?? "```";
      const body: string[] = [];
      const indent = leading(line);
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(next);
        if (
          close?.[1] &&
          close[1][0] === mark[0] &&
          close[1].length >= mark.length
        ) {
          i += 1;
          break;
        }
        body.push(dedent(next, indent));
        i += 1;
      }
      blocks.push({
        type: "code",
        lang: fence[2] ?? "",
        text: body.join("\n"),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = (heading[1] ?? "").replace(/\s+#+\s*$/, "");
      blocks.push({ type: "heading", children: parseInline(text, options) });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (startsTable(line, lines[i + 1])) {
      const align = (delimiterRow(lines[i + 1] ?? "") ?? []).slice(
        0,
        MAX_TABLE_COLUMNS,
      );
      const width = align.length;
      const row = (text: string): Inline[][] => {
        const parts = cells(text).slice(0, width);
        while (parts.length < width) parts.push("");
        return parts.map((part) => parseInline(part, options));
      };
      const head = row(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (blank(next) || (startsBlock(next) && !next.includes("|"))) break;
        if (rows.length < MAX_TABLE_ROWS) rows.push(row(next));
        i += 1;
      }
      blocks.push({ type: "table", align, head, rows });
      continue;
    }

    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] ?? "");
        if (!q) break;
        inner.push(q[1] ?? "");
        i += 1;
      }
      blocks.push({
        type: "quote",
        children: parseLines(inner, options, depth + 1),
      });
      continue;
    }

    const first = itemLine(line);
    if (first && depth < MAX_DEPTH) {
      const items: Block[][] = [];
      const checks: (boolean | null)[] = [];
      while (i < lines.length) {
        const head = itemLine(lines[i] ?? "");
        if (
          !head ||
          head.indent > first.indent + 3 ||
          head.ordered !== first.ordered ||
          head.kind !== first.kind
        )
          break;
        // "[ ] " or "[x] " at the start of an unordered item makes it a task.
        const task = head.ordered ? null : TASK.exec(head.text);
        checks.push(task ? task[1] !== " " : null);
        const body = [task ? head.text.slice(task[0].length) : head.text];
        i += 1;
        // The item goes on while lines are indented under its text, and over
        // blank lines when something indented follows them.
        while (i < lines.length) {
          const next = lines[i] ?? "";
          if (blank(next)) {
            const after = lines.slice(i + 1).find((l) => !blank(l));
            if (after !== undefined && leading(after) >= head.content) {
              body.push("");
              i += 1;
              continue;
            }
            break;
          }
          const nested = itemLine(next);
          if (
            leading(next) >= head.content ||
            (nested && nested.indent > head.indent)
          ) {
            body.push(dedent(next, Math.min(head.content, leading(next))));
            i += 1;
            continue;
          }
          if (nested || startsBlock(next)) break;
          // A line that just goes on, with no indent: the same paragraph.
          body.push(next);
          i += 1;
        }
        items.push(parseLines(body, options, depth + 1));
        // A blank line between items keeps the list going.
        while (i < lines.length && blank(lines[i] ?? "")) {
          const after = lines.slice(i).find((l) => !blank(l));
          const more = after === undefined ? undefined : itemLine(after);
          if (
            !more ||
            more.indent > first.indent + 3 ||
            more.ordered !== first.ordered ||
            more.kind !== first.kind
          )
            break;
          i += 1;
        }
      }
      blocks.push({
        type: "list",
        ordered: first.ordered,
        start: first.number,
        items,
        ...(checks.some((c) => c !== null) ? { checks } : {}),
      });
      continue;
    }

    // A paragraph: its lines until a blank one or another block.
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (blank(next) || startsBlock(next) || startsTable(next, lines[i + 1]))
        break;
      para.push(next.trim());
      i += 1;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(para.join("\n"), options),
    });
  }
  return blocks;
}

/** Reads Markdown text into blocks. */
export function parseMarkdown(
  text: string,
  options: ParseOptions = {},
): Block[] {
  const source = text.replace(/\r\n?/g, "\n");
  if (source.length > MAX_CHARS) {
    return [
      {
        type: "paragraph",
        children: withBreaks(source),
      },
    ];
  }
  return parseLines(source.split("\n"), options, 0);
}

/* ------------------------------------------------------------------------ */
/* Inline                                                                   */
/* ------------------------------------------------------------------------ */

const ESCAPABLE = "\\`*_{}[]()#+-.!>|~<";
const BARE_URL = /^https?:\/\/[^\s<>"'`]+/;

function withBreaks(text: string): Inline[] {
  const out: Inline[] = [];
  text.split("\n").forEach((part, index) => {
    if (index > 0) out.push({ type: "break" });
    if (part) out.push({ type: "text", text: part });
  });
  return out;
}

function isSpace(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

function isWord(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/** The end of a code span that starts at `i` with a run of backticks. */
function codeSpanEnd(s: string, i: number): { run: number; end: number } {
  let run = 0;
  while (s[i + run] === "`") run += 1;
  const fence = "`".repeat(run);
  let j = s.indexOf(fence, i + run);
  while (j !== -1) {
    let k = j + run;
    if (s[k] !== "`" && s[j - 1] !== "`") return { run, end: j };
    while (s[k] === "`") k += 1;
    j = s.indexOf(fence, k);
  }
  return { run, end: -1 };
}

/** Skips over a code span or an escape, so a mark inside one is not a mark. */
function skip(s: string, j: number): number {
  if (s[j] === "\\") return j + 2;
  if (s[j] === "`") {
    const span = codeSpanEnd(s, j);
    if (span.end !== -1) return span.end + span.run;
  }
  return j + 1;
}

/**
 * Where a closing `mark` for an opening just before `from` is, or -1. A run
 * of marks closes with its last ones ("***x***"); a run that cannot close this
 * mark is passed over whole, so "*a **b** c*" keeps its inner bold.
 */
function closing(s: string, from: number, mark: string): number {
  const ch = mark[0] as string;
  let j = from;
  while (j < s.length) {
    if (s[j] === ch) {
      let run = 0;
      while (s[j + run] === ch) run += 1;
      const usable =
        j > from && !isSpace(s[j - 1]) && !(ch === "_" && isWord(s[j + run]));
      if (usable) {
        if (mark.length === 2 && run >= 2) return j + run - 2;
        if (mark.length === 1 && run % 2 === 1) return j + run - 1;
      }
      j += run;
      continue;
    }
    j = skip(s, j);
  }
  return -1;
}

/** A link at `i`: "[words](address)". */
function linkAt(
  s: string,
  i: number,
):
  | { label: string; href: string; end: number }
  | { label: string; open: true }
  | undefined {
  let depth = 0;
  let j = i;
  for (; j < s.length; j = skip(s, j)) {
    if (s[j] === "[") depth += 1;
    else if (s[j] === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (j >= s.length) return undefined;
  const label = s.slice(i + 1, j);
  if (s[j + 1] !== "(") return undefined;
  let k = j + 2;
  let parens = 1;
  while (k < s.length && parens > 0) {
    if (s[k] === "(") parens += 1;
    else if (s[k] === ")") parens -= 1;
    if (parens > 0) k += 1;
  }
  if (k >= s.length) return { label, open: true };
  // An optional title after the address is dropped.
  const inside = s
    .slice(j + 2, k)
    .trim()
    .replace(/\s+("[^"]*"|'[^']*')$/, "");
  return { label, href: inside, end: k + 1 };
}

/** Reads one block's text into inline nodes. */
export function parseInline(
  text: string,
  options: ParseOptions = {},
): Inline[] {
  return inline(text, options.streaming === true, 0, true);
}

function inline(
  s: string,
  streaming: boolean,
  depth: number,
  /** False inside a link's words: a link never holds another. */
  links: boolean,
): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    out.push(...withBreaks(buf));
    buf = "";
  };
  const nest = (inner: string, keepLinks = links) =>
    depth < MAX_DEPTH
      ? inline(inner, streaming, depth + 1, keepLinks)
      : withBreaks(inner);

  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;

    if (
      c === "\\" &&
      i + 1 < s.length &&
      ESCAPABLE.includes(s[i + 1] as string)
    ) {
      buf += s[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const span = codeSpanEnd(s, i);
      if (span.end !== -1) {
        flush();
        let code = s.slice(i + span.run, span.end).replace(/\n/g, " ");
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        out.push({ type: "code", text: code });
        i = span.end + span.run;
        continue;
      }
      if (streaming) {
        flush();
        out.push({
          type: "code",
          text: s.slice(i + span.run).replace(/\n/g, " "),
        });
        return out;
      }
      buf += "`".repeat(span.run);
      i += span.run;
      continue;
    }

    if (c === "[" && links) {
      const link = linkAt(s, i);
      if (link && "href" in link) {
        flush();
        const href = safeHref(link.href);
        const words = nest(link.label, false);
        if (href) out.push({ type: "link", href, children: words });
        else out.push(...words);
        i = link.end;
        continue;
      }
      if (link && streaming) {
        // "[words](htt…" while it is written: the words, and nothing else yet.
        flush();
        out.push(...nest(link.label, false));
        return out;
      }
    }

    if (c === "<" && links) {
      const auto = /^<(https?:\/\/[^\s<>]+)>/.exec(s.slice(i));
      const href = auto?.[1] ? safeHref(auto[1]) : undefined;
      if (auto && href) {
        flush();
        out.push({
          type: "link",
          href,
          children: [{ type: "text", text: auto[1] as string }],
        });
        i += auto[0].length;
        continue;
      }
    }

    if ((c === "h" || c === "H") && links && !isWord(s[i - 1])) {
      const bare = BARE_URL.exec(s.slice(i));
      if (bare) {
        // Punctuation that ends a sentence is not part of the address.
        let raw = bare[0];
        while (/[.,;:!?)\]]$/.test(raw)) {
          if (
            raw.endsWith(")") &&
            raw.split("(").length >= raw.split(")").length
          )
            break;
          raw = raw.slice(0, -1);
        }
        const href = safeHref(raw);
        if (href) {
          flush();
          out.push({
            type: "link",
            href,
            children: [{ type: "text", text: raw }],
          });
          i += raw.length;
          continue;
        }
      }
    }

    if (c === "*" || c === "_") {
      const double = s[i + 1] === c;
      const mark = double ? c + c : c;
      const after = s[i + mark.length];
      const before = s[i - 1];
      const opens =
        !isSpace(after) &&
        after !== undefined &&
        !(c === "_" && isWord(before));
      if (opens) {
        const end = closing(s, i + mark.length, mark);
        if (end !== -1) {
          flush();
          const children = nest(s.slice(i + mark.length, end));
          out.push(
            double ? { type: "strong", children } : { type: "em", children },
          );
          i = end + mark.length;
          continue;
        }
        if (streaming) {
          flush();
          const children = nest(s.slice(i + mark.length));
          out.push(
            double ? { type: "strong", children } : { type: "em", children },
          );
          return out;
        }
      } else if (streaming && after === undefined) {
        // A mark at the very end, about to open: not shown yet.
        i += mark.length;
        continue;
      }
      buf += mark;
      i += mark.length;
      continue;
    }

    buf += c;
    i += 1;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------------ */
/* Plain text                                                               */
/* ------------------------------------------------------------------------ */

export interface PlainOptions extends ParseOptions {
  /** "both" writes a link as its words and its address; "words" only the words. */
  links?: "both" | "words";
}

function inlineText(nodes: Inline[], options: PlainOptions): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "code":
          return node.text;
        case "break":
          return "\n";
        case "strong":
        case "em":
          return inlineText(node.children, options);
        case "link": {
          const words = inlineText(node.children, options);
          return options.links === "words" ||
            words === node.href ||
            `${words}/` === node.href
            ? words
            : `${words} (${node.href})`;
        }
      }
      return "";
    })
    .join("");
}

function blockText(block: Block, options: PlainOptions): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return inlineText(block.children, options);
    case "code":
      return block.text;
    case "rule":
      return "";
    case "quote":
      return blocksText(block.children, options);
    case "table":
      // One line a row, the cells apart by tabs, so a copy pastes into a
      // spreadsheet as columns.
      return [block.head, ...block.rows]
        .map((row) => row.map((cell) => inlineText(cell, options)).join("\t"))
        .join("\n");
    case "list":
      return block.items
        .map((item, index) => {
          const check = block.checks?.[index];
          const mark = block.ordered
            ? `${block.start + index}. `
            : check === true
              ? "- [x] "
              : check === false
                ? "- [ ] "
                : "- ";
          const body = item
            .map((b) => blockText(b, options))
            .filter((t) => t !== "")
            .join("\n")
            .replace(/\n/g, "\n  ");
          return `${mark}${body}`;
        })
        .join("\n");
  }
  return "";
}

function blocksText(blocks: Block[], options: PlainOptions): string {
  return blocks
    .map((b) => blockText(b, options))
    .filter((t) => t !== "")
    .join("\n\n");
}

/** The words of Markdown text without its marks, for copying and reading aloud. */
export function plainText(text: string, options: PlainOptions = {}): string {
  return blocksText(parseMarkdown(text, options), options);
}

/**
 * One line of Markdown text without its marks, for a preview. A preview may
 * be cut short mid-mark, so a mark left open is read as closed.
 */
export function plainLine(text: string): string {
  return plainText(text, { links: "words", streaming: true })
    .replace(/\s+/g, " ")
    .trim();
}

/** The links of Markdown text, in order. */
export function linksOf(text: string): string[] {
  const found: string[] = [];
  const walkInline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "link") {
        found.push(node.href);
        walkInline(node.children);
      } else if (node.type === "strong" || node.type === "em")
        walkInline(node.children);
    }
  };
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === "paragraph" || block.type === "heading")
        walkInline(block.children);
      else if (block.type === "quote") walk(block.children);
      else if (block.type === "list")
        for (const item of block.items) walk(item);
      else if (block.type === "table")
        for (const row of [block.head, ...block.rows])
          for (const cell of row) walkInline(cell);
    }
  };
  walk(parseMarkdown(text));
  return found;
}

/** The code blocks of Markdown text, in order. */
export function codeBlocksOf(text: string): string[] {
  const found: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === "code") found.push(block.text);
      else if (block.type === "quote") walk(block.children);
      else if (block.type === "list")
        for (const item of block.items) walk(item);
    }
  };
  walk(parseMarkdown(text));
  return found;
}
