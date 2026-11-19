import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What a walk through the real app found broken, kept from coming back.
 * Vitest has no page here, so these are read from the source.
 */

const src = join(import.meta.dirname, "src");
const read = (name: string) => readFileSync(join(src, name), "utf8");
const css = read("styles.css");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is in styles.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("the window's layout", () => {
  it("keeps the chat scrolling inside a narrow window, with the message box in view", () => {
    expect(rule(".chat-pane")).toMatch(/min-height:\s*0/);
  });

  it("never lets a hidden line in a scrolling pane make the whole app scroll", () => {
    const hidden = rule(".visually-hidden");
    expect(hidden).toMatch(/top:\s*0/);
    expect(hidden).toMatch(/left:\s*0/);
  });

  it("keeps Export and Copy to StellarFirm cloud when a narrow window drops the preview", () => {
    expect(css).not.toMatch(/\.preview\s*{\s*display:\s*none/);
    expect(css).toContain(".preview > :not(.preview-actions)");
  });

  it("lets the chat's buttons go to a second line instead of squeezing the name", () => {
    expect(rule(".chat-head")).toMatch(/flex-wrap:\s*wrap/);
    expect(read("ChatView.tsx")).toContain('className="chat-head-actions"');
  });
});

describe("an answer", () => {
  it("puts Copy and Read aloud side by side", () => {
    const view = read("ChatView.tsx");
    const row = view.slice(view.indexOf('className="turn-actions"'));
    expect(row.indexOf("<CopyButton")).toBeGreaterThan(-1);
    expect(row.indexOf("<ReadAloud")).toBeGreaterThan(
      row.indexOf("<CopyButton"),
    );
    expect(rule(".turn-actions")).toMatch(/display:\s*flex/);
  });

  it("does not show a turn the person stopped as an error", () => {
    expect(read("ChatView.tsx")).toContain("bubble-stopped");
    expect(css).toMatch(
      /\.bubble-failed\.bubble-stopped\s*{\s*color:\s*var\(--dim\)/,
    );
  });
});

describe("where the focus goes", () => {
  it("lands on the new screen when the button that opened it went with the old one", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/focusLost\(\)[\s\S]{0,200}focusScreen\(\)/);
  });

  it("goes back to a heading or a message that had it before a dialog opened", () => {
    expect(read("a11y.ts")).toMatch(
      /if \(opener\.isConnected\) focusBack\(opener\)/,
    );
    expect(read("Palette.tsx")).toContain("focusBack(before)");
  });

  it("goes to the summary's Keep button when Summarise and continue is done", () => {
    const memory = read("Memory.tsx");
    expect(memory).toContain("pendingSummaryKeep()");
    expect(memory).toContain('data-pending={pending ? "true" : undefined}');
  });

  it("stays in the computer panel after Start, Turn off and Remove", () => {
    expect(read("Computer.tsx")).toContain("refocusIfLost(nextInPanel)");
  });
});

describe("Settings", () => {
  it("never lets one accessibility choice undo another made just before it", () => {
    expect(read("Accessibility.tsx")).toMatch(
      /pending\.current \?\? prefs[\s\S]{0,80}pending\.current = next/,
    );
  });
});

describe("Record how you work", () => {
  it("says where to allow screen recording instead of a bare error", () => {
    const capture = readFileSync(
      join(import.meta.dirname, "..", "main", "recording", "capture.ts"),
      "utf8",
    );
    expect(capture).toMatch(/getSources\([\s\S]{0,120}\.catch\(\(\) => \[\]\)/);
  });
});

describe("the assistant's form", () => {
  /**
   * The founder's rule: at most one short sentence explains a part of the
   * page. A longer story goes in a "How … works" fold (a details element).
   */
  it("explains each part in one sentence, with longer text folded away", () => {
    for (const name of [
      "AssistantForm.tsx",
      "PersonaGallery.tsx",
      "SkillPicker.tsx",
      "RecordSkill.tsx",
    ]) {
      const page = read(name)
        // The longer story, one click away.
        .replace(/<details[\s\S]*?<\/details>/g, "")
        // A question asked in place (Remove, Copy) is not part of the page.
        .replace(/<InlineConfirm[\s\S]*?<\/InlineConfirm>/g, "")
        .replace(/<RecordDialog[\s\S]*?\/>/g, "");
      const top =
        name === "RecordSkill.tsx"
          ? page.slice(0, page.indexOf("function RecordDialog"))
          : page;
      for (const [, text = ""] of top.matchAll(
        /className="faint"[^>]*>([^<]*)</g,
      )) {
        const sentences = text
          .replace(/\s+/g, " ")
          .trim()
          .match(/[.?!](\s|$)/g);
        expect(
          sentences?.length ?? 0,
          `${name}: ${text.trim()}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps Save in view while the form scrolls", () => {
    expect(rule(".form-actions")).toMatch(/position:\s*sticky/);
    expect(rule(".assistant-form")).toMatch(/scroll-padding-bottom/);
  });
});

/**
 * The quiet lines of a screen's source: the text of each `faint` or `dim`
 * element, a screen head's line, and each `note` a choice or a tick box shows.
 * A line made of a choice between strings gives each string.
 */
function quietLines(page: string): string[] {
  const found = [
    ...[...page.matchAll(/className="(?:faint|dim)[^"]*"[^>]*>([^<]*)</g)].map(
      (m) => m[1] ?? "",
    ),
    ...[...page.matchAll(/<ScreenHead[^>]*>([^<]*)<\/ScreenHead>/g)].map(
      (m) => m[1] ?? "",
    ),
    ...[...page.matchAll(/\bnote(?:=|: )"([^"]*)"/g)].map((m) => m[1] ?? ""),
  ];
  return found.flatMap((raw) => {
    // A plain value read in place, such as {main.name}, is one word.
    const text = raw.replace(/\{[^{}"'`]*\}/g, "X");
    if (!text.includes("{")) return [text];
    return [...text.matchAll(/"([^"]*)"|`([^`]*)`/g)].map(
      (m) => m[1] ?? m[2] ?? "",
    );
  });
}

function sentences(text: string): number {
  return (
    text
      .replace(/\s+/g, " ")
      .trim()
      .match(/[.?!](\s|$)/g)?.length ?? 0
  );
}

describe("Settings and the first run", () => {
  /**
   * The founder's rule, as on the assistant's form: at most one short
   * sentence explains a part of a page or a field. The longer story is one
   * click away, in a "How … works" fold (a details element).
   */
  it("explains each part in one sentence, with longer text folded away", () => {
    for (const name of [
      "Settings.tsx",
      "SettingsMain.tsx",
      "SettingsData.tsx",
      "SettingsReading.tsx",
      "SettingsUpdates.tsx",
      "Models.tsx",
      "Connections.tsx",
      "ConnectionGallery.tsx",
      "Mail.tsx",
      "Backup.tsx",
      "Accessibility.tsx",
      "Licences.tsx",
      "Welcome.tsx",
    ]) {
      const page = read(name)
        .replace(/<details[\s\S]*?<\/details>/g, "")
        // A question asked in place (Remove, Delete) is not part of the page.
        .replace(/<InlineConfirm[\s\S]*?<\/InlineConfirm>/g, "")
        // The keyboard shortcuts list is a dialog of its own.
        .replace(/export function ShortcutsDialog[\s\S]*?^}/m, "");
      const lines = quietLines(page);
      expect(lines.length, name).toBeGreaterThan(0);
      for (const line of lines)
        expect(sentences(line), `${name}: ${line.trim()}`).toBeLessThanOrEqual(
          1,
        );
    }
  });

  it("keeps the longer story of a page in a fold, not deleted", () => {
    for (const name of [
      "Models.tsx",
      "Connections.tsx",
      "Mail.tsx",
      "Backup.tsx",
      "SettingsMain.tsx",
      "SettingsData.tsx",
      "SettingsReading.tsx",
      "SettingsUpdates.tsx",
      "Accessibility.tsx",
    ])
      expect(read(name), name).toMatch(
        /<details className="how">\s*<summary>[^<]+<\/summary>/,
      );
  });
});
