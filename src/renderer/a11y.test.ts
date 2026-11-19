import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localVoices, pickVoice, type VoiceLike } from "./src/a11y";

/**
 * Accessibility rules checked without a page: read aloud uses only voices on
 * this computer, and every button that shows only an icon has a name.
 */

const voice = (
  name: string,
  lang: string,
  localService: boolean,
  isDefault = false,
): VoiceLike => ({ name, lang, localService, default: isDefault });

describe("read aloud's voices", () => {
  const voices = [
    voice("Online English", "en-US", false, true),
    voice("Daniel", "en-GB", true),
    voice("Samantha", "en-US", true, true),
    voice("Amélie", "fr-CA", true),
    voice("Online French", "fr-FR", false),
  ];

  it("keeps only voices that run on this computer", () => {
    expect(localVoices(voices).map((v) => v.name)).toEqual([
      "Daniel",
      "Samantha",
      "Amélie",
    ]);
  });

  it("never picks a voice that sends the text to a server", () => {
    const remoteOnly = [voice("Online English", "en-US", false, true)];
    expect(pickVoice(remoteOnly, "en")).toBeUndefined();
    expect(localVoices(remoteOnly)).toEqual([]);
  });

  it("prefers the local default in the page's language", () => {
    expect(pickVoice(voices, "en")?.name).toBe("Samantha");
    expect(pickVoice(voices, "fr")?.name).toBe("Amélie");
  });

  it("falls back to any local voice when none speaks the language", () => {
    expect(pickVoice(voices, "de")?.name).toBe("Samantha");
    expect(pickVoice([voice("Amélie", "fr-CA", true)], "en")?.name).toBe(
      "Amélie",
    );
  });

  it("reads a local voice that is not marked local strictly", () => {
    // A missing flag is not "local".
    const odd = [{ ...voice("Odd", "en-US", true), localService: undefined }];
    expect(localVoices(odd as unknown as VoiceLike[])).toEqual([]);
  });
});

/** Each <button ...>...</button> in a source file, its opening tag and its content. */
function buttons(source: string): { open: string; inner: string }[] {
  const found: { open: string; inner: string }[] = [];
  let at = source.indexOf("<button");
  while (at !== -1) {
    // The opening tag ends at the first ">" outside braces and quotes.
    let depth = 0;
    let quote = "";
    let end = at + 7;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    const open = source.slice(at, end + 1);
    const close = source.indexOf("</button>", end);
    const inner = open.endsWith("/>") ? "" : source.slice(end + 1, close);
    found.push({ open, inner });
    at = source.indexOf("<button", end);
  }
  return found;
}

/** True when nothing but icons (and whitespace or comments) is inside. */
function iconOnly(inner: string): boolean {
  if (!/<(Icon|svg)\b/.test(inner)) return false;
  const rest = inner
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/<Icon\b[^>]*\/>/g, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/g, "")
    .replace(/\s+/g, "");
  return rest === "";
}

describe("buttons that show only an icon", () => {
  const dir = join(import.meta.dirname, "src");
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".tsx") && !name.includes(".test."),
  );

  it("finds the buttons in the sources it reads", () => {
    const all = files.flatMap((name) =>
      buttons(readFileSync(join(dir, name), "utf8")),
    );
    expect(all.length).toBeGreaterThan(20);
    // The Send and Stop buttons are the icon-only ones this must catch.
    expect(all.filter((b) => iconOnly(b.inner)).length).toBeGreaterThan(1);
  });

  it("each have an aria-label", () => {
    const missing = files.flatMap((name) =>
      buttons(readFileSync(join(dir, name), "utf8"))
        .filter((b) => iconOnly(b.inner) && !/\baria-label=/.test(b.open))
        .map((b) => `${name}: ${b.open.replace(/\s+/g, " ").slice(0, 80)}`),
    );
    expect(missing).toEqual([]);
  });
});
