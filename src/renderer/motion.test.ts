import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Motion rules, checked from the stylesheet itself: nothing moves the layout,
 * and nothing moves without a reduced-motion answer. Every transition and
 * animation sits in a prefers-reduced-motion block; with reduce, only opacity.
 */

const css = readFileSync(join(import.meta.dirname, "src/styles.css"), "utf8")
  // Comments go first, so a word in one is never read as a rule.
  .replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  /** The at-rules around it, outermost first, such as "@media (...)". */
  context: string[];
  selector: string;
  declarations: [string, string][];
}

/** Reads the sheet into flat rules, each with the at-rules it sits in. */
function rules(text: string): Rule[] {
  const out: Rule[] = [];
  const walk = (body: string, context: string[]) => {
    let i = 0;
    let start = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === ";" && body.slice(start, i).trim().startsWith("@")) {
        start = i + 1; // a statement at-rule, such as @import
      } else if (ch === "{") {
        const prelude = body.slice(start, i).trim();
        let depth = 1;
        let j = i + 1;
        for (; j < body.length && depth > 0; j++) {
          if (body[j] === "{") depth++;
          if (body[j] === "}") depth--;
        }
        const inner = body.slice(i + 1, j - 1);
        if (prelude.startsWith("@")) {
          walk(inner, [...context, prelude]);
        } else if (inner.includes("{")) {
          // A nested block in a rule (for example keyframe steps).
          walk(inner, [...context, prelude]);
        } else {
          out.push({
            context,
            selector: prelude,
            declarations: inner
              .split(";")
              .map((d) => d.trim())
              .filter(Boolean)
              .map((d) => {
                const at = d.indexOf(":");
                return [d.slice(0, at).trim(), d.slice(at + 1).trim()];
              }),
          });
        }
        i = j;
        start = j;
        continue;
      }
      i++;
    }
  };
  walk(text, []);
  return out;
}

const all = rules(css);

/** Properties that move the layout: never transitioned, never keyframed. */
const LAYOUT =
  /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|margin(-[a-z]+)*|padding(-[a-z]+)*|top|right|bottom|left|inset(-[a-z]+)*|gap|row-gap|column-gap|font-size|line-height|letter-spacing|flex(-[a-z]+)*|grid(-[a-z]+)*|border-(top-|right-|bottom-|left-)?width|border|all)$/;

/** The properties a transition shorthand or longhand names. */
function transitioned([name, value]: [string, string]): string[] {
  if (name === "transition-property")
    return value.split(",").map((v) => v.trim());
  if (name !== "transition" || value === "none") return [];
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

const keyframes = new Map<string, string[]>();
for (const rule of all) {
  const at = rule.context.find((c) => c.startsWith("@keyframes"));
  if (!at) continue;
  const name = at.replace("@keyframes", "").trim();
  keyframes.set(name, [
    ...(keyframes.get(name) ?? []),
    ...rule.declarations.map(([p]) => p),
  ]);
}

/** The keyframes an animation declaration plays. */
function played([name, value]: [string, string]): string[] {
  if (name === "animation-name") return value.split(",").map((v) => v.trim());
  if (name !== "animation" || value === "none") return [];
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function moves(rule: Rule): boolean {
  return rule.declarations.some(
    (d) =>
      transitioned(d).length > 0 ||
      played(d).length > 0 ||
      /^animation-(duration|timing-function)$/.test(d[0]),
  );
}

const motion = (rule: Rule) =>
  rule.context.find((c) => c.includes("prefers-reduced-motion"));

describe("motion in the stylesheet", () => {
  it("defines its curves and durations once, as tokens", () => {
    for (const token of [
      "--ease-out",
      "--ease-in-out",
      "--dur-press",
      "--dur-quick",
      "--dur-enter",
      "--dur-page",
    ])
      expect(css).toContain(`${token}:`);
  });

  it("never transitions a property that moves the layout", () => {
    const found = all.flatMap((rule) =>
      rule.declarations
        .flatMap(transitioned)
        .filter((p) => LAYOUT.test(p))
        .map((p) => `${rule.selector}: ${p}`),
    );
    expect(found).toEqual([]);
  });

  it("never keyframes a property that moves the layout", () => {
    const found = [...keyframes].flatMap(([name, props]) =>
      props.filter((p) => LAYOUT.test(p)).map((p) => `${name}: ${p}`),
    );
    expect(found).toEqual([]);
  });

  it("plays only keyframes that exist", () => {
    for (const rule of all)
      for (const name of rule.declarations.flatMap(played))
        expect(keyframes.has(name), `${rule.selector}: ${name}`).toBe(true);
  });

  it("puts every transition and animation in a reduced-motion block", () => {
    const outside = all
      .filter((rule) => moves(rule) && !motion(rule))
      .map((rule) => rule.selector);
    expect(outside).toEqual([]);
  });

  it("with reduced motion, fades opacity and nothing else", () => {
    const reduced = all.filter((rule) =>
      motion(rule)?.includes("prefers-reduced-motion: reduce"),
    );
    expect(reduced.length).toBeGreaterThan(0);
    for (const rule of reduced) {
      for (const p of rule.declarations.flatMap(transitioned))
        expect(["opacity", "display"], `${rule.selector}: ${p}`).toContain(p);
      for (const name of rule.declarations.flatMap(played))
        expect(keyframes.get(name), `${rule.selector}: ${name}`).toEqual([
          "opacity",
        ]);
    }
  });

  it("names its properties, never transition: all", () => {
    expect(css).not.toMatch(/transition(-property)?:\s*all\b/);
  });
});
