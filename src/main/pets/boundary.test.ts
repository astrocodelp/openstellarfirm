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

  it("holds the ElevenLabs key and address in voice.ts alone, and no other file fetches", () => {
    for (const { name, text } of sources) {
      const code = withoutComments(text);
      if (name !== "voice.ts") {
        expect(code, name).not.toMatch(/elevenlabs\.io|\bfetch\(/i);
      }
      // Only the service reads the saved key, and only to hand it to the client.
      if (name !== "service.ts" && name !== "voice.ts") {
        expect(code, name).not.toMatch(/xi-api-key|desk-pets:elevenlabs/);
      }
    }
    const voice = sources.find((s) => s.name === "voice.ts")?.text ?? "";
    expect(voice).toContain('redirect: "manual"');
    expect(voice).toContain('"https://api.elevenlabs.io"');
    // The key is never logged or put in an error.
    expect(withoutComments(voice)).not.toMatch(/console\./);
  });

  it("lends the pets a host that can start a run and say a step waits, and nothing else", () => {
    const backend = sources.find((s) => s.name === "backend.ts")?.text ?? "";
    const block =
      /interface PetTurnHost \{([\s\S]*?)\n\}/.exec(backend)?.[1] ?? "";
    const members = [
      ...withoutComments(block).matchAll(/^\s{2}([a-zA-Z]+)\(/gm),
    ].map((m) => m[1]);
    expect(members.sort()).toEqual(["busy", "start", "target"]);
    // The run's signals are read only: a promise that a step waits, never an answer to it.
    const run = /interface PetRun \{([\s\S]*?)\n\}/.exec(backend)?.[1] ?? "";
    expect(withoutComments(run)).toMatch(/needsYou: Promise<void>/);
    expect(withoutComments(run)).not.toMatch(/approve|reject|allow|always/i);
  });

  it("writes no em dash or en dash", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/[\u2013\u2014]/u);
    }
  });
});
