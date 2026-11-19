import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA, checked from the tokens themselves: the stylesheet is read,
 * each theme's colours are worked out (alpha laid over the surface it sits
 * on) and the pairs that matter are measured.
 */

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

const css = readFileSync(join(import.meta.dirname, "src/styles.css"), "utf8");

function block(from: string): string {
  const open = css.indexOf("{", from.length ? css.indexOf(from) : 0);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`No block after ${from}`);
}

function tokens(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    if (m[1] && m[2]) found[m[1]] = m[2].trim();
  return found;
}

const dark = tokens(block(":root {"));
const light = {
  ...dark,
  ...tokens(
    block("@media (prefers-color-scheme: light)").replace(/^\s*:root\s*\{/, ""),
  ),
};

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function encode(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

function oklch(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

function parse(value: string, all: Record<string, string>): Rgba {
  const v = value.trim();
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref?.[1]) return parse(all[ref[1]] ?? "", all);
  if (v.startsWith("#")) {
    const n = Number.parseInt(v.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = v.match(/^(rgb|oklch)\(([^)]+)\)$/);
  if (!fn?.[2]) throw new Error(`Cannot read the colour ${value}`);
  const [main = "", alpha] = fn[2].split("/");
  const n = main.trim().split(/\s+/).map(Number);
  const a = alpha === undefined ? 1 : Number(alpha);
  if (fn[1] === "rgb") return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, a];
  const [r, g, b] = oklch(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
  return [r, g, b, a];
}

/** A colour as it appears over a surface. */
function over(top: Rgba, under: Rgb): Rgb {
  const [r, g, b, a] = top;
  return [
    r * a + under[0] * (1 - a),
    g * a + under[1] * (1 - a),
    b * a + under[2] * (1 - a),
  ];
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SURFACES = ["--bg", "--raised", "--sunken", "--hover", "--active"];

function themeChecks(name: string, all: Record<string, string>) {
  const rgb = (token: string, under: Rgb = [0, 0, 0]): Rgb =>
    over(parse(`var(${token})`, all), under);
  const surface = (token: string) => rgb(token);

  describe(`${name} theme`, () => {
    it("main, muted and faint text pass 4.5:1 on every surface", () => {
      for (const text of ["--text", "--dim", "--faint"])
        for (const s of SURFACES)
          expect(
            ratio(rgb(text, surface(s)), surface(s)),
            `${text} on ${s}`,
          ).toBeGreaterThanOrEqual(4.5);
    });

    it("the primary button's text passes 4.5:1 on its lime", () => {
      for (const fill of ["--lime", "--lime-hover"])
        expect(ratio(rgb("--lime-ink"), rgb(fill))).toBeGreaterThanOrEqual(4.5);
    });

    it("the focus ring passes 3:1 on every surface", () => {
      for (const s of SURFACES)
        expect(
          ratio(rgb("--focus"), surface(s)),
          `focus on ${s}`,
        ).toBeGreaterThanOrEqual(3);
    });

    it("a control's edge passes 3:1 on the surfaces controls sit on", () => {
      for (const s of ["--bg", "--raised", "--sunken"])
        for (const edge of ["--control-line", "--control-line-on"])
          expect(
            ratio(rgb(edge, surface(s)), surface(s)),
            `${edge} on ${s}`,
          ).toBeGreaterThanOrEqual(3);
      // The lime button's own edge, where it sits on the page.
      expect(ratio(rgb("--lime-edge"), surface("--bg"))).toBeGreaterThanOrEqual(
        3,
      );
    });

    it("success and error words pass 4.5:1 on every surface", () => {
      for (const word of ["--ok", "--danger", "--signal"])
        for (const s of SURFACES)
          expect(
            ratio(rgb(word), surface(s)),
            `${word} on ${s}`,
          ).toBeGreaterThanOrEqual(4.5);
      const wash = over(parse("var(--ok-wash)", all), surface("--bg"));
      expect(ratio(rgb("--ok"), wash)).toBeGreaterThanOrEqual(4.5);
      // A calm destructive button fills with this wash when it is pointed at.
      for (const s of ["--bg", "--raised", "--sunken"]) {
        const danger = over(parse("var(--danger-wash)", all), surface(s));
        expect(
          ratio(rgb("--danger"), danger),
          `--danger on its wash over ${s}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("every pet colour passes 3:1 on the surfaces, and its eyes on it", () => {
      for (const pet of ["lime", "sky", "nebula", "rose", "moon"]) {
        const token = `--pet-${pet}`;
        for (const s of SURFACES)
          expect(
            ratio(rgb(token), surface(s)),
            `${token} on ${s}`,
          ).toBeGreaterThanOrEqual(3);
        expect(
          ratio(rgb("--pet-eye"), rgb(token)),
          `eyes on ${token}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it("Nova's visor and glint read against her body", () => {
      expect(
        ratio(rgb("--nova-visor"), rgb("--nova-body")),
      ).toBeGreaterThanOrEqual(3);
      expect(
        ratio(rgb("--nova-glint"), rgb("--nova-visor")),
      ).toBeGreaterThanOrEqual(3);
    });

    it("selected text stays readable", () => {
      const selected = over(parse("var(--selection)", all), surface("--bg"));
      expect(ratio(rgb("--text"), selected)).toBeGreaterThanOrEqual(4.5);
    });
  });
}

describe("the stylesheet", () => {
  it("draws every shape from the radius scale", () => {
    const outside = css.replace(block(":root {"), "");
    const typed = outside.match(/border-radius: (?!var\(|0;|inherit)[^;]+;/g);
    expect(typed ?? []).toEqual([]);
  });

  it("defines the light theme as a media query over the same tokens", () => {
    expect(css).toContain("@media (prefers-color-scheme: light)");
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(
      Object.keys(dark).length,
    );
    expect(light["--bg"]).not.toBe(dark["--bg"]);
  });

  it("types no colour outside the token block and the light block", () => {
    const outside = css
      .replace(block(":root {"), "")
      .replace(block("@media (prefers-color-scheme: light)"), "");
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(/g) ?? []).toEqual(
      [],
    );
  });
});

themeChecks("dark", dark);
themeChecks("light", light);
