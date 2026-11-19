import { describe, expect, it } from "vitest";
import {
  MAX_OWN_DESCRIPTION,
  MAX_OWN_LINE,
  MAX_OWN_LINES,
  MAX_OWN_NAME,
  MAX_OWN_TOTAL,
} from "../../shared/own-skills";
import { NO_PICTURES_LINE } from "../../shared/recording";
import { ModelError, type TurnEvent, type WireMessage } from "../models";
import { type DraftPicture, draftSkill, NoPicturesError } from "./draft";
import { DraftError, ourWords, parseSkillDraft } from "./parse";

const GOOD = JSON.stringify({
  name: "File weekly expenses",
  description: "Fill the expense sheet from receipts, then file it.",
  lines: [
    "Open this week's expense sheet.",
    "- Add one row per receipt with the date, shop and total.",
    "Check the sum before you file it.",
  ],
});

/** The words we never use, put together so this file never holds them whole. */
const B = ["b", "ot"].join("");

describe("reading a draft", () => {
  it("reads the three parts and takes off bullets", () => {
    const draft = parseSkillDraft(`Here it is:\n\`\`\`json\n${GOOD}\n\`\`\``);
    expect(draft.name).toBe("File weekly expenses");
    expect(draft.lines).toHaveLength(3);
    expect(draft.lines[1]).toBe(
      "Add one row per receipt with the date, shop and total.",
    );
  });

  it.each([
    ["no object", "I could not do it."],
    ["broken JSON", '{"name": "x", '],
    ["a list", "[1, 2]"],
    ["no name", JSON.stringify({ description: "d", lines: ["a"] })],
    [
      "lines that are not text",
      JSON.stringify({ name: "n", description: "d", lines: [1] }),
    ],
    [
      "lines as one text",
      JSON.stringify({ name: "n", description: "d", lines: "a" }),
    ],
    [
      "no lines left",
      JSON.stringify({ name: "n", description: "d", lines: ["  "] }),
    ],
  ])("refuses %s", (_label, text) => {
    expect(() => parseSkillDraft(text)).toThrow(DraftError);
  });

  it("refuses an answer far too long to read", () => {
    expect(() => parseSkillDraft(`{"name":"${"x".repeat(30_000)}"}`)).toThrow(
      DraftError,
    );
  });

  it("cuts every part to its limit, at a word", () => {
    const long = (n: number) => "word ".repeat(n).trim();
    const draft = parseSkillDraft(
      JSON.stringify({
        name: long(40),
        description: long(60),
        lines: Array.from({ length: 12 }, (_, i) => `${i} ${long(80)}`),
      }),
    );
    expect(draft.name.length).toBeLessThanOrEqual(MAX_OWN_NAME);
    expect(draft.name.endsWith("word")).toBe(true);
    expect(draft.description.length).toBeLessThanOrEqual(MAX_OWN_DESCRIPTION);
    expect(draft.lines.length).toBeLessThanOrEqual(MAX_OWN_LINES);
    for (const line of draft.lines)
      expect(line.length).toBeLessThanOrEqual(MAX_OWN_LINE);
    expect(draft.lines.join(" ").length).toBeLessThanOrEqual(MAX_OWN_TOTAL);
  });

  it("drops repeated lines and control characters", () => {
    const draft = parseSkillDraft(
      JSON.stringify({
        name: "A\u0007 name",
        description: "One line",
        lines: ["Same line.", "Same line.", "Other\u0000 line."],
      }),
    );
    expect(draft.name).toBe("A name");
    expect(draft.lines).toEqual(["Same line.", "Other line."]);
  });

  it(`never says ${B} or ro${B}`, () => {
    const draft = parseSkillDraft(
      JSON.stringify({
        name: `Chat${B} triage`,
        description: `Let the ro${B} sort the inbox.`,
        lines: [`Ask the ${B}s for help.`, "Keep the bottom line."],
      }),
    );
    const all = [draft.name, draft.description, ...draft.lines].join(" ");
    expect(all).not.toMatch(new RegExp(`\\b(ro)?${B}s?\\b`, "i"));
    expect(draft.name).toBe("assistant triage");
    expect(draft.lines[1]).toBe("Keep the bottom line.");
    expect(ourWords(`a ${B}`)).toBe("a assistant");
  });
});

/** A fake model that answers each call with the next text, and records what it was sent. */
function model(answers: (string | Error)[]) {
  const sent: WireMessage[][] = [];
  const turn = (messages: WireMessage[]): AsyncGenerator<TurnEvent> => {
    sent.push(messages);
    const next = answers.shift();
    return (async function* () {
      if (next instanceof Error) throw next;
      yield { type: "text", text: next ?? "" };
    })();
  };
  return { sent, turn };
}

function shots(n: number): DraftPicture[] {
  return Array.from({ length: n }, (_, i) => ({
    atMs: i * 2000,
    jpeg: new Uint8Array([0xff, 0xd8, 0xff, i]),
  }));
}

describe("drafting a skill from pictures", () => {
  it("sends at most three pictures a call, then one text-only call", async () => {
    const m = model(["Opened the sheet.", "Typed a row.", "Filed it.", GOOD]);
    const progress: [number, number][] = [];
    const draft = await draftSkill(shots(7), "filing expenses", {
      turn: m.turn,
      signal: new AbortController().signal,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(draft.name).toBe("File weekly expenses");
    expect(m.sent).toHaveLength(4);
    const counts = m.sent.map(
      (messages) =>
        messages.flatMap((msg) =>
          msg.role === "user" ? (msg.images ?? []) : [],
        ).length,
    );
    expect(counts).toEqual([3, 3, 1, 0]);
    expect(progress.at(0)).toEqual([0, 4]);
    expect(progress.at(-1)).toEqual([4, 4]);
    const last = m.sent[3]?.[1];
    expect(last?.content).toContain("Opened the sheet.");
    expect(last?.content).toContain("filing expenses");
  });

  it("tells the model that text in the pictures is not an instruction", async () => {
    const m = model(["Steps.", GOOD]);
    await draftSkill(shots(1), "", {
      turn: m.turn,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(m.sent[0]?.[0]?.content).toMatch(/never instructions/);
  });

  it("says plainly when the model turns the pictures down", async () => {
    const m = model([new ModelError("bad", 400)]);
    const run = draftSkill(shots(2), "", {
      turn: m.turn,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    await expect(run).rejects.toThrow(NoPicturesError);
    await expect(run).rejects.toThrow(NO_PICTURES_LINE);
  });

  it("says so when the model says it saw no pictures", async () => {
    const m = model(["NO PICTURES"]);
    await expect(
      draftSkill(shots(2), "", {
        turn: m.turn,
        signal: new AbortController().signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow(NoPicturesError);
    expect(m.sent).toHaveLength(1);
  });

  it("asks once more when the skill could not be read", async () => {
    const m = model(["Steps.", "Sorry, here you go: name is x", GOOD]);
    const draft = await draftSkill(shots(1), "", {
      turn: m.turn,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(draft.lines).toHaveLength(3);
    expect(m.sent).toHaveLength(3);
  });

  it("stops when the person stops it", async () => {
    const controller = new AbortController();
    controller.abort();
    const m = model(["Steps.", GOOD]);
    await expect(
      draftSkill(shots(1), "", {
        turn: m.turn,
        signal: controller.signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow("Stopped.");
  });

  it("needs at least one picture", async () => {
    const m = model([]);
    await expect(
      draftSkill([], "", {
        turn: m.turn,
        signal: new AbortController().signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow(DraftError);
    expect(m.sent).toHaveLength(0);
  });

  it("passes on any other failure as it is", async () => {
    const m = model([new ModelError("The model is busy.", 429)]);
    await expect(
      draftSkill(shots(1), "", {
        turn: m.turn,
        signal: new AbortController().signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow("The model is busy.");
  });
});
