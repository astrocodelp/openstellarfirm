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
