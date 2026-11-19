import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PET_ROUTES } from "./server";

const here = import.meta.dirname;

/** The folder's own sources: not its tests and not its test helpers. */
const sources = readdirSync(here)
  .filter(
    (name) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".testkit.ts"),
  )
  .map((name) => ({ name, text: readFileSync(join(here, name), "utf8") }));

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A pet can pair and be seen, and in a later phase carry its turns. It can
 * never decide an approval, answer a held tool call or change a chat setting:
 * these modules import nothing of the app's approval, agent, chat or tool
 * code, and none of their routes names one.
 */
describe("the desk pet server holds no way to decide an approval", () => {
  it("has sources to read", () => {
    expect(sources.length).toBeGreaterThan(6);
  });

  it("imports only Node's own modules, the pet protocol and its own files", () => {
    for (const { name, text } of sources) {
      for (const [, specifier] of text.matchAll(/from "([^"]+)"/g)) {
        expect(specifier, `${name} imports ${specifier}`).toMatch(
          /^(node:[a-z:/]+|\.\.\/\.\.\/shared\/(pets\/[a-z-]+|desk-pets)|\.\/[a-z-]+)$/,
        );
      }
    }
  });

  it("never imports electron", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/from "electron"|require\("electron"\)/);
    }
  });

  it("names no approval, decision or held step in its code", () => {
    for (const { name, text } of sources) {
      expect(withoutComments(text), name).not.toMatch(
        /\bdecide\b|\bDecision\b|ApprovalCard|\bwaiting\.(get|set)\b|\bsettle\b|\bpending\.(get|set)\b|writesApproved/,
      );
    }
  });

  it("serves only pet paths, none about an approval, a chat or a setting", () => {
    for (const route of PET_ROUTES) {
      expect(route.path, route.path).toMatch(/^\/(api\/pets|pets\/voice)\//);
      expect(route.path, route.path).not.toMatch(
        /approv|decid|reject|chat|setting|assistant|folder|key|secret/i,
      );
    }
  });

  it("writes no em dash or en dash", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/[\u2013\u2014]/u);
    }
  });
});
