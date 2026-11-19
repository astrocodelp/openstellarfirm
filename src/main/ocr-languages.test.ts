import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OcrDownloadProgress } from "../shared/download-progress";
import {
  BUILT_IN,
  DOWNLOADABLE,
  isMirrorHost,
  languageUrl,
  OcrLanguages,
  STOPPED,
} from "./ocr-languages";

let dir: string;
let builtIn: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openstellar-ocr-"));
  builtIn = join(dir, "built-in");
  mkdirSync(builtIn);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const german = DOWNLOADABLE.find((l) => l.code === "deu");
if (!german) throw new Error("German is missing from the list");

/** The list pins a hash; a test swaps in bytes whose hash it controls. */
function withBytes(bytes: Uint8Array) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  vi.spyOn(german as { sha256: string }, "sha256", "get").mockReturnValue(sha);
  vi.spyOn(german as { size: number }, "size", "get").mockReturnValue(
    bytes.length,
  );
}

function languagesWith(fetch: typeof globalThis.fetch, now?: () => number) {
  return new OcrLanguages({ dataDir: dir, builtInDir: builtIn, fetch, now });
}

function filesLeft(): string[] {
  const folder = join(dir, "ocr-languages");
  return existsSync(folder) ? readdirSync(folder) : [];
}

/**
 * A body that sends the first chunk at once, then waits until the fetch's
 * signal ends it, as a slow connection would.
 */
function stalledBody(first: Uint8Array): typeof fetch {
  return async (_url, init) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
      },
      pull(controller) {
        return new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
            resolve();
          });
        });
      },
    });
    return new Response(body);
  };
}

describe("the languages list", () => {
  it("pins every download to one address on Hugging Face", () => {
    for (const l of DOWNLOADABLE) {
      const url = new URL(languageUrl(l.code));
      expect(url.host).toBe("huggingface.co");
      expect(url.pathname).toMatch(
        /^\/lm-kit\/tessdata-fast\/resolve\/[0-9a-f]{40}\/[a-z_]+\.traineddata$/,
      );
      expect(l.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(() => languageUrl("../../evil")).toThrow();
  });

  it("follows redirects only to Hugging Face's own names over https", () => {
    expect(isMirrorHost(new URL("https://us.aws.cdn.hf.co/x"))).toBe(true);
    expect(isMirrorHost(new URL("https://huggingface.co/x"))).toBe(true);
    expect(isMirrorHost(new URL("http://huggingface.co/x"))).toBe(false);
    expect(isMirrorHost(new URL("https://evil.example/x"))).toBe(false);
    expect(isMirrorHost(new URL("https://hf.co.evil.example/x"))).toBe(false);
    expect(isMirrorHost(new URL("https://huggingface.co:8443/x"))).toBe(false);
  });

  it("lists English as built in and the rest as not installed", () => {
    const list = languagesWith(fetch).list();
    expect(list[0]).toMatchObject({
      code: "eng",
      builtIn: true,
      installed: true,
    });
    expect(list.filter((l) => l.installed)).toHaveLength(1);
  });

  it("serves the built-in English only when its bytes match", () => {
    writeFileSync(join(builtIn, "eng.traineddata"), "not the real file");
    expect(languagesWith(fetch).bytesOf(BUILT_IN.code)).toBeUndefined();
  });
});

describe("downloading a language", () => {
  it("keeps a file whose SHA-256 matches, after the redirect", async () => {
    const bytes = new TextEncoder().encode("trained data");
    withBytes(bytes);
    const seen: string[] = [];
    const fake: typeof fetch = async (url) => {
      seen.push(String(url));
      if (String(url).startsWith("https://huggingface.co/"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://us.aws.cdn.hf.co/xet/abc" },
        });
      return new Response(bytes);
    };
    const languages = languagesWith(fake);
    const list = await languages.download("deu");
    expect(list.find((l) => l.code === "deu")?.installed).toBe(true);
    expect(languages.installed()).toEqual(["eng", "deu"]);
    expect(languages.bytesOf("deu")).toEqual(bytes);
    expect(seen).toHaveLength(2);
  });

  it("deletes and refuses a file whose SHA-256 does not match", async () => {
    withBytes(new TextEncoder().encode("the real bytes"));
    const fake: typeof fetch = async () =>
      new Response(new TextEncoder().encode("other bytes!!!"));
    const languages = languagesWith(fake);
    await expect(languages.download("deu")).rejects.toThrow(/did not match/);
    const folder = join(dir, "ocr-languages");
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    expect(languages.installed()).toEqual(["eng"]);
  });

  it("refuses a redirect to anywhere else, and a file larger than expected", async () => {
    withBytes(new TextEncoder().encode("1234"));
    const away = languagesWith(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/deu" },
        }),
    );
    await expect(away.download("deu")).rejects.toThrow(/should not/);
    const big = languagesWith(
      async () => new Response(new TextEncoder().encode("123456789")),
    );
    await expect(big.download("deu")).rejects.toThrow(/larger than expected/);
  });

  it("refuses a language that is not in the list", async () => {
    const languages = languagesWith(async () => new Response("x"));
    await expect(languages.download("xyz")).rejects.toThrow(/not in the list/);
    await expect(languages.download({ code: "deu" })).rejects.toThrow();
    expect(() => languages.remove("eng")).toThrow();
  });

  it("a file changed after it was kept stops counting", async () => {
    const bytes = new TextEncoder().encode("trained data");
    withBytes(bytes);
    const languages = languagesWith(async () => new Response(bytes));
    await languages.download("deu");
    writeFileSync(
      join(dir, "ocr-languages", "deu.traineddata"),
      "tampered!!!!",
    );
    expect(languagesWith(fetch).bytesOf("deu")).toBeUndefined();
  });
});

describe("progress and Stop", () => {
  it("reports the start and the whole file, and drops what comes too soon", async () => {
    const bytes = new Uint8Array(1000).fill(7);
    withBytes(bytes);
    // Ten chunks, all within one throttle interval of a frozen clock.
    const fake: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 10; i += 1)
              controller.enqueue(bytes.slice(i * 100, (i + 1) * 100));
            controller.close();
          },
        }),
      );
    const seen: OcrDownloadProgress[] = [];
    const languages = languagesWith(fake, () => 0);
    await languages.download("deu", (p) => seen.push(p));
    // The start and the end: every chunk came inside one interval of the start.
    expect(seen.map((p) => p.received)).toEqual([0, 1000]);
    expect(seen.every((p) => p.code === "deu" && p.total === 1000)).toBe(true);
  });

  it("Stop ends the download and deletes the partial file", async () => {
    const first = new TextEncoder().encode("part");
    withBytes(new TextEncoder().encode("part of a longer file"));
    // A clock a second further on at every read, so every chunk is reported.
    let at = 0;
    const languages = languagesWith(stalledBody(first), () => {
      at += 1000;
      return at;
    });
    let arrived: () => void = () => {};
    const firstChunk = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pending = languages.download("deu", (p) => {
      if (p.received > 0) arrived();
    });
    await firstChunk;
    // The partial file is on disk while it downloads.
    expect(filesLeft()).toHaveLength(1);
    expect(languages.cancel("deu")).toBe(true);
    await expect(pending).rejects.toThrow(STOPPED);
    expect(filesLeft()).toEqual([]);
    expect(languages.installed()).toEqual(["eng"]);
    // Nothing is under way any more, so a second Stop finds nothing.
    expect(languages.cancel("deu")).toBe(false);
  });

  it("deletes the partial file when the connection drops", async () => {
    withBytes(new TextEncoder().encode("a longer file than this"));
    const fake: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("a longer"));
          },
          pull(controller) {
            controller.error(new Error("socket hang up"));
          },
        }),
      );
    await expect(languagesWith(fake).download("deu")).rejects.toThrow(
      /Check your connection/,
    );
    expect(filesLeft()).toEqual([]);
  });

  it("downloads one language once at a time", async () => {
    withBytes(new TextEncoder().encode("part of a longer file"));
    const languages = languagesWith(
      stalledBody(new TextEncoder().encode("part")),
    );
    const pending = languages.download("deu");
    await expect(languages.download("deu")).rejects.toThrow(/already/);
    languages.cancel("deu");
    await expect(pending).rejects.toThrow(STOPPED);
  });

  it("checks what Stop is given", () => {
    const languages = languagesWith(async () => new Response("x"));
    expect(() => languages.cancel("xyz")).toThrow(/not in the list/);
    expect(() => languages.cancel(5)).toThrow(/not in the list/);
    expect(() => languages.cancel({ code: "deu" })).toThrow();
    expect(languages.cancel("deu")).toBe(false);
  });
});
