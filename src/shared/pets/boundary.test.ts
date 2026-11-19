import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;

/** The folder's own sources, not its tests. */
const sources = readdirSync(here)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ name, text: readFileSync(join(here, name), "utf8") }));

/** The code without its comments, which may talk about what it avoids. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The app, the simulator and the generator all load this folder, and the
 * firmware shares its ids, so it holds the protocol and nothing a host
 * brings: no Node module, no React, no DOM, no SDK, no network and no
 * environment. (The tests may read files, and the scripts may do anything.)
 */
describe("the desk pet protocol code stays pure", () => {
  it("has sources to read", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it("reads no environment, storage or network", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/process\.env|import\.meta\.env/);
      expect(text, name).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|document\.|window\.|Buffer\b|require\s*\(/,
      );
    }
  });

  it("reads no random source and no clock of its own", () => {
    // Codes are made from bytes the caller passes in, and the quiet-hours
    // check takes the time it is asked about.
    for (const { name, text } of sources) {
      expect(withoutComments(text), name).not.toMatch(
        /Math\.random|crypto\.|randomUUID|getRandomValues|Date\.now|new Date\(\s*\)/,
      );
    }
  });

  it("imports only its own files", () => {
    for (const { name, text } of sources) {
      for (const [, specifier] of text.matchAll(/from "([^"]+)"/g)) {
        expect(specifier, `${name} imports ${specifier}`).toMatch(
          /^\.\/[a-z-]+$/,
        );
      }
    }
  });

  it("writes no em dash or en dash", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/[\u2013\u2014]/u);
    }
  });
});
