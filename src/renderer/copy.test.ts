import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Product copy rule: an assistant is an "assistant", never a "bot" or a
 * "robot", in anything a person reads. This reads the screens' own source.
 */
const SCREENS = join(import.meta.dirname, "src");
const SHARED = join(import.meta.dirname, "../shared");

function sources(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /\.(tsx?|css)$/.test(name) && !name.includes(".test."))
    .map((name) => join(dir, name));
}

describe("product copy", () => {
  it("never says bot or robot", () => {
    for (const file of [
      ...sources(SCREENS),
      ...sources(SHARED),
      join(import.meta.dirname, "index.html"),
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(ro)?bots?\b/i);
    }
  });
});
