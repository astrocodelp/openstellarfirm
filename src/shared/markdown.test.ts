import { describe, expect, it } from "vitest";
import {
  codeBlocksOf,
  hostOf,
  linksOf,
  parseInline,
  parseMarkdown,
  plainLine,
  plainText,
  safeHref,
} from "./markdown";

describe("inline marks", () => {
  it("reads bold, italic and code", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "em", children: [{ type: "text", text: "c" }] },
      { type: "text", text: " " },
      { type: "code", text: "d" },
    ]);
  });

  it("nests bold inside italic and the other way round", () => {
    expect(parseInline("*a **b** c*")).toEqual([
      {
        type: "em",
        children: [
          { type: "text", text: "a " },
          { type: "strong", children: [{ type: "text", text: "b" }] },
          { type: "text", text: " c" },
        ],
      },
    ]);
    expect(parseInline("***x***")).toEqual([
      {
        type: "strong",
        children: [{ type: "em", children: [{ type: "text", text: "x" }] }],
      },
    ]);
  });

  it("keeps a mark that is not closed as text when the answer is done", () => {
    expect(parseInline("**open")).toEqual([{ type: "text", text: "**open" }]);
    expect(parseInline("2 * 3 * 4")).toEqual([
      { type: "text", text: "2 * 3 * 4" },
    ]);
    expect(parseInline("snake_case_name")).toEqual([
      { type: "text", text: "snake_case_name" },
    ]);
  });

  it("never shows an unclosed mark while the answer is written", () => {
    const streaming = { streaming: true };
    expect(parseInline("Hello **wor", streaming)).toEqual([
      { type: "text", text: "Hello " },
      { type: "strong", children: [{ type: "text", text: "wor" }] },
    ]);
    expect(parseInline("Hello **", streaming)).toEqual([
      { type: "text", text: "Hello " },
    ]);
    expect(parseInline("Hello *", streaming)).toEqual([
      { type: "text", text: "Hello " },
    ]);
    expect(parseInline("run `ls -l", streaming)).toEqual([
      { type: "text", text: "run " },
      { type: "code", text: "ls -l" },
    ]);
    expect(parseInline("see [the docs](https://exa", streaming)).toEqual([
      { type: "text", text: "see " },
      { type: "text", text: "the docs" },
    ]);
  });

  it("does not read marks inside code", () => {
    expect(parseInline("`**not bold**`")).toEqual([
      { type: "code", text: "**not bold**" },
    ]);
  });

  it("keeps escaped marks as text", () => {
    expect(parseInline("\\*not\\*")).toEqual([{ type: "text", text: "*not*" }]);
  });

  it("keeps single line breaks", () => {
    expect(parseInline("one\ntwo")).toEqual([
      { type: "text", text: "one" },
      { type: "break" },
      { type: "text", text: "two" },
    ]);
  });

  it("shows HTML as text", () => {
    expect(parseInline('<img src=x onerror="alert(1)"> <b>hi</b>')).toEqual([
      { type: "text", text: '<img src=x onerror="alert(1)"> <b>hi</b>' },
    ]);
  });
});

describe("links", () => {
  it("keeps http and https links", () => {
    expect(parseInline("[NIST](https://www.nist.gov/si)")).toEqual([
      {
        type: "link",
        href: "https://www.nist.gov/si",
        children: [{ type: "text", text: "NIST" }],
      },
    ]);
  });

  it("refuses javascript:, data: and other addresses, keeping the words", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:x",
      "https://user:pw@example.com/",
      "/relative",
    ]) {
      expect(parseInline(`[click](${bad})`)).toEqual([
        { type: "text", text: "click" },
      ]);
    }
  });

  it("reads a bare address and leaves the full stop out", () => {
    expect(parseInline("See https://example.com/a.")).toEqual([
      { type: "text", text: "See " },
      {
        type: "link",
        href: "https://example.com/a",
        children: [{ type: "text", text: "https://example.com/a" }],
      },
      { type: "text", text: "." },
    ]);
  });

  it("never puts a link inside a link", () => {
    const nodes = parseInline("[https://a.com](https://b.com)");
    expect(nodes).toEqual([
      {
        type: "link",
        href: "https://b.com/",
        children: [{ type: "text", text: "https://a.com" }],
      },
    ]);
  });

  it("checks addresses", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com/");
    expect(safeHref("<http://example.com/x>")).toBe("http://example.com/x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("https://exa mple.com")).toBeUndefined();
    expect(hostOf("https://www.nist.gov/si")).toBe("www.nist.gov");
  });

  it("lists the links of a text", () => {
    expect(
      linksOf("a [x](https://a.com) and\n- [y](javascript:1)\n- https://b.org"),
    ).toEqual(["https://a.com/", "https://b.org/"]);
  });
});

describe("blocks", () => {
  it("reads fenced code with its language and keeps its text as it is", () => {
    const blocks = parseMarkdown(
      "Run:\n\n```sh\nls **x**\n  echo hi\n```\nDone.",
    );
    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Run:" }] },
      { type: "code", lang: "sh", text: "ls **x**\n  echo hi" },
      { type: "paragraph", children: [{ type: "text", text: "Done." }] },
    ]);
    expect(codeBlocksOf("```\na\n```\n\n~~~\nb\n~~~")).toEqual(["a", "b"]);
  });

  it("reads a code block that is not closed to the end", () => {
    expect(parseMarkdown("```js\nconst a = 1;")).toEqual([
      { type: "code", lang: "js", text: "const a = 1;" },
    ]);
  });

  it("reads bullet and numbered lists, nested by indent", () => {
    const blocks = parseMarkdown(
      "- one\n- two\n  - inner\n- three\n\n3. a\n4. b",
    );
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          [{ type: "paragraph", children: [{ type: "text", text: "one" }] }],
          [
            { type: "paragraph", children: [{ type: "text", text: "two" }] },
            {
              type: "list",
              ordered: false,
              start: 1,
              items: [
                [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "inner" }],
                  },
                ],
              ],
            },
          ],
          [{ type: "paragraph", children: [{ type: "text", text: "three" }] }],
        ],
      },
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          [{ type: "paragraph", children: [{ type: "text", text: "a" }] }],
          [{ type: "paragraph", children: [{ type: "text", text: "b" }] }],
        ],
      },
    ]);
  });

  it("keeps a list going over blank lines between items", () => {
    const blocks = parseMarkdown("1. a\n\n2. b");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "list", items: [[{}], [{}]] });
  });

  it("reads headings, quotes and rules", () => {
    expect(parseMarkdown("## Title ##\n> quoted **bold**\n\n---")).toEqual([
      { type: "heading", children: [{ type: "text", text: "Title" }] },
      {
        type: "quote",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "quoted " },
              { type: "strong", children: [{ type: "text", text: "bold" }] },
            ],
          },
        ],
      },
      { type: "rule" },
    ]);
  });

  it("does not read a rule as a list", () => {
    expect(parseMarkdown("* * *")).toEqual([{ type: "rule" }]);
  });
});

describe("plain text", () => {
  const answer =
    "**Command Output**:\n`Linux 6.12`\n\n- one [docs](https://a.com)\n- *two*\n\n```\ncode\n```";

  it("drops the marks and keeps the words", () => {
    expect(plainText(answer)).toBe(
      "Command Output:\nLinux 6.12\n\n- one docs (https://a.com/)\n- two\n\ncode",
    );
  });

  it("keeps a nested list under its item, with no blank line", () => {
    expect(plainText("- one\n  - inner\n- two")).toBe(
      "- one\n  - inner\n- two",
    );
  });

  it("gives one line for a preview, with the words of links only", () => {
    expect(plainLine(answer)).toBe(
      "Command Output: Linux 6.12 - one docs - two code",
    );
    expect(plainLine("**Command Output**: `Linu")).toBe("Command Output: Linu");
  });
});

describe("tables", () => {
  const text = (t: string) => [{ type: "text", text: t }];

  it("reads a pipe table with its alignment", () => {
    expect(
      parseMarkdown(
        "| Name | Count | Note |\n| :--- | ---: | :-: |\n| a | 1 | **x** |\n| b | 22 | |",
      ),
    ).toEqual([
      {
        type: "table",
        align: ["left", "right", "center"],
        head: [text("Name"), text("Count"), text("Note")],
        rows: [
          [
            text("a"),
            text("1"),
            [{ type: "strong", children: [{ type: "text", text: "x" }] }],
          ],
          [text("b"), text("22"), []],
        ],
      },
    ]);
  });

  it("reads a table without the outer pipes, and pads or cuts its rows", () => {
    const [table] = parseMarkdown("a | b\n--- | ---\n1\n1 | 2 | 3");
    expect(table).toMatchObject({
      type: "table",
      align: [null, null],
      rows: [
        [text("1"), []],
        [text("1"), text("2")],
      ],
    });
  });

  it("keeps a pipe that is escaped or inside code in its cell", () => {
    const [table] = parseMarkdown(
      "| a | b |\n|---|---|\n| x \\| y | `p | q` |",
    );
    expect(table).toMatchObject({
      type: "table",
      rows: [[text("x | y"), [{ type: "code", text: "p | q" }]]],
    });
  });

  it("is not a table when the dashed line does not match the header", () => {
    expect(parseMarkdown("a | b\n--- | --- | ---")[0]?.type).toBe("paragraph");
    expect(parseMarkdown("Title\n---")[0]?.type).not.toBe("table");
    expect(parseMarkdown("a | b")[0]?.type).toBe("paragraph");
  });

  it("ends at a blank line, and can follow a paragraph", () => {
    const blocks = parseMarkdown("Here:\n| a |\n|---|\n| 1 |\n\nAfter.");
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "table",
      "paragraph",
    ]);
  });

  it("finds links in its cells, and copies as tab-separated lines", () => {
    const md =
      "| Site | Why |\n|---|---|\n| [Docs](https://example.com/) | ok |";
    expect(linksOf(md)).toEqual(["https://example.com/"]);
    expect(plainText(md, { links: "words" })).toBe("Site\tWhy\nDocs\tok");
  });

  it("keeps at most twenty columns", () => {
    const head = Array.from({ length: 30 }, (_, i) => `c${i}`).join(" | ");
    const dash = Array.from({ length: 30 }, () => "---").join(" | ");
    const [table] = parseMarkdown(`${head}\n${dash}`);
    expect(table?.type === "table" && table.head.length).toBe(20);
  });
});

describe("task lists", () => {
  it("reads ticked and open tasks, and items that are not tasks", () => {
    const [list] = parseMarkdown("- [x] Done\n- [ ] To do\n- Plain");
    expect(list).toEqual({
      type: "list",
      ordered: false,
      start: 1,
      checks: [true, false, null],
      items: [
        [{ type: "paragraph", children: [{ type: "text", text: "Done" }] }],
        [{ type: "paragraph", children: [{ type: "text", text: "To do" }] }],
        [{ type: "paragraph", children: [{ type: "text", text: "Plain" }] }],
      ],
    });
  });

  it("leaves a list with no task as it was", () => {
    expect(parseMarkdown("- a\n- b")[0]).not.toHaveProperty("checks");
    // A box in a numbered list is only text.
    expect(parseMarkdown("1. [x] a")[0]).not.toHaveProperty("checks");
  });

  it("writes the boxes in plain text", () => {
    expect(plainText("- [x] Done\n- [ ] To do")).toBe(
      "- [x] Done\n- [ ] To do",
    );
  });
});
